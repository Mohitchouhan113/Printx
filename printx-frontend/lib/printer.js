/**
 * Printer Fleet / Auto-Print Mode — the client-side execution arm.
 *
 * Three things live here so the dashboard toggle and the live queue can never
 * drift apart again:
 *
 *  1. The Auto-Print flag (`printx_auto_print`) — read/write helpers that
 *     always persist the canonical `'true' | 'false'` strings, while still
 *     understanding the legacy `'1' | '0'` values written by older builds.
 *
 *  2. `triggerSilentPrint(fileUrl, onComplete)` — zero-interaction printing
 *     through a hidden iframe: no new tab, no download dialog, and the frame
 *     is dropped after the job has spooled so the DOM never accumulates dead
 *     iframes.
 *
 *  3. `printHtmlDocument(html, onComplete)` — the same path for a locally
 *     built document (e.g. the fleet Test Print page), which needs no URL.
 *
 *  4. `isPrintAgentOnline(supabaseClient, shopId)` — Fleet presence. The
 *     desktop print agent (/agent) heartbeats `shops.last_active_at` every
 *     30s; a fresh heartbeat means the shop's PC spools jobs itself, with no
 *     dialogue and no browser involved. The queue uses this to decide who
 *     owns the job.
 *
 * Why the hand-off matters (the double-print fence):
 *  - The agent watches the `orders` sidecar and prints when the row is PAID
 *    or `status='pending'`, then writes `orders.status='printed'`. The
 *    dashboard drives `print_jobs.status`. They are different tables, so
 *    neither path can see the other's claim — with both running, one order
 *    gets printed twice (once by the counter PC's spooler, once by the
 *    browser dialogue).
 *  - So: agent online → hand the job off and never open a print dialogue.
 *    Agent absent, heartbeat stale, or the read blocked → browser path, which
 *    is the guaranteed fallback that works with nothing installed.
 *
 * Notes for the counter:
 *  - The browser always shows its native print dialogue for a cross-origin
 *    PDF/URL; truly dialog-less printing is the desktop print agent's job
 *    (see /agent). This helper is the guaranteed browser fallback that works
 *    in any browser with nothing installed.
 *  - `print()` on a cross-origin frame is blocked by the same-origin policy —
 *    the helper degrades to opening the file in a new tab rather than
 *    silently swallowing the job.
 *  - The whole module is a no-op outside a browser (SSR-safe).
 */

/** localStorage key shared by the dashboard toggle and the queue. */
export const AUTO_PRINT_KEY = 'printx_auto_print';

/** How long a hidden print frame lingers before it is dropped (ms). */
const FRAME_LINGER_MS = 5000;
/** Hard cap — a frame that never regains focus is removed anyway (ms). */
const FRAME_MAX_LIFE_MS = 120_000;

/**
 * A Fleet heartbeat is trusted for 90s. The agent pings every 30s
 * (HEARTBEAT_MS), so three missed beats mean the shop PC is genuinely gone and
 * the browser must take the job back — this is the same window the agent
 * README documents for the "Printer Status: 🟢 Online" badge.
 */
export const AGENT_ONLINE_WINDOW_MS = 90_000;

/**
 * Absolute http(s) only: a raw storage path (e.g. "uploads/a.pdf") would
 * simply 404 inside the hidden frame, so callers must not waste a job on it.
 */
