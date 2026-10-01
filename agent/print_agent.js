#!/usr/bin/env node
'use strict';

/**
 * PrintX Offline Spooler — Desktop Print Agent (v2)
 * =================================================
 * Runs on the shop PC (Windows) and bridges Supabase → the Windows Print
 * Spooler with zero UI interaction:
 *
 *   1. REALTIME TRIGGER — a Supabase Realtime channel watches `orders`
 *      (INSERT + UPDATE, filtered by shop_id). An order is printable when
 *      `payment_status = 'PAID'` OR `status = 'pending'` (case-insensitive;
 *      the live schema stores 'PENDING' and orders.payment_status doesn't
 *      exist yet — both are handled).
 *        · 🔔 audio alert (Windows beep / terminal BEL)
 *        · ⬇  axios download → temp/order_<id>.pdf (keep-alive HTTPS pool)
 *        · 🖨️  SumatraPDF CLI (`-print-to[-default] -silent`) spools it
 *              directly — no dialog latency; pdf-to-printer is the fallback
 *        · ✅ success → orders.status = 'printed', temp file deleted
 *        · ❌ error   → orders.status = 'failed' (after MAX_ATTEMPTS)
 *
 *   PIPELINE — downloads and spooling run as separate worker promises:
 *      DOWNLOAD_WORKERS (default 3) fetch PDFs in parallel while ONE spool
 *      worker feeds the printer in FIFO order (tokens must print in order).
 *      The realtime listener only pushes onto the queue — it never awaits
 *      network or spooler I/O, so the WebSocket never blocks.
 *
 *   2. OFFLINE RESILIENCE — Realtime is exactly what you lose when the
 *      link drops, so a REST catch-up poll (POLL_INTERVAL_MS, default 10s)
 *      re-enqueues printable orders from the last LOOKBACK_HOURS. Jobs
 *      whose download fails for *network* reasons are deferred (never
 *      marked failed) and retried by the poll when connectivity returns;
 *      only hard errors (4xx, no file, spooler refusing) exhaust
 *      MAX_ATTEMPTS → 'failed'. A status write that fails after a
 *      successful print is queued and flushed on every tick, so the order
 *      is never printed twice by this process.
 *
 *   3. HEARTBEAT — every HEARTBEAT_MS (default 30s) pings
 *      `shops.last_active_at` so the Vendor Dashboard can show
 *      "Printer Status: 🟢 Online". The column may not exist yet: the
 *      heartbeat degrades gracefully (logs the migration hint once,
 *      re-probes every 5 minutes) until
 *      supabase/migrations/20260928_agent_heartbeat.sql is run.
 *
 * Config (agent/.env — see .env.example):
 *   SHOP_ID, SUPABASE_URL, SUPABASE_SERVICE_KEY   (required;
 *     anon key accepted as fallback; frontend .env.local read as dev aid)
 *   PRINTER            Windows printer name (default = OS default printer)
 *   POLL_INTERVAL_MS   10000   HEARTBEAT_MS   30000
 *   LOOKBACK_HOURS     24      MAX_ATTEMPTS   3
 *   ALERT              1       DRY_RUN        0
 *   BUCKET             print-uploads
 *   DOWNLOAD_WORKERS   3        SUMATRA_PDF_EXE  (override SumatraPDF path)
 *
 * Flags: --once (single catch-up cycle), --dry-run, --help
 *
 * Usage:  node print_agent.js            # daemon
 *         node print_agent.js --once     # one catch-up cycle, then exit
 *         node print_agent.js --dry-run  # log instead of spooling
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { execFile } = require('child_process');
const { promisify } = require('util');
const axios = require('axios');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const ptp = require('pdf-to-printer');

const execFileP = promisify(execFile);

/* ================================================================== */
/* Persistent HTTP agents (keep-alive)                                 */
/* ================================================================== */
/* One TCP/TLS connection to the Supabase storage host is reused across
 * every order download instead of re-handshaking per file. */
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 16, maxFreeSockets: 4 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 16, maxFreeSockets: 4 });
function destroyAgents() {
  try { httpAgent.destroy(); } catch { /* noop */ }
  try { httpsAgent.destroy(); } catch { /* noop */ }
}

