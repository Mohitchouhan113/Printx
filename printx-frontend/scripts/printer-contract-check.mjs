/**
 * @fileoverview Contract + behaviour check for Printer Fleet / Auto-Print Mode.
 *
 * 1) Behaviour of `lib/printer.js` against a DOM stub: invalid URLs never
 *    print, a valid URL appends one hidden frame, `print()` is called on the
 *    frame, `onComplete(ok)` fires, cross-origin failures fall back to a tab,
 *    and the frame is self-cleaning.
 * 2) The Auto-Print flag round-trips as `'true' | 'false'` (legacy `'1'`/`'0'`
 *    still readable) under the shared `printx_auto_print` key.
 * 3) Wiring: the dashboard toggle and the Live Print Queue must both go
 *    through that helper, and the queue must expose the fleet Test Print.
 * 4) Fleet hand-off: a fresh `shops.last_active_at` heartbeat means the
 *    desktop print agent owns spooling, so the queue must decide that BEFORE
 *    it fires the browser print (otherwise one order prints twice). Every
 *    unprovable case — missing column, RLS, no shop, clock skew — must fall
 *    back to the browser path rather than silently dropping the job.
 *
 * NOTE: Node has no real DOM, so the browser APIs are stubbed. Real
 * end-to-end printing is confirmed in-browser via the queue's Test Print.
 */

import assert from 'node:assert';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import os from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const printerPath = join(projectRoot, 'lib/printer.js');
const dashboardPath = join(projectRoot, 'app/vendor/dashboard/page.jsx');
const queuePath = join(projectRoot, 'components/dashboard/LiveQueueTable.jsx');
const modalPath = join(projectRoot, 'components/dashboard/OrderPreviewModal.jsx');

for (const p of [printerPath, dashboardPath, queuePath, modalPath]) {
  assert(existsSync(p), `missing ${p}`);
}

const printerSrc = readFileSync(printerPath, 'utf8');
const dashboardSrc = readFileSync(dashboardPath, 'utf8');
const queueSrc = readFileSync(queuePath, 'utf8');
const modalSrc = readFileSync(modalPath, 'utf8');

/* ------------------------------------------------------------------ *
 * 1) Source contract
 * ------------------------------------------------------------------ */
assert(printerSrc.includes('export const triggerSilentPrint'), 'must export triggerSilentPrint');
assert(printerSrc.includes('export function printHtmlDocument'), 'must export printHtmlDocument');
assert(printerSrc.includes('export function isAutoPrintEnabled'), 'must export isAutoPrintEnabled');
assert(printerSrc.includes('export function setAutoPrintEnabled'), 'must export setAutoPrintEnabled');
assert(printerSrc.includes("AUTO_PRINT_KEY = 'printx_auto_print'"), 'must use the printx_auto_print key');
assert(printerSrc.includes("next ? 'true' : 'false'"), "flag must persist 'true' | 'false' (not '1'/'0')");
assert(printerSrc.includes("raw === 'true' || raw === '1'"), 'must still read the legacy 1/0 values');
assert(printerSrc.includes("createElement('iframe')"), 'must print through a hidden iframe');
assert(printerSrc.includes('.print()'), 'must call the frame print()');
assert(printerSrc.includes('FRAME_LINGER_MS = 5000'), 'frame must be dropped after 5s');
assert(printerSrc.includes('Silent print trigger error:'), 'must log silent-print trigger errors');
assert(printerSrc.includes('contentWindow'), 'must reach into the frame contentWindow');
assert(printerSrc.includes("iframe.style.width = '0'") && printerSrc.includes("iframe.style.height = '0'"), 'frame must be zero-sized');

assert(queueSrc.includes("from '../../lib/printer'") && queueSrc.includes('triggerSilentPrint,'), 'queue must import triggerSilentPrint');
assert(
  queueSrc.includes('triggerSilentPrint(order?.file_url)'),
  'queue auto-print must delegate to triggerSilentPrint'
);
assert(queueSrc.includes('printHtmlDocument') && queueSrc.includes('Test Print'), 'queue must expose the fleet Test Print');
assert(queueSrc.includes("'printx:auto-print'"), 'queue must react to the shared auto-print event');

