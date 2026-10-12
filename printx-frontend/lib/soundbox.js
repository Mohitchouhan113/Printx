/**
 * Guarantee-of-audio alert hub for the Counter Soundbox.
 *
 * Requirement: new-print-job announcements should play SOMETHING in 100%
 * of browsers, even when Web Speech Synthesis is unavailable, blocked,
 * or missing a hi-IN voice. So this module is layered:
 *
 *  1. Web Audio API beep — guaranteed if the browser supports AudioContext
 *     (virtually all of them). No file, no network, no voice needed.
 *  2. Web Speech Synthesis Hindi announcement — the "Naya order aaya hai,
 *     token number N" voice that Paytm-style counters use.
 *  3. The caller decides the ORDER of layers; by default we play the beep
 *     first (instant) and schedule the voice ~300ms later so the two don't
 *     fight for the same "first sound" slot and the human recognizes the
 *     beep immediately while the voice reads out the token.
 *
 * Soundbox on/off is stored in localStorage under `printx_soundbox_enabled`
 * (values: 'true' | 'false'; default true if not set), and the whole app
 * toggles through the `printx:soundbox` CustomEvent so LiveQueueTable and
 * VendorShell stay in sync without importing each other.
 */

/** ---------- guaranteed audio layer: Web Audio API beep ---------- */

function audioCtx() {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  try {
    const ctx = new Ctx();
    if (ctx.state === 'suspended') {
      // Some browsers let us resume synchronously from a user gesture;
      // if not, the play still works once a gesture has happened.
      try { ctx.resume(); } catch { /* ignore */ }
    }
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Play an instant loud electronic beep using Web Audio API.
 *
 * This is the guarantee-of-sound fallback. It does NOT depend on:
 *  - any audio file
 *  - any network request
 *  - any speech voice
 *  - SpeechSynthesis being available
 *
 * Tone: A5 (880 Hz), sine, ~1.2s decay. Loud enough to be heard over a
 * shop floor but not painful. Volume is settable per call (default 0.4).
 */
export function playBeep({ volume = 0.4, durationSec = 1.2 } = {}) {
  if (typeof window === 'undefined') return;
  const ctx = audioCtx();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now); // A5 — high pitched notification tone

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + durationSec);
  } catch (e) {
    // Never let a single audio failure break the order flow.
    console.warn('[soundbox] playBeep failed:', e?.message || e);
  }
}

/** ---------- voice layer: Web Speech Synthesis Hindi ---------- */

const PREFERRED_LANGS = ['hi-IN', 'en-IN'];

function pickVoice() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null;
  let voices = [];
  try {
    voices = window.speechSynthesis.getVoices() || [];
  } catch {
    return null;
  }
  if (!voices.length) return null;
  for (const lang of PREFERRED_LANGS) {
    const exact = voices.find((v) => v.lang === lang);
    if (exact) return exact;
    const prefix = voices.find(
      (v) => (v.lang || '').toLowerCase().startsWith(lang.slice(0, 2))
    );
    if (prefix) return prefix;
  }
  return null;
}

/**
 * Speak one order alert in Hindi. Returns true when speech was dispatched.
 *
 * Phrase: "Naya order aaya hai, token number {token}"
 * Where {token} is a plain numeric string (non-digit chars stripped).
 * When the raw token is missing we default to "1" so the voice never says
 * an empty/placeholder thing.
 */
export function speakOrderAlert(tokenRaw = '') {
  if (typeof window === 'undefined' || !window.speechSynthesis) return false;

  // Back-compat: accept the old { order } shape from callers that still
  // pass a whole row. New callers should pass the token string directly.
  let token = tokenRaw;
  if (tokenRaw && typeof tokenRaw === 'object' && tokenRaw !== null) {
    const order = tokenRaw;
    token =
      order.token_no != null
        ? String(order.token_no)
        : String(order.token_number || '').replace(/[^\d]/g, '');
    token = token || '1';
  } else {
    token = String(tokenRaw || '').replace(/[^\d]/g, '');
  }
  token = token || '1';

  const message = `Naya order aaya hai, token number ${token}`;

  try {
    const synth = window.speechSynthesis;
    synth.cancel(); // never queue behind a previous announcement

    const utter = new SpeechSynthesisUtterance(message);
    utter.lang = 'hi-IN'; // Hindi voice
    utter.rate = 0.9; // natural speaking speed
    utter.pitch = 1.0;

    const voice = pickVoice();
    if (voice) utter.voice = voice;

    synth.speak(utter);
    return true;
  } catch (err) {
    console.warn('[soundbox] speakOrderAlert failed:', err?.message || err);
    return false;
  }
}