/* ================================================================== */
/* Logging                                                             */
/* ================================================================== */

const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const log = (...a) => console.log(`[print-agent] ${ts()}`, ...a);
const warn = (...a) => console.warn(`[print-agent] ${ts()} WARN`, ...a);
const errlog = (...a) => console.error(`[print-agent] ${ts()} ERROR`, ...a);

/* ================================================================== */
/* Config                                                              */
/* ================================================================== */

dotenv.config({ path: path.join(__dirname, '.env') });
// Dev convenience: reuse the frontend's Supabase env if the agent has none.
if (!process.env.SUPABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL) {
  dotenv.config({ path: path.join(__dirname, '..', 'printx-frontend', '.env.local') });
}

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(
    [
      'PrintX Offline Spooler — Desktop Print Agent',
      '',
      '  node print_agent.js [--once] [--dry-run]',
      '',
      'Env (agent/.env): SHOP_ID, SUPABASE_URL, SUPABASE_SERVICE_KEY (required;',
      'anon key accepted), PRINTER, POLL_INTERVAL_MS (10000), HEARTBEAT_MS',
      '(30000), LOOKBACK_HOURS (24), MAX_ATTEMPTS (3), ALERT (1), DRY_RUN (0),',
      'BUCKET (print-uploads), DOWNLOAD_WORKERS (3), SUMATRA_PDF_EXE.',
      'Copy .env.example → .env and fill it in.',
    ].join('\n')
  );
  process.exit(0);
}

const CONFIG = {
  supabaseUrl: (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ''
  ).replace(/\/+$/, ''),
  supabaseKey:
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '',
  shopId: (process.env.SHOP_ID || '').trim(),
  printer: process.env.PRINTER || '',
  pollMs: Math.max(2000, parseInt(process.env.POLL_INTERVAL_MS, 10) || 10000),
  heartbeatMs: Math.max(5000, parseInt(process.env.HEARTBEAT_MS, 10) || 30000),
  lookbackHours: Math.max(1, parseInt(process.env.LOOKBACK_HOURS, 10) || 24),
  maxAttempts: Math.max(1, parseInt(process.env.MAX_ATTEMPTS, 10) || 3),
  alert: !['0', 'false', 'no'].includes((process.env.ALERT || '1').toLowerCase()),
  dryRun:
    argv.includes('--dry-run') ||
    ['1', 'true', 'yes'].includes((process.env.DRY_RUN || '').toLowerCase()),
  once: argv.includes('--once'),
  bucket: process.env.BUCKET || 'print-uploads',
  tempDir: process.env.TEMP_DIR || path.join(__dirname, 'temp'),
  downloadWorkers: Math.max(1, parseInt(process.env.DOWNLOAD_WORKERS, 10) || 3),
};

if (!CONFIG.supabaseUrl || !CONFIG.supabaseKey || !CONFIG.shopId) {
  errlog('missing configuration — need SHOP_ID, SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  errlog('copy agent/.env.example to agent/.env and fill it in (or run with --help).');
  process.exit(1);
}

const sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/* ================================================================== */
/* Status vocabulary                                                   */
/* ================================================================== */

// Terminal for the agent: never print again, regardless of trigger checks.
const TERMINAL = new Set([
  'printed', 'failed', 'completed', 'cancelled', 'canceled',
  'printing', 'ready', 'ready_for_pickup', 'picked_up', 'refunded',
]);

const norm = (s) => String(s || '').trim().toLowerCase();

/**
 * Spec trigger: payment_status = 'PAID' OR status = 'pending' (the live
 * schema uppercases status and may not have payment_status yet — both
 * normalized here). Terminal statuses always win so our own
 * 'printed'/'failed' writes (and vendor PRINTING/READY/COMPLETED) can
 * never retrigger a print.
 */
function isPrintable(order) {
  if (!order || !order.id) return false;
  const st = norm(order.status);
  if (TERMINAL.has(st)) return false;
  const paid = String(order.payment_status || '').trim().toUpperCase() === 'PAID';
  return paid || st === 'pending';
}

/** Classify download/print errors: network ⇒ defer (offline), else hard. */
function isNetworkError(e) {
  const code = e && e.code;
  if (code && ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT',
    'EAI_AGAIN', 'EPIPE', 'ERR_NETWORK', 'ECONNABORTED',
    'ERR_SOCKET_CONNECTION_TIMEOUT'].includes(code)) return true;
  const status = e && e.response && e.response.status;
  if (status && (status >= 500 || status === 429)) return true;
  const msg = String((e && e.message) || '');
  return /timeout|network|socket hang up|fetch failed|getaddrinfo|ECONNREFUSED|ENOTFOUND/i.test(msg);
}