/* Fleet (desktop print agent) presence + hand-off */
assert(printerSrc.includes('export const AGENT_ONLINE_WINDOW_MS = 90_000'), 'must define the 90s agent freshness window');
assert(printerSrc.includes('export function isAgentHeartbeatFresh'), 'must export isAgentHeartbeatFresh');
assert(printerSrc.includes('export async function isPrintAgentOnline'), 'must export isPrintAgentOnline');
assert(
  printerSrc.includes("from('shops')") && printerSrc.includes('last_active_at'),
  'presence probe must read shops.last_active_at (the agent heartbeat)'
);
assert(queueSrc.includes('isPrintAgentOnline'), 'queue must probe fleet presence');
assert(
  queueSrc.indexOf('agentOnlineRef.current') < queueSrc.indexOf('const printed = triggerPrint(order)'),
  'the agent hand-off must be decided BEFORE the browser print fires (double-print fence)'
);
assert(queueSrc.includes('sent to the print agent'), 'queue must report the hand-off instead of claiming a browser print');
/* Counted, not just present: the status bar shipped with this badge twice at
 * one point, and a duplicate is invisible to a plain includes() check. */
const fleetBadgeCount = queueSrc.split("agentOnline ? 'Fleet agent' : 'Browser print'").length - 1;
assert(
  fleetBadgeCount === 1,
  `queue must render exactly ONE fleet/browser status badge (found ${fleetBadgeCount})`
);
assert(
  !modalSrc.includes("createElement('iframe')"),
  'preview modal must delegate to triggerSilentPrint, not hand-roll a print frame'
);
assert(modalSrc.includes('triggerSilentPrint'), 'preview modal must use the shared print path');

assert(dashboardSrc.includes('isAutoPrintEnabled') && dashboardSrc.includes('setAutoPrintEnabled'), 'dashboard toggle must use the shared helpers');
assert(dashboardSrc.includes("addEventListener('storage'") && dashboardSrc.includes('AUTO_PRINT_KEY'), 'dashboard toggle must mirror the flag from other tabs');
assert(queueSrc.includes("addEventListener('storage'"), 'queue must mirror the flag from other tabs');
assert(!dashboardSrc.includes("getItem('printx_auto_print') === '1'"), 'dashboard must not keep its own ad-hoc flag read');
assert(!dashboardSrc.includes("localStorage.setItem('printx_auto_print'"), 'dashboard must not keep its own ad-hoc flag write');

console.log('OK source contract — helper exports, hidden iframe, shared flag, queue wiring');

/* ------------------------------------------------------------------ *
 * 2) Behaviour (module imported with a DOM stub)
 * ------------------------------------------------------------------ */
const frames = [];
let openCalls = 0;
let printCalls = 0;
let printThrows = false;

function makeFrame() {
  const frame = {
    style: {},
    src: undefined,
    srcdoc: undefined,
    removed: false,
    attrs: {},
    setAttribute(k, v) {
      this.attrs[k] = v;
    },
    remove() {
      this.removed = true;
      const i = frames.indexOf(this);
      if (i !== -1) frames.splice(i, 1);
    },
    contentWindow: {
      focus() {},
      print() {
        printCalls += 1;
        if (printThrows) throw new Error('cross-origin blocked');
      },
    },
  };
  return frame;
}

const store = new Map();
global.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  },
  CustomEvent: class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  },
  addEventListener() {},
  removeEventListener() {},
  open() {
    openCalls += 1;
  },
  dispatchEvent() {},
};
global.document = {
  body: {
    appendChild(el) {
      frames.push(el);
      // The browser fires load once the document is available.
      setTimeout(() => el.onload?.(), 0);
      return el;
    },
  },
  createElement: () => makeFrame(),
  hasFocus: () => true,
};

// Node treats .js as CJS here (package.json has no "type":"module"), so copy
// the real source to a temp .mjs file and import that.
const tmpPath = join(os.tmpdir(), `printx-printer-${process.pid}.mjs`);
writeFileSync(tmpPath, printerSrc, 'utf8');
let printer;
try {
  printer = await import(pathToFileURL(tmpPath).href);
} finally {
  rmSync(tmpPath, { force: true });
}

const {
  triggerSilentPrint,
  printHtmlDocument,
  isPrintableUrl,
  isAutoPrintEnabled,
  setAutoPrintEnabled,
  isAgentHeartbeatFresh,
  isPrintAgentOnline,
  buildTestPrintPage,
  AUTO_PRINT_KEY,
  AGENT_ONLINE_WINDOW_MS,
} = printer;