/**
 * Prime the TTS voice list the moment this module reaches a browser.
 * Chrome loads voices async, so we warm the list once and again on
 * the voiceschanged event.
 */
export function primeVoices() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener?.('voiceschanged', () => {
      window.speechSynthesis.getVoices();
    });
  } catch {
    /* voice list unavailable — utterance.lang fallback still applies */
  }
}

/** ---------- combined guaranteed alert ---------- */

/**
 * Trigger the full guaranteed Counter Soundbox alert for a new order.
 *
 * Layering (default):
 *  1. Immediate Web Audio beep (works in 100% of browsers with AudioContext)
 *  2. Hindi SpeechSynthesis announcement ~300ms later
 *
 * Both layers honor the soundbox enable/disable flag from localStorage
 * (`printx_soundbox_enabled`). Pass `token` as a numeric string (e.g. "7"
 * or "32"). Pass `order` (old shape) OR `token` (new shape) — both accepted.
 *
 * For convenience in inline UI buttons, when the browser module is loaded,
 * `window.triggerSoundboxAlert` and `window.speakOrderAlert` are set to these
 * functions so a Test Sound button can call them without importing the module.
 */
export function triggerSoundboxAlert({ order, token, beepFirst = true } = {}) {
  if (typeof window === 'undefined') return;

  // Soundbox enable/disable — default ON if nothing stored.
  // Check FIRST before any audio, so a disabled soundbox is a no-op.
  // Use window.localStorage directly so the check always sees the current
  // state (important when the flag is toggled at runtime).
  let enabled = true;
  try {
    enabled = window.localStorage.getItem('printx_soundbox_enabled') !== 'false';
  } catch {
    /* storage blocked — keep default ON for this session */
  }
  if (!enabled) {
    return;
  }

  // Accept either the old { order } row or the new { token } string.
  let tokenValue;
  if (token !== undefined) {
    tokenValue = String(token);
  } else if (order && typeof order === 'object') {
    tokenValue =
      order.token_no != null
        ? String(order.token_no)
        : String(order.token_number || '').replace(/[^\d]/g, '');
    tokenValue = tokenValue || '1';
  } else {
    tokenValue = '1';
  }

  // ---- Layer 1: guaranteed beep (Web Audio API) ----
  // Play immediately (works even before the voice is ready).
  if (beepFirst) {
    playBeep();
  }

  // ---- Layer 2: Hindi voice (Web Speech Synthesis) ----
  // Slight delay so the beep registers first and the voice doesn't compete
  // with it for the "first sound" slot.
  setTimeout(() => {
    if (typeof window === 'undefined') return;
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel(); // interrupt anything still speaking
    const msg = new SpeechSynthesisUtterance(
      `Naya order aaya hai, token number ${tokenValue}`
    );
    msg.lang = 'hi-IN';
    msg.rate = 0.9;
    msg.pitch = 1.0;

    const voice = pickVoice();
    if (voice) msg.voice = voice;

    try {
      window.speechSynthesis.speak(msg);
    } catch (e) {
      console.warn('[soundbox] speech speak failed:', e?.message || e);
    }
  }, beepFirst ? 300 : 0);
}

// Expose on window so inline UI buttons (e.g. Test Sound) can call them
// without a static import. Keeps the button implementation zero-import.
if (typeof window !== 'undefined') {
  window.triggerSoundboxAlert = triggerSoundboxAlert;
  window.speakOrderAlert = speakOrderAlert;
  window.playBeep = playBeep;
  if (window.speechSynthesis) {
    primeVoices();
  }
}