/* ================================================================== */
/* In-memory state                                                     */
/* ================================================================== */

const processed = new Map();   // id -> 'inflight' | 'done' | 'skipped'
const hardFails = new Map();   // id -> hard-error attempt count
const deferUntil = new Map();  // id -> ts earliest re-attempt (backoff)
const syncPending = new Map(); // id -> status owed to Supabase after print
let defaultPrinter = CONFIG.printer || '';
let online = null;             // null unknown / true / false
let hbMissingColumnLogged = false;
let hbPauseUntil = 0;          // slow re-probe after missing-column error

/* 2-stage pipeline state — downloads parallel, spooling serial (FIFO). */
const waitQueue = [];   // orders awaiting download (FIFO)
const spoolQueue = [];  // downloaded jobs awaiting the spooler (FIFO)
let activeDownloads = 0;
let spoolerBusy = false;
let drainPromise = null;
let drainResolvers = [];

const pipelineIdle = () =>
  waitQueue.length === 0 &&
  spoolQueue.length === 0 &&
  activeDownloads === 0 &&
  !spoolerBusy;

/* ================================================================== */
/* Audio alert                                                         */
/* ================================================================== */

function playAlert() {
  if (!CONFIG.alert) return;
  if (process.platform === 'win32') {
    // notify.wav through the system mixer; console beep as fallback.
    const ps = "try { (New-Object Media.SoundPlayer 'C:\\Windows\\Media\\notify.wav').PlaySync() } catch { [console]::beep(880,300) }";
    execFile('powershell.exe', ['-NoProfile', '-Command', ps], () => {});
  } else {
    process.stdout.write('\x07');
  }
}

/* ================================================================== */
/* Network helpers                                                     */
/* ================================================================== */

function noteOnline(ok, why) {
  if (online !== ok) {
    online = ok;
    if (ok) log(`🌐 network ONLINE${why ? ` (${why})` : ''} — flushing pending syncs`);
    else warn(`📡 network OFFLINE${why ? ` (${why})` : ''} — local flow continues, catch-up poll resumes when back`);
  }
}

function missingColumn(error, col) {
  const msg = String((error && error.message) || '');
  const code = error && error.code;
  return code === 'PGRST204' || code === '42703' ||
    new RegExp(`'${col}' column|column "${col}"|column ${col}`).test(msg);
}

/** Best-effort status write; queues for retry when the network is down. */
async function setStatus(orderId, status) {
  try {
    const { error } = await sb.from('orders').update({ status }).eq('id', orderId);
    if (error) {
      if (isNetworkError({ message: error.message })) {
        syncPending.set(orderId, status);
        noteOnline(false, 'status update');
        return false;
      }
      errlog(`status='${status}' write failed for order ${orderId}: ${error.message}`);
      syncPending.set(orderId, status);
      return false;
    }
    syncPending.delete(orderId);
    noteOnline(true, 'status update');
    return true;
  } catch (e) {
    syncPending.set(orderId, status);
    noteOnline(false, 'status update');
    return false;
  }
}