assert.strictEqual(typeof triggerSilentPrint, 'function', 'triggerSilentPrint must be a function');
assert.strictEqual(AUTO_PRINT_KEY, 'printx_auto_print', 'shared key mismatch');

/* Invalid input never prints and never throws */
assert.strictEqual(triggerSilentPrint(), false, 'no URL → false');
assert.strictEqual(triggerSilentPrint(''), false, 'empty URL → false');
assert.strictEqual(triggerSilentPrint('/uploads/a.pdf'), false, 'relative storage path → false');
assert.strictEqual(triggerSilentPrint('not a url'), false, 'garbage URL → false');
assert.strictEqual(frames.length, 0, 'invalid URLs must not append a frame');
assert.strictEqual(isPrintableUrl('https://x.supabase.co/a.pdf'), true, 'https is printable');
assert.strictEqual(isPrintableUrl('http://printer.local/a.pdf'), true, 'http is printable');
assert.strictEqual(isPrintableUrl('ftp://x/a.pdf'), false, 'non-http(s) is not printable');

/* Happy path: hidden frame → print() → onComplete(true) → self-cleaning frame */
const completions = [];
const started = triggerSilentPrint('https://files.example.com/job-1.pdf', (ok) => completions.push(ok), { lingerMs: 0 });
assert.strictEqual(started, true, 'valid URL → true');
assert.strictEqual(frames.length, 1, 'exactly one hidden frame');
assert.strictEqual(frames[0].src, 'https://files.example.com/job-1.pdf', 'frame loaded the file');
assert.strictEqual(frames[0].style.width, '0', 'frame is hidden');
assert.strictEqual(frames[0].attrs['aria-hidden'], 'true', 'frame hidden from a11y tree');

await new Promise((r) => setTimeout(r, 10));
assert.strictEqual(printCalls, 1, 'print() called once');
assert.deepStrictEqual(completions, [true], 'onComplete(true) after printing');
await new Promise((r) => setTimeout(r, 20));
assert.strictEqual(frames.length, 0, 'frame removed after the linger window');

/* Cross-origin block → new tab fallback + onComplete(false) */
printThrows = true;
const before = openCalls;
const blocked = [];
triggerSilentPrint('https://files.example.com/job-2.pdf', (ok) => blocked.push(ok), { lingerMs: 0 });
await new Promise((r) => setTimeout(r, 10));
printThrows = false;
assert.strictEqual(openCalls, before + 1, 'blocked print falls back to a new tab');
assert.deepStrictEqual(blocked, [false], 'onComplete(false) when the frame could not print');

/* HTML documents (Test Print) print through the same path */
const htmlDone = [];
assert.strictEqual(printHtmlDocument('<html><body>hi</body></html>', (ok) => htmlDone.push(ok), { lingerMs: 0 }), true, 'html → true');
await new Promise((r) => setTimeout(r, 10));
assert.strictEqual(htmlDone[0], true, 'test page printed');
assert.strictEqual(printHtmlDocument(''), false, 'empty html → false');
assert.strictEqual(printHtmlDocument(null), false, 'null html → false');

/* Auto-Print flag: canonical true/false, legacy values still readable */
assert.strictEqual(isAutoPrintEnabled(), false, 'default OFF when unset');
store.set('printx_auto_print', '1');
assert.strictEqual(isAutoPrintEnabled(), true, "legacy '1' counts as ON");
store.set('printx_auto_print', '0');
assert.strictEqual(isAutoPrintEnabled(), false, "legacy '0' counts as OFF");
setAutoPrintEnabled(true);
assert.strictEqual(store.get('printx_auto_print'), 'true', "writes 'true'");
assert.strictEqual(isAutoPrintEnabled(), true, 'round-trips ON');
setAutoPrintEnabled(false);
assert.strictEqual(store.get('printx_auto_print'), 'false', "writes 'false'");
assert.strictEqual(isAutoPrintEnabled(), false, 'round-trips OFF');

/* ------------------------------------------------------------------ *
 * Fleet presence (desktop print agent)
 * ------------------------------------------------------------------ */

assert.strictEqual(AGENT_ONLINE_WINDOW_MS, 90_000, 'freshness window is the documented 90s');
assert.strictEqual(typeof isPrintAgentOnline, 'function', 'isPrintAgentOnline must be a function');

