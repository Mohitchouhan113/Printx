/**
 * WhatsApp Cloud API service for QRKraft Print.
 *
 * Sends automated notifications to customers when:
 *   1. A print job is submitted (token confirmation)
 *   2. A print job is completed (pickup ready)
 *
 * Supports WhatsApp Cloud API (Meta Business) via env vars:
 *   WHATSAPP_API_KEY        — permanent access token
 *   WHATSAPP_PHONE_NUMBER_ID — sender phone number ID
 *
 * Falls back to console logging in demo mode (no env vars).
 */

import { getStatus as getGatewayStatus, sendMessage as gatewaySend } from './whatsapp-gateway';

const API_URL = 'https://graph.facebook.com/v18.0';

/* ================================================================== */
/* Phone Number Formatting                                             */
/* ================================================================== */

/**
 * Normalise an Indian phone number to WhatsApp format (+91XXXXXXXXXX).
 *
 * Accepts:
 *   "9876543210"   → "+919876543210"
 *   "919876543210" → "+919876543210"
 *   "+919876543210" → "+919876543210"
 *   "09876543210"  → "+919876543210"
 */
export function formatPhone(phone) {
  if (!phone) return null;

  // Strip everything except digits and +
  let cleaned = phone.replace(/[^\d+]/g, '');

  // Remove leading zeros
  cleaned = cleaned.replace(/^0+/, '');

  // Already has +91 prefix
  if (cleaned.startsWith('+91') && cleaned.length === 13) return cleaned;

  // Has 91 prefix without +
  if (cleaned.startsWith('91') && cleaned.length === 12) return `+${cleaned}`;

  // Plain 10-digit Indian number
  if (cleaned.length === 10 && /^[6-9]/.test(cleaned)) return `+91${cleaned}`;

  // Doesn't look like a valid Indian number
  return null;
}

/* ================================================================== */
/* Price Calculation                                                   */
/* ================================================================== */

/**
 * Calculate total price from page config and shop rates.
 * Returns { total, bwPages, colorPages, bwAmount, colorAmount }.
 */
export function calculatePrice(pageCount = 1, config = {}, bwRate = 2, colorRate = 10) {
  const isColor = config.color;
  const copies = config.copies || 1;

  let bwPages = 0;
  let colorPages = 0;

  if (isColor) {
    // Simulate: last 20% of pages are color
    colorPages = Math.max(1, Math.round(pageCount * 0.2));
    bwPages = pageCount - colorPages;
  } else {
    bwPages = pageCount;
  }

  const bwAmount = bwPages * bwRate;
  const colorAmount = colorPages * colorRate;
  const total = (bwAmount + colorAmount) * copies;

  return { total, bwPages, colorPages, bwAmount, colorAmount, copies };
}

/* ================================================================== */
/* Message Templates                                                   */
/* ================================================================== */

/**
 * Build the job submission confirmation message.
 */
export function buildSubmissionMessage({ customerName, shopName, tokenNumber, pageCount, bwPages, colorPages, totalPrice }) {
  return (
    `Hello ${customerName}! 📄\n` +
    `Your print order for *${shopName}* is received.\n\n` +
    `🎫 *Token No:* ${tokenNumber}\n` +
    `📊 *Details:* ${pageCount} Pages (${bwPages} B&W, ${colorPages} Color)\n` +
    `💰 *Estimated Bill:* ₹${totalPrice}\n\n` +
    `Please present Token ${tokenNumber} at the counter.`
  );
}

/**
 * Build the pickup ready notification message.
 */
export function buildCompletedMessage({ customerName, shopName, tokenNumber, totalPrice }) {
  return (
    `🎉 *Your Print is Ready!*\n\n` +
    `Token: *${tokenNumber}* at *${shopName}* is printed and waiting for you at the counter.\n` +
    `Total Amount: ₹${totalPrice}\n\n` +
    `Thank you for using QRKraft Print!`
  );
}

/**
 * Build the walk-in order creation message.
 */
export function buildWalkInMessage({ customerName, shopName, tokenNumber, totalPages, bwPages, colorPages, totalAmount }) {
  return (
    `Hello ${customerName}! 📄\n` +
    `Your walk-in print order at *${shopName}* is created.\n\n` +
    `🎫 *Token No:* ${tokenNumber}\n` +
    `📊 *Details:* ${totalPages} Pages (${bwPages} B&W, ${colorPages} Color)\n` +
    `💰 *Total:* ₹${totalAmount}\n\n` +
    `Please present Token *${tokenNumber}* at the counter to collect your print.\n` +
    `Thank you for visiting *${shopName}*!`
  );
}

/* ================================================================== */
/* WhatsApp Cloud API Sender                                           */
/* ================================================================== */

/**
 * Send a WhatsApp message via the Cloud API.
 *
 * @param {Object} params
 * @param {string} params.to        — recipient phone (+91XXXXXXXXXX)
 * @param {string} params.message   — plain text message body
 * @returns {{ success: boolean, messageId?: string, demo?: boolean, error?: string }}
 */
export async function sendWhatsAppMessage({ to, message }) {
  const apiKey = process.env.WHATSAPP_API_KEY;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  const formattedPhone = formatPhone(to);

  if (!formattedPhone) {
    console.warn(`[whatsapp] Invalid phone number: "${to}" — skipping`);
    return { success: false, error: 'Invalid phone number' };
  }

  /* ---- Primary: WhatsApp Web Gateway (free, unlimited) ---- */
  const gwStatus = getGatewayStatus();
  if (gwStatus.connected) {
    const result = await gatewaySend(formattedPhone, message);
    if (result.success) return result;
    // Gateway failed — fall through to Cloud API or demo
    console.warn('[whatsapp] Gateway send failed, trying Cloud API fallback:', result.error);
  }

  /* ---- Fallback: WhatsApp Cloud API (paid) ---- */
  if (apiKey && phoneNumberId) {
    try {
      const url = `${API_URL}/${phoneNumberId}/messages`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: formattedPhone.replace('+', ''),
          type: 'text',
          text: { body: message },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('[whatsapp] Cloud API error:', response.status, data);
        return { success: false, error: data?.error?.message || `HTTP ${response.status}` };
      }

      const messageId = data?.messages?.[0]?.id;
      console.log(`[whatsapp] Cloud API message sent to ${formattedPhone} — id: ${messageId}`);
      return { success: true, messageId, provider: 'cloud-api' };
    } catch (err) {
      console.error('[whatsapp] Cloud API send failed:', err.message);
    }
  }

  /* ---- Demo mode (nothing configured) ---- */
  console.log(
    `[whatsapp] DEMO — would send to ${formattedPhone}:\n${message}`
  );
  return { success: true, demo: true, messageId: `demo-${Date.now()}` };
}

/**
 * Fire-and-forget wrapper — send a message without blocking the response.
 * Errors are logged but never thrown.
 */
export function sendWhatsAppFireAndForget(params) {
  sendWhatsAppMessage(params).catch((err) => {
    console.error('[whatsapp] fire-and-forget error:', err);
  });
}