async function flushSyncs() {
  if (!syncPending.size) return;
  for (const [id, status] of [...syncPending]) {
    await setStatus(id, status);
  }
}

/* ================================================================== */
/* Download → print → status                                           */
/* ================================================================== */

function resolveFileUrl(raw) {
  const url = String(raw || '').trim();
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) {
    return `${CONFIG.supabaseUrl}/storage/v1/object/public/${CONFIG.bucket}${url}`;
  }
  return `${CONFIG.supabaseUrl}/storage/v1/object/public/${CONFIG.bucket}/${url}`;
}

async function download(order, dest) {
  const url = resolveFileUrl(order.file_url);
  if (!url) {
    const e = new Error('order has no file_url');
    e.hard = true;
    throw e;
  }
  const res = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 30000,
    maxContentLength: 200 * 1024 * 1024,
    validateStatus: (s) => s >= 200 && s < 300,
    // Reuse one keep-alive TCP/TLS connection to the storage host across
    // every order instead of a fresh TLS handshake per download.
    httpAgent,
    httpsAgent,
  });
  const buf = Buffer.from(res.data);
  if (buf.length < 64) {
    const e = new Error(`downloaded file suspiciously small (${buf.length} bytes)`);
    e.hard = true;
    throw e;
  }
  fs.writeFileSync(dest, buf);
  return buf.length;
}

/* ================================================================== */
/* SumatraPDF CLI — primary silent driver                              */
/* ================================================================== */
/* Direct `SumatraPDF.exe -print-to[-default] -silent <file>` skips any
 * intermediate wrapper and its dialog latency. Candidates, in order:
 *   1. SUMATRA_PDF_EXE override
 *   2. the copy bundled with pdf-to-printer (dist/SumatraPDF*.exe)
 *   3. standard per-machine install locations
 * A positive resolution is cached; negatives re-probe (cheap) so dropping
 * the exe into place later starts working without a restart. */
const BUNDLED_SUMATRA_DIR = path.join(__dirname, 'node_modules', 'pdf-to-printer', 'dist');
let sumatraBinCache = null;

function resolveSumatraBin() {
  if (sumatraBinCache) return sumatraBinCache;
  const candidates = [process.env.SUMATRA_PDF_EXE || ''];
  try {
    for (const f of fs.readdirSync(BUNDLED_SUMATRA_DIR)) {
      if (/^SumatraPDF.*\.exe$/i.test(f)) candidates.push(path.join(BUNDLED_SUMATRA_DIR, f));
    }
  } catch { /* pdf-to-printer not installed yet */ }
  candidates.push(
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'SumatraPDF', 'SumatraPDF.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'SumatraPDF', 'SumatraPDF.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'SumatraPDF', 'SumatraPDF.exe')
  );
  for (const c of candidates) {
    if (!c) continue;
    try {
      if (fs.existsSync(c)) {
        sumatraBinCache = c;
        if (!process.env.SUMATRA_PDF_EXE) log(`SumatraPDF CLI: ${c}`);
        return c;
      }
    } catch { /* unreadable path — keep looking */ }
  }
  return null;
}

async function spool(dest) {
  if (CONFIG.dryRun) {
    log(`🧪 [DRY-RUN] would spool ${path.basename(dest)} → printer "${defaultPrinter || 'OS default'}"`);
    return;
  }

  // PRIMARY: direct SumatraPDF CLI — silent, no dialog, hard timeout.
  const sumatra = process.platform === 'win32' ? resolveSumatraBin() : null;
  if (sumatra) {
    const args = [
      ...(defaultPrinter ? ['-print-to', defaultPrinter] : ['-print-to-default']),
      '-silent',
      dest,
    ];
    try {
      await execFileP(sumatra, args, { timeout: 60000, windowsHide: true });
      return;
    } catch (e) {
      const spawnIssue = e && (e.code === 'ENOENT' || e.code === 'EACCES');
      if (!spawnIssue) {
        if (e && e.killed) {
          const t = new Error('SumatraPDF spool timed out after 60s');
          t.hard = true;
          throw t;
        }
        throw e; // spooler refused — standard hard-failure/retry handling
      }
      warn(`SumatraPDF CLI not runnable (${e.code}) — falling back to pdf-to-printer`);
    }
  }

  // FALLBACK: pdf-to-printer (also drives its bundled SumatraPDF copy).
  await ptp.print(dest, defaultPrinter ? { printer: defaultPrinter } : {});
}

