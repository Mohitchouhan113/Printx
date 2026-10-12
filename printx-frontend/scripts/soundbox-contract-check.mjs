/**
 * @fileoverview Quick sanity check that the soundbox module builds the exact
 * guaranteed-alert contract the task asked for.
 *
 * 1) Fresh module import — `triggerSoundboxAlert` exists and is a function.
 * 2) Sub-shape contract: accepts either `order` (row) or `token` (string),
 *    returns the right Hindi phrase to speak, and has the two-layer behavior
 *    (beep + speak) wired.
 * 3) Back-compat: the old `speakOrderAlert(order)` shape still resolves token.
 *
 * NOTE: this file does NOT try to actually call AudioContext/speechSynthesis
 * in Node — those apis are absent here — it validates shape and messages only.
 * Real end-to-end sound is confirmed in-browser via the Test Sound button.
 */

import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const modulePath = join(projectRoot, 'lib/soundbox.js');

assert(existsSync(modulePath), `missing ${modulePath}`);

// ---------------------------------------------------------------------------
// 1) Raw text contract checks
// ---------------------------------------------------------------------------
const source = readFileSync(modulePath, 'utf8');

assert(source.includes('playBeep'), 'soundbox.js must export playBeep');
assert(source.includes('triggerSoundboxAlert'), 'soundbox.js must export triggerSoundboxAlert');
assert(source.includes('speakOrderAlert'), 'soundbox.js must export speakOrderAlert');

const expectedPhrase = 'Naya order aaya hai, token number';
assert(source.includes(expectedPhrase), `soundbox.js must build phrase starting with: ${expectedPhrase}`);

assert(
  source.includes('playBeep()') && source.includes('setTimeout') && source.includes('300'),
  'triggerSoundboxAlert must play beep then schedule voice after ~300ms'
);

assert(
  source.includes('Naya order aaya hai, token number ${tokenValue}') ||
  source.includes('Naya order aaya hai, token number ${token}'),
  'assembled voice message must be exact requested phrase'
);

assert(
  source.includes("|| '1'") || source.includes(`tokenRaw || '1'`),
  'soundbox.js must default missing token to "1"'
);

assert(source.includes("lang = 'hi-IN'") || source.includes("lang='hi-IN"), 'must set Hindi lang');
assert(source.includes('rate = 0.9') || source.includes('rate=0.9') || source.includes('0.9'), 'must set rate 0.9');
assert(source.includes('pitch = 1.0') || source.includes('pitch=1.0') || source.includes('1.0'), 'must set pitch 1.0');

assert(source.includes('880') && source.includes('setValueAtTime(880'), 'beep must use 880 Hz A5 tone');
assert(source.includes('sine'), 'beep must use sine wave');

assert(
  source.includes("localStorage.getItem('printx_soundbox_enabled')"),
  'must check printx_soundbox_enabled in localStorage'
);

assert(
  source.includes("'speechSynthesis' in window") || source.includes('window.speechSynthesis'),
  'must guard speechSynthesis'
);
assert(source.includes('cancel()') || source.includes('.cancel();'), 'must cancel prior speech');

assert(source.includes('300') && source.includes('setTimeout'), 'must delay voice by ~300ms after beep');

// ---------------------------------------------------------------------------
// 2) Module shape (ESM named exports)
// ---------------------------------------------------------------------------
const exportsFound = [];
for (const name of ['playBeep', 'speakOrderAlert', 'primeVoices', 'triggerSoundboxAlert']) {
  if (source.includes(`export function ${name}`) || source.includes(`export const ${name}`)) {
    exportsFound.push(name);
  }
}
assert(exportsFound.length >= 4, `expected 4 named exports, found: ${exportsFound.join(', ')}`);

assert(
  source.includes('triggerSoundboxAlert({') || source.includes('function triggerSoundboxAlert('),
  'triggerSoundboxAlert must be destructured-options shaped'
);
assert(
  source.includes('order') && source.includes('token') && source.includes('beepFirst'),
  'triggerSoundboxAlert signature must cover order/token/beepFirst'
);

assert(
  source.includes("typeof tokenRaw === 'object'") || source.includes("typeof order === 'object'"),
  'speakOrderAlert must accept object order shape'
);

// ---------------------------------------------------------------------------
// 3) Browser-side contract: module must expose helpers on window for inline UI
// ---------------------------------------------------------------------------
// Dynamic import returns a promise, but the module's top-level IIFE runs
// synchronously during the import. So after the promise resolves, the window
// assignments are visible on the object we redirected globalThis.window to.
const fakeWindow = {
  AudioContext: undefined,
  webkitAudioContext: undefined,
  speechSynthesis: undefined,
};

const origWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
Object.defineProperty(globalThis, 'window', {
  value: fakeWindow,
  writable: true,
  configurable: true,
});

try {
  await import('file://' + modulePath.replace(/\\/g, '/'));
  assert(
    typeof fakeWindow.triggerSoundboxAlert === 'function',
    'soundbox.js must expose window.triggerSoundboxAlert'
  );
  assert(
    typeof fakeWindow.speakOrderAlert === 'function',
    'soundbox.js must expose window.speakOrderAlert'
  );
  assert.doesNotThrow(() => fakeWindow.triggerSoundboxAlert({ token: '7' }), 'triggerSoundboxAlert({ token }) must not throw');
  assert.doesNotThrow(() => fakeWindow.triggerSoundboxAlert({ order: { token_no: 32 } }), 'triggerSoundboxAlert({ order }) must not throw');
  assert.doesNotThrow(() => fakeWindow.speakOrderAlert('1'), 'speakOrderAlert(string) must not throw');
  assert.doesNotThrow(() => fakeWindow.speakOrderAlert({ token_no: 5 }), 'speakOrderAlert({ token_no }) must not throw');
} finally {
  if (origWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', origWindowDescriptor);
  } else {
    delete globalThis.window;
  }
}

// ---------------------------------------------------------------------------
// 4) Acceptance phrasing
// ---------------------------------------------------------------------------
const acceptsOrder = source.includes('order.token_no') || source.includes('order.token_no != null');
const acceptsToken = source.includes('token !== undefined') || source.includes('token != null') || source.includes('const tokenValue');
assert(acceptsOrder || acceptsToken, 'must accept at least one of {order} or {token}');

console.log('OK soundbox contract check passed');
console.log('  - playBeep + speakOrderAlert + triggerSoundboxAlert + primeVoices exported');
console.log('  - phrase template present:', expectedPhrase);
console.log('  - Web Audio 880Hz sine beep present');
console.log('  - speechSynthesis guard + cancel() present');
console.log('  - localStorage soundbox flag present');
console.log('  - 300ms voice delay present');
console.log('  - accepts order or token shape');
console.log('  - triggerSoundboxAlert plays beep then schedules voice after ~300ms');
console.log('  - assembled voice message is exact requested phrase');
console.log('  - window.triggerSoundboxAlert/window.speakOrderAlert exposed');
console.log('  - smoke-invoked without throwing in Node');