export function isPrintableUrl(fileUrl) {
  if (!fileUrl || typeof fileUrl !== 'string') return false;
  try {
    const u = new URL(fileUrl);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Read the persisted Auto-Print flag (default OFF; `'1'` = legacy ON). */
export function isAutoPrintEnabled() {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(AUTO_PRINT_KEY);
    return raw === 'true' || raw === '1';
  } catch {
    return false; // storage blocked (private mode) — toggle still works in-session
  }
}

/**
 * Persist the Auto-Print flag as `'true' | 'false'` and announce the change
 * on the `printx:auto-print` event so any open queue reacts immediately
 * (including other tabs, which share localStorage but not React state).
 */
export function setAutoPrintEnabled(on) {
  if (typeof window === 'undefined') return false;
  const next = !!on;
  try {
    window.localStorage.setItem(AUTO_PRINT_KEY, next ? 'true' : 'false');
  } catch {
    return false;
  }
  try {
    if (typeof window.CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('printx:auto-print', { detail: next }));
    }
  } catch {
    /* no event support — the stored flag is still the source of truth */
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * Hidden print frame core
 * ------------------------------------------------------------------ */

/**
 * Drop the hidden frame once the job has had time to spool.
 *
 * Chrome/Firefox block the JS thread while their print dialogue is open, so
 * the timer only fires after it closes. Safari does not block, so we also
 * hold the frame while the document has no focus (dialogue up) and remove it
 * shortly after focus returns — dropping a frame mid-dialogue can cancel the
 * job in some engines.
 */
function scheduleFrameCleanup(frame, lingerMs) {
  if (typeof window === 'undefined') return;
  let removed = false;
  let timer = null;
  let cap = null;

  const finish = () => {
    if (removed) return;
    removed = true;
    clearTimeout(timer);
    clearTimeout(cap);
    try {
      window.removeEventListener('focus', onFocus, true);
    } catch {
      /* nothing to detach */
    }
    try {
      frame.remove();
    } catch {
      /* frame already detached */
    }
  };

  function onFocus() {
    setTimeout(finish, 800);
  }

  timer = setTimeout(() => {
    let focused = true;
    try {
      if (typeof document !== 'undefined' && typeof document.hasFocus === 'function') {
        focused = document.hasFocus();
      }
    } catch {
      focused = true;
    }
    if (!focused) {
      // Print dialogue still up — hold the frame, and hard-cap the wait.
      try {
        window.addEventListener('focus', onFocus, true);
      } catch {
        /* keep waiting on the cap below */
      }
      cap = setTimeout(finish, FRAME_MAX_LIFE_MS);
      return;
    }
    finish();
  }, Math.max(0, lingerMs));
}

/**
 * Build the invisible, zero-footprint frame and run the print flow on it.
 * Returns false when the browser refused to create/attach the frame.
 */
function runPrintFrame({ src, srcdoc, onComplete, lingerMs = FRAME_LINGER_MS, fallbackUrl }) {
  const done = (ok) => {
    if (typeof onComplete !== 'function') return;
    try {
      onComplete(ok);
    } catch (err) {
      console.warn('[printer] onComplete threw:', err?.message || err);
    }
  };

  let iframe;
  try {
    iframe = document.createElement('iframe');
  } catch {
    return false;
  }

  // Invisible, zero-footprint frame (never affects layout or the a11y tree).
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.title = '';
  if (srcdoc != null) iframe.srcdoc = srcdoc;
  else iframe.src = src;

  iframe.onload = () => {
    let printed = false;
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      printed = true;
    } catch (err) {
      console.error('Silent print trigger error:', err);
      // Cross-origin documents reject scripted print() — hand the file to a
      // real tab rather than silently dropping the job.
      if (fallbackUrl) {
        try {
          window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
        } catch {
          /* popup blocked — nothing more we can do from here */
        }
      }
    } finally {
      done(printed);
      scheduleFrameCleanup(iframe, lingerMs);
    }
  };

  iframe.onerror = () => {
    done(false);
    scheduleFrameCleanup(iframe, 0);
  };

  try {
    document.body.appendChild(iframe);
  } catch (err) {
    console.error('Silent print trigger error:', err);
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * Fleet (desktop print agent) presence
 * ------------------------------------------------------------------ */

/* Warn once per session, not once per poll. */
let PRINT_AGENT_PROBE_QUIET = false;
/* Set once the server has told us the column does not exist
 * (20260928_agent_heartbeat.sql not run). Re-asking every poll would just
 * fire a 400 every 20s for the life of the tab, so we stop for the session
 * and stay on the browser print path — which is what an absent agent means
 * anyway. A reload re-probes, so running the migration takes effect without
 * a code change. */
let PRINT_AGENT_PROBE_DISABLED = false;

/** PostgREST/Postgres "no such column" — the migration has not been run. */
function isMissingColumn(error) {
  const code = error?.code;
  const msg = String(error?.message || '');
  return (
    code === 'PGRST204' ||
    code === '42703' ||
    /column .*last_active_at.* does not exist|could not find the 'last_active_at' column/i.test(msg)
  );
}

/**
 * Pure freshness test for a `shops.last_active_at` value.
 *
 * Returns false for anything unusable (null, undefined, an unparseable
 * string, a clock-skewed future stamp) so a broken heartbeat can never make
 * the dashboard hand a job to an agent that is not there.
 */
export function isAgentHeartbeatFresh(lastActiveAt, now = Date.now(), windowMs = AGENT_ONLINE_WINDOW_MS) {
  if (lastActiveAt == null || lastActiveAt === '') return false;
  const at = lastActiveAt instanceof Date ? lastActiveAt.getTime() : Date.parse(String(lastActiveAt));
  if (!Number.isFinite(at)) return false;
  const age = now - at;
  // A future stamp means clock skew, not liveness — but a small skew is
  // normal, so only reject it when it is beyond the whole window.
  if (age < -windowMs) return false;
  return age <= windowMs;
}

/**
 * Is the shop's desktop print agent alive?
 *
 * Reads `shops.last_active_at` and treats a heartbeat inside
 * AGENT_ONLINE_WINDOW_MS as online. Every failure mode — no client, no shop,
 * RLS blocking the read, or the column not migrated yet — resolves to `false`,
 * which keeps the browser print path exactly as it behaves today.
 */
export async function isPrintAgentOnline(supabaseClient, shopId, { windowMs = AGENT_ONLINE_WINDOW_MS } = {}) {
  if (!supabaseClient || !shopId) return false;
  // The column is absent for this deployment — do not re-ask every poll.
  if (PRINT_AGENT_PROBE_DISABLED) return false;
  try {
    const { data, error } = await supabaseClient
      .from('shops')
      .select('last_active_at')
      .eq('id', shopId)
      .maybeSingle();
    if (error) {
      // Missing column (20260928_agent_heartbeat.sql not run) or RLS — both
      // mean "cannot prove the agent is up", so fall back to the browser.
      if (isMissingColumn(error)) PRINT_AGENT_PROBE_DISABLED = true;
      if (PRINT_AGENT_PROBE_QUIET) return false;
      PRINT_AGENT_PROBE_QUIET = true;
      console.warn('[printer] print-agent presence unavailable — using browser print:', error.message);
      return false;
    }
    return isAgentHeartbeatFresh(data?.last_active_at, Date.now(), windowMs);
  } catch (err) {
    if (!PRINT_AGENT_PROBE_QUIET) {
      PRINT_AGENT_PROBE_QUIET = true;
      console.warn('[printer] print-agent presence probe failed — using browser print:', err?.message || err);
    }
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Public print entry points
 * ------------------------------------------------------------------ */

/**
 * Fire the browser's print flow for `fileUrl` without leaving the page.
 *
 * Signature: `triggerSilentPrint(fileUrl, onComplete)` — `onComplete(ok)` runs
 * once the frame has loaded and printing was triggered (or the job fell back
 * to a new tab). Returns `false` when nothing was ever printed (no URL,
 * non-http(s) URL, no DOM) so the caller can degrade its toast/status.
 */
export const triggerSilentPrint = (fileUrl, onComplete, opts = {}) => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (!fileUrl) return false;

  const url = String(fileUrl);
  if (!isPrintableUrl(url)) return false;

  const { lingerMs } = opts;
  return runPrintFrame({
    src: url,
    onComplete,
    lingerMs: lingerMs ?? FRAME_LINGER_MS,
    fallbackUrl: url,
  });
};

/**
 * Print a locally built HTML document through the same hidden-frame path —
 * used by the fleet "Test Print" button, which has no file URL.
 */
export function printHtmlDocument(html, onComplete, opts = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (!html || typeof html !== 'string') return false;
  const { lingerMs } = opts;
  return runPrintFrame({
    srcdoc: html,
    onComplete,
    lingerMs: lingerMs ?? FRAME_LINGER_MS,
  });
}

/**
 * The counter's "Test Print" page: proves the browser → printer path is live
 * before a real job relies on it. Kept deliberately plain so it also works on
 * an 80mm thermal roll (A4 is the fallback).
 */
export function buildTestPrintPage({ shopName = 'PrintX Shop', printerName = 'Default printer', at = new Date() } = {}) {
  const stamp = at instanceof Date && !Number.isNaN(at.getTime()) ? at.toLocaleString('en-IN') : String(at);
  return `<!doctype html><html><head><meta charset="utf-8"><title>PrintX — Printer test</title><style>
      @page { size: auto; margin: 10mm; }
      body { font-family: 'Courier New', monospace; color: #111; margin: 0; }
      h1 { font-size: 18px; letter-spacing: 2px; margin: 0 0 4px; }
      .sub { font-size: 12px; color: #444; margin-bottom: 12px; }
      .token { font-size: 40px; font-weight: 900; letter-spacing: 4px; text-align: center;
               border-top: 2px dashed #000; border-bottom: 2px dashed #000; padding: 10px 0; margin: 14px 0; }
      .row { display: flex; justify-content: space-between; gap: 10px; font-size: 13px; padding: 3px 0; }
      .foot { margin-top: 14px; font-size: 11px; text-align: center; color: #444; }
    </style></head><body>
      <h1>PRINTX PRINTER TEST</h1>
      <div class="sub">Printer Fleet connection check</div>
      <div class="token">OK</div>
      <div class="row"><span>Shop</span><span>${shopName}</span></div>
      <div class="row"><span>Printer</span><span>${printerName}</span></div>
      <div class="row"><span>Printed at</span><span>${stamp}</span></div>
      <div class="row"><span>Auto-Print Mode</span><span>${isAutoPrintEnabled() ? 'ON' : 'OFF'}</span></div>
      <div class="foot">If you can read this, print jobs from the Live Queue will spool to this printer.</div>
    </body></html>`;
}

// Expose on window so non-module callers (inline counter buttons, the fleet
// guide) can trigger the same code path without an import.
if (typeof window !== 'undefined') {
  window.triggerSilentPrint = triggerSilentPrint;
  window.printHtmlDocument = printHtmlDocument;
  window.isAutoPrintEnabled = isAutoPrintEnabled;
  window.setAutoPrintEnabled = setAutoPrintEnabled;
  window.isPrintAgentOnline = isPrintAgentOnline;
}

export default triggerSilentPrint;