function enqueue(order, src) {
  const id = order.id;
  if (!id || processed.has(id)) return;
  if (!isPrintable(order)) {
    if (order.file_url !== undefined || order.status !== undefined) {
      // remember terminal/foreign rows so the poll doesn't re-evaluate them forever
      if (TERMINAL.has(norm(order.status))) processed.set(id, 'done');
    }
    return;
  }
  const notBefore = deferUntil.get(id) || 0;
  if (notBefore > Date.now()) return;
  processed.set(id, 'inflight');
  waitQueue.push({ order, src });
  log(`📥 ${src} order ${id.slice(0, 8)} status='${order.status}' payment='${order.payment_status || 'n/a'}'${order.file_name ? ` file=${order.file_name}` : ''} → queued`);
  kickWorkers();
}

/*
 * Two-stage pipeline — the realtime listener only calls enqueue(), which is
 * synchronous; all network/spool I/O lives in these workers:
 *
 *   Stage A: up to DOWNLOAD_WORKERS parallel downloaders (network-bound)
 *   Stage B: ONE spooler, FIFO (hardware-bound; token order preserved)
 *
 * A worker finishing kicks the next unit of work, so an order arriving
 * mid-download never waits for the previous one to reach the printer.
 */
function kickWorkers() {
  // Stage A — parallel downloads
  while (activeDownloads < CONFIG.downloadWorkers && waitQueue.length) {
    const job = waitQueue.shift();
    activeDownloads += 1;
    downloadStage(job)
      .catch((e) => errlog(`download worker crashed: ${e && e.message}`))
      .finally(() => {
        activeDownloads -= 1;
        kickWorkers();
        settleDrain();
      });
  }

  // Stage B — serial spooler
  if (!spoolerBusy && spoolQueue.length) {
    spoolerBusy = true;
    const job = spoolQueue.shift();
    spoolStage(job)
      .catch((e) => errlog(`spool worker crashed: ${e && e.message}`))
      .finally(() => {
        spoolerBusy = false;
        kickWorkers();
        settleDrain();
      });
  }
}

function drain() {
  // Shared promise: resolves once BOTH stages are idle (--once awaits it).
  if (drainPromise) return drainPromise;
  drainPromise = new Promise((resolve) => drainResolvers.push(resolve));
  if (pipelineIdle()) settleDrain();
  return drainPromise;
}

function settleDrain() {
  if (!drainPromise || !pipelineIdle()) return;
  const pending = drainResolvers;
  drainPromise = null;
  drainResolvers = [];
  pending.forEach((resolve) => resolve());
}

/* Stage A — fetch the PDF (parallel, keep-alive HTTPS). */
async function downloadStage({ order }) {
  const id = order.id;
  const label = `order ${id.slice(0, 8)}${order.token_no ? ` #${order.token_no}` : ''}`;
  const dest = path.join(CONFIG.tempDir, `order_${id}.pdf`);
  try {
    playAlert();
    const bytes = await download(order, dest);
    log(`💾 downloaded ${bytes} bytes → temp/order_${id}.pdf (${order.file_name || 'unnamed'}) [attempt ${Math.min((hardFails.get(id) || 0) + 1, CONFIG.maxAttempts)}/${CONFIG.maxAttempts}]`);
    spoolQueue.push({ order, dest, label });
  } catch (e) {
    await failJob(e, id, dest, label);
  }
}

