/**
 * WhatsApp Web Gateway — Free unlimited messaging via Baileys.
 *
 * Uses @whiskeysockets/baileys to create a persistent WhatsApp Web session.
 * No Meta API costs — sends messages directly from a connected WhatsApp number.
 *
 * Session state is persisted to the OS temp directory (os.tmpdir() +
 * /whatsapp-sessions) so it works on read-only filesystems such as Vercel
 * serverless functions, where only /tmp is writable.
 *
 * Usage:
 *   import { startGateway, getStatus, getQR, sendMessage } from './whatsapp-gateway';
 *   await startGateway();
 *   const { connected } = getStatus();
 *   const qr = await getQR(); // returns base64 data URL or null
 *   await sendMessage('919876543210', 'Hello from QRKraft!');
 */

import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys';
import pino from 'pino';
import { Boom } from '@hapi/boom';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ================================================================== */
/* SESSION CONFIGURATION                                               */
/* ================================================================== */

/* Session dir MUST live in a writable location: Vercel serverless functions
 * have a read-only filesystem except /tmp, so a repo-local ./whatsapp-sessions
 * path crashed every route importing this module with ENOENT/EROFS. */
const SESSION_DIR =
  process.env.WHATSAPP_SESSION_DIR || path.join(os.tmpdir(), 'whatsapp-sessions');
const LOGGER = pino({ level: 'silent' });

// Ensure session directory exists — never let a filesystem problem crash the
// module at import time (it would 500 every route that imports this file).
try {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
} catch (err) {
  console.warn(`[wa-gateway] Could not create session dir "${SESSION_DIR}": ${err.message}`);
}

/* ================================================================== */
/* STATE                                                               */
/* ================================================================== */

let sock = null;
let qrCode = null;
let connectionState = 'disconnected'; // disconnected | connecting | connected | qr_pending
let lastDisconnectTime = null;
let reconnectAttempts = 0;
const MAX_RECONNECT = 5;

/* ================================================================== */
/* GATEWAY LIFECYCLE                                                   */
/* ================================================================== */

/**
 * Start the WhatsApp gateway session.
 * Call once on server startup. Safe to call multiple times (no-op if already running).
 */
export async function startGateway() {
  if (sock && connectionState === 'connected') {
    console.log('[wa-gateway] Already connected');
    return;
  }

  console.log('[wa-gateway] Starting WhatsApp Web gateway...');
  connectionState = 'connecting';

  try {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, LOGGER),
      },
      printQRInTerminal: false, // We handle QR ourselves
      logger: LOGGER,
      browser: ['QRKraft Print', 'Chrome', '120.0'],
      generateHighQualityLinkPreview: false,
    });

    /* ---- Event: Connection Update ---- */
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrCode = qr;
        connectionState = 'qr_pending';
        console.log('[wa-gateway] QR code received — scan with WhatsApp');
      }

      if (connection === 'close') {
        const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
        console.log(`[wa-gateway] Connection closed — reason: ${reason}`);

        if (reason === DisconnectReason.loggedOut) {
          console.log('[wa-gateway] Logged out — clearing session');
          clearSession();
          connectionState = 'disconnected';
        } else if (reason !== DisconnectReason.connectionClosed) {
          // Reconnect for transient errors
          reconnectAttempts++;
          if (reconnectAttempts <= MAX_RECONNECT) {
            console.log(`[wa-gateway] Reconnecting (${reconnectAttempts}/${MAX_RECONNECT})...`);
            connectionState = 'connecting';
            setTimeout(() => startGateway(), 3000 * reconnectAttempts);
          } else {
            console.log('[wa-gateway] Max reconnect attempts reached');
            connectionState = 'disconnected';
          }
        }
      }

      if (connection === 'open') {
        qrCode = null;
        connectionState = 'connected';
        reconnectAttempts = 0;
        console.log('[wa-gateway] ✅ Connected to WhatsApp');
      }
    });

    /* ---- Event: Credentials Update ---- */
    sock.ev.on('creds.update', saveCreds);

  } catch (err) {
    console.error('[wa-gateway] Start error:', err.message);
    connectionState = 'disconnected';
  }
}

/**
 * Get current connection status.
 */
export function getStatus() {
  return {
    connected: connectionState === 'connected',
    state: connectionState,
    phone: sock?.user?.id?.split(':')[0]?.replace('@s.whatsapp.net', '') || null,
    name: sock?.user?.name || null,
    timestamp: Date.now(),
  };
}

/**
 * Get the current QR code as a data URL (base64 PNG) for display in the UI.
 * Returns null if not in QR pending state.
 *
 * Uses an SVG-based approach since we can't use canvas server-side.
 * The raw QR string is returned for the client to render with qrcode.react.
 */
export function getQR() {
  if (!qrCode || connectionState !== 'qr_pending') return null;
  return {
    raw: qrCode, // The raw QR string — client renders with qrcode.react
    timestamp: Date.now(),
  };
}

/**
 * Send a WhatsApp text message.
 *
 * @param {string} to — phone number (10-digit Indian, or with country code)
 * @param {string} message — text body
 * @returns {{ success: boolean, messageId?: string, error?: string, demo?: boolean }}
 */
export async function sendMessage(to, message) {
  if (!sock || connectionState !== 'connected') {
    console.warn('[wa-gateway] Not connected — message queued for later delivery');
    return { success: false, error: 'WhatsApp gateway not connected', demo: false };
  }

  const jid = formatJid(to);
  if (!jid) {
    return { success: false, error: 'Invalid phone number format' };
  }

  try {
    const result = await sock.sendMessage(jid, { text: message });
    const messageId = result?.key?.id || `wa-${Date.now()}`;
    console.log(`[wa-gateway] Message sent to ${jid} — id: ${messageId}`);
    return { success: true, messageId };
  } catch (err) {
    console.error('[wa-gateway] Send error:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Disconnect the gateway gracefully.
 */
export async function disconnectGateway() {
  if (sock) {
    sock.end();
    sock = null;
    connectionState = 'disconnected';
    qrCode = null;
    console.log('[wa-gateway] Disconnected');
  }
}

/**
 * Clear session data (logout + delete files).
 */
export function clearSession() {
  try {
    if (fs.existsSync(SESSION_DIR)) {
      const files = fs.readdirSync(SESSION_DIR);
      for (const file of files) {
        fs.unlinkSync(path.join(SESSION_DIR, file));
      }
    }
    console.log('[wa-gateway] Session cleared');
  } catch (err) {
    console.error('[wa-gateway] Clear session error:', err.message);
  }
}

/* ================================================================== */
/* HELPERS                                                             */
/* ================================================================== */

/**
 * Format an Indian phone number to WhatsApp JID format.
 *
 * "9876543210"   → "919876543210@s.whatsapp.net"
 * "919876543210" → "919876543210@s.whatsapp.net"
 * "+919876543210" → "919876543210@s.whatsapp.net"
 */
function formatJid(phone) {
  if (!phone) return null;

  // Strip everything except digits and +
  let cleaned = phone.replace(/[^\d+]/g, '');

  // Remove leading zeros
  cleaned = cleaned.replace(/^0+/, '');

  // Remove + prefix
  cleaned = cleaned.replace(/^\+/, '');

  // Already has 91 prefix (12 digits)
  if (cleaned.startsWith('91') && cleaned.length === 12) {
    return `${cleaned}@s.whatsapp.net`;
  }

  // Plain 10-digit Indian number
  if (cleaned.length === 10 && /^[6-9]/.test(cleaned)) {
    return `91${cleaned}@s.whatsapp.net`;
  }

  return null;
}