const now = Date.now();
const secsAgo = (s) => new Date(now - s * 1000).toISOString();

/* Freshness — the agent pings every 30s, so 30s is healthy and 90s+ is not */
assert.strictEqual(isAgentHeartbeatFresh(secsAgo(1), now), true, '1s-old heartbeat → online');
assert.strictEqual(isAgentHeartbeatFresh(secsAgo(30), now), true, '30s heartbeat → online');
assert.strictEqual(isAgentHeartbeatFresh(secsAgo(85), now), true, '85s → still online');
assert.strictEqual(isAgentHeartbeatFresh(secsAgo(95), now), false, '95s → offline');
assert.strictEqual(isAgentHeartbeatFresh(secsAgo(600), now), false, '10min-stale → offline');
assert.strictEqual(isAgentHeartbeatFresh(new Date(now - 1000), now), true, 'Date instance accepted');
assert.strictEqual(isAgentHeartbeatFresh(null, now), false, 'null → offline');
assert.strictEqual(isAgentHeartbeatFresh(undefined, now), false, 'undefined → offline');
assert.strictEqual(isAgentHeartbeatFresh('', now), false, 'empty string → offline');
assert.strictEqual(isAgentHeartbeatFresh('not a date', now), false, 'garbage → offline');
assert.strictEqual(isAgentHeartbeatFresh(new Date(now + 30 * 60_000).toISOString(), now), false, 'future stamp (clock skew) → offline');

/* Probe — a fresh heartbeat hands the job to the agent */
const shopsClient = (lastActiveAt, error = null) => ({
  from: () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: error ? null : { last_active_at: lastActiveAt }, error }),
      }),
    }),
  }),
});

assert.strictEqual(await isPrintAgentOnline(shopsClient(secsAgo(5)), 'shop-1'), true, 'fresh heartbeat → agent online');
assert.strictEqual(await isPrintAgentOnline(shopsClient(secsAgo(180)), 'shop-1'), false, 'stale heartbeat → agent offline');
assert.strictEqual(await isPrintAgentOnline(shopsClient(null), 'shop-1'), false, 'row exists but never pinged → offline');

/* Every unprovable case must fall back to the browser, never drop the job */
assert.strictEqual(await isPrintAgentOnline(null, 'shop-1'), false, 'no supabase client → browser fallback');
assert.strictEqual(await isPrintAgentOnline(shopsClient(secsAgo(5)), ''), false, 'no shop id → browser fallback');
assert.strictEqual(await isPrintAgentOnline(shopsClient(secsAgo(5)), null), false, 'null shop id → browser fallback');
assert.strictEqual(
  await isPrintAgentOnline({ from: () => { throw new Error('RLS denied'); } }, 'shop-1'),
  false,
  'thrown read error → browser fallback'
);

/* A missing column latches the probe off. Asserted LAST because it disables
 * further probing for the rest of this module instance — and it is the case a
 * deployment without 20260928_agent_heartbeat.sql actually hits, where
 * re-asking every poll would fire a 400 every 20s for the life of the tab. */
const countingClient = () => {
  const c = {
    calls: 0,
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            c.calls += 1;
            return { data: null, error: { message: 'column shops.last_active_at does not exist', code: '42703' } };
          },
        }),
      }),
    }),
  };
  return c;
};

const first = countingClient();
assert.strictEqual(await isPrintAgentOnline(first, 'shop-1'), false, 'missing column → browser fallback');
assert.strictEqual(first.calls, 1, 'the probe asks once');

const second = countingClient();
assert.strictEqual(await isPrintAgentOnline(second, 'shop-1'), false, 'still offline once the column is proven absent');
assert.strictEqual(second.calls, 0, 'no further probe requests are made after the column is known missing');

/* Test page content */
const page = buildTestPrintPage({ shopName: 'Sharma Xerox', printerName: 'HP LaserJet' });
assert(page.includes('Sharma Xerox') && page.includes('HP LaserJet'), 'test page names shop + printer');
assert(page.includes('PRINTX PRINTER TEST'), 'test page is identifiable');
assert(page.includes('Auto-Print Mode</span><span>ON') || page.includes('Auto-Print Mode'), 'test page reports the mode');

console.log('OK behaviour — hidden iframe print, fallback tab, self-cleanup, flag persistence');
console.log('OK printer contract check passed');