/* Stage B — spool to the printer (serial FIFO), then write back status. */
async function spoolStage({ order, dest, label }) {
  const id = order.id;
  try {
    await spool(dest);
    log(`🖨️  printed ${label}${CONFIG.dryRun ? ' (dry-run)' : ''} — setting status='printed'`);
    await setStatus(id, 'printed');
    processed.set(id, 'done');
    hardFails.delete(id);
    try { fs.unlinkSync(dest); } catch { /* already gone */ }
  } catch (e) {
    await failJob(e, id, dest, label);
  }
}

/* Shared failure handling for either stage (unchanged semantics): network
 * errors defer to the catch-up poll; hard errors exhaust MAX_ATTEMPTS. */
async function failJob(e, id, dest, label) {
  try { if (fs.existsSync(dest) && !e.hard) fs.unlinkSync(dest); } catch { /* ignore */ }

  if (isNetworkError(e)) {
    // Offline: never fail the order — the catch-up poll retries later.
    processed.delete(id);
    deferUntil.set(id, Date.now() + CONFIG.pollMs);
    noteOnline(false, `${label} download/print`);
    warn(`${label}: network error while fetching/spooling (${e.message}) — deferred, will retry via catch-up poll`);
    return;
  }

  const hard = (hardFails.get(id) || 0) + 1;
  hardFails.set(id, hard);
  errlog(`${label}: ${e.message} (hard failure ${hard}/${CONFIG.maxAttempts})`);
  if (hard >= CONFIG.maxAttempts) {
    await setStatus(id, 'failed');
    processed.set(id, 'done');
    hardFails.delete(id);
    errlog(`❌ ${label} marked status='failed' after ${hard} attempts`);
    return;
  }
  deferUntil.set(id, Date.now() + 3000);
  processed.delete(id); // allow poll to re-enqueue after backoff
}

/* ================================================================== */
/* 1. Realtime trigger (orders INSERT + UPDATE, filtered by shop_id)   */
/* ================================================================== */

/** Payloads for UPDATEs can be partial — always re-fetch the full row. */
async function hydrate(id) {
  try {
    const { data, error } = await sb.from('orders').select('*').eq('id', id).maybeSingle();
    if (error) { warn(`hydrate ${id}: ${error.message}`); return null; }
    return data;
  } catch (e) {
    warn(`hydrate ${id}: ${e.message}`);
    return null;
  }
}

function startRealtime() {
  const filter = `shop_id=eq.${CONFIG.shopId}`;
  const channel = sb.channel(`print-agent-${CONFIG.shopId}`);
  for (const event of ['INSERT', 'UPDATE']) {
    channel.on(
      'postgres_changes',
      { event, schema: 'public', table: 'orders', filter },
      (payload) => {
        const row = payload.new;
        if (!row || !row.id) return;
        // INSERT rows are complete; UPDATE rows may carry only changed
        // columns — hydrate so trigger checks always see the full record.
        const ready = event === 'INSERT' ? Promise.resolve(row) : hydrate(row.id);
        ready.then((full) => full && enqueue(full, `realtime:${event.toLowerCase()}`));
      }
    );
  }
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      log('🔴 realtime subscribed — watching orders (INSERT+UPDATE) for this shop');
      noteOnline(true, 'realtime');
      catchUp(); // close the gap between connect and first event
    } else if (status === 'CHANNEL_ERROR') {
      warn('realtime CHANNEL_ERROR — catch-up poll keeps orders flowing; supabase-js will retry');
      noteOnline(false, 'realtime');
    } else if (status === 'TIMED_OUT' || status === 'CLOSED') {
      warn(`realtime ${status} — falling back to catch-up poll`);
      noteOnline(false, 'realtime');
    } else {
      log(`realtime: ${status}`);
    }
  });
  return channel;
}

/* ================================================================== */
/* 2. Catch-up poll (offline resilience + restart recovery)            */
/* ================================================================== */

async function catchUp() {
  const since = new Date(Date.now() - CONFIG.lookbackHours * 3600_000).toISOString();
  try {
    const { data, error } = await sb
      .from('orders')
      .select('*')
      .eq('shop_id', CONFIG.shopId)
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(50);
    if (error) { noteOnline(false, 'catch-up'); warn(`catch-up poll: ${error.message}`); return; }
    noteOnline(true, 'catch-up');
    for (const row of data || []) enqueue(row, 'catch-up');
  } catch (e) {
    noteOnline(false, 'catch-up');
    warn(`catch-up poll: ${e.message}`);
  }
}

/* ================================================================== */
/* 3. Heartbeat — shops.last_active_at (Printer Status 🟢 Online)      */
/* ================================================================== */

async function heartbeat() {
  if (Date.now() < hbPauseUntil) return;
  try {
    const { error } = await sb
      .from('shops')
      .update({ last_active_at: new Date().toISOString() })
      .eq('id', CONFIG.shopId);
    if (error) {
      if (missingColumn(error, 'last_active_at')) {
        if (!hbMissingColumnLogged) {
          hbMissingColumnLogged = true;
          warn('shops.last_active_at column missing — heartbeat paused.');
          warn('  → run supabase/migrations/20260928_agent_heartbeat.sql (re-probes every 5 min).');
        }
        hbPauseUntil = Date.now() + 5 * 60_000;
        return;
      }
      warn(`heartbeat: ${error.message}`);
      if (isNetworkError({ message: error.message })) noteOnline(false, 'heartbeat');
      return;
    }
    if (hbMissingColumnLogged) log('✅ heartbeat resumed — last_active_at column is available now');
    hbMissingColumnLogged = false;
    noteOnline(true, 'heartbeat');
  } catch (e) {
    noteOnline(false, 'heartbeat');
    warn(`heartbeat: ${e.message}`);
  }
}

/* ================================================================== */
/* Startup                                                             */
/* ================================================================== */

async function resolvePrinter() {
  if (defaultPrinter) return;
  if (process.platform !== 'win32') return;
  try {
    const p = await ptp.getDefaultPrinter();
    if (p && p.name) {
      defaultPrinter = p.name;
      log(`default printer: ${defaultPrinter}`);
    } else {
      warn('no default printer configured — using OS default at spool time');
    }
  } catch (e) {
    warn(`could not resolve default printer (${e.message}) — using OS default`);
  }
}

function sweepTemp() {
  try {
    fs.mkdirSync(CONFIG.tempDir, { recursive: true });
    const cutoff = Date.now() - 24 * 3600_000;
    for (const f of fs.readdirSync(CONFIG.tempDir)) {
      const p = path.join(CONFIG.tempDir, f);
      if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
    }
  } catch (e) {
    warn(`temp sweep: ${e.message}`);
  }
}

async function main() {
  log('PrintX print agent starting', {
    shop: CONFIG.shopId,
    supabase: CONFIG.supabaseUrl,
    printer: defaultPrinter || 'OS default',
    dryRun: CONFIG.dryRun,
    poll: `${CONFIG.pollMs}ms`,
    heartbeat: `${CONFIG.heartbeatMs}ms`,
    workers: `${CONFIG.downloadWorkers} downloads → 1 spooler`,
    key: CONFIG.supabaseKey === process.env.SUPABASE_SERVICE_KEY ? 'service' : 'fallback',
  });
  if (CONFIG.dryRun) warn('DRY RUN enabled — nothing is sent to the spooler');

  sweepTemp();
  await resolvePrinter();
  await heartbeat();
  await catchUp();

  if (CONFIG.once) {
    await drain();
    await flushSyncs();
    destroyAgents(); // release keep-alive sockets so the process can exit
    log('--once complete');
    return;
  }

  startRealtime();
  const timers = [
    setInterval(() => { catchUp(); flushSyncs(); }, CONFIG.pollMs),
    setInterval(heartbeat, CONFIG.heartbeatMs),
  ];

  const shutdown = (sig) => {
    log(`received ${sig} — flushing ${syncPending.size} pending sync(s) and exiting`);
    clearInterval(timers[0]);
    clearInterval(timers[1]);
    destroyAgents();
    flushSyncs().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((e) => {
  errlog('fatal:', e);
  process.exit(1);
});
