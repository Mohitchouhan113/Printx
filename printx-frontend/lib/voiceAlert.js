/**
 * Counter Soundbox voice notification — announces each new print order
 * in Hindi using Web Speech Synthesis with the exact phrase:
 *
 *   "Naya order aaya hai, token number {token_number}"
 *
 * Voice selection: an explicit hi-IN voice wins, then en-IN, then any
 * Hindi/English voice, then whatever the OS default is (utterance.lang
 * still steers the engine when no voice matches).
 *
 * Phrase style: rate 0.9 (natural), pitch 1.0, lang hi-IN.
 */

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
    const prefix = voices.find((v) => (v.lang || '').toLowerCase().startsWith(lang.slice(0, 2)));
    if (prefix) return prefix;
  }
  return null;
}

/** Chrome loads voices async — prime the list as soon as the app mounts. */
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

/**
 * Speak one order alert. Returns true when speech was dispatched.
 *
 * Uses the Counter Soundbox voice phrase:
 *   "Naya order aaya hai, token number {token_number}"
 *
 * `order` is an `orders` sidecar row: token_no / token_number.
 * The token number is extracted from token_no (daily integer) or
 * token_number (legacy string like #TK-32); non-digit characters are
 * stripped so the announcement always speaks the bare number.
 */
export function speakOrderAlert(order = {}) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return false;

  // Exact token number for the voice announcement — default to "1" when the
  // row has no token yet (e.g. an optimistic echo before the server assigns one).
  const rawToken =
    order.token_no != null
      ? String(order.token_no)
      : String(order.token_number || '').replace(/[^\d]/g, '') || '1';

  const message = `Naya order aaya hai, token number ${rawToken}`;

  try {
    const synth = window.speechSynthesis;
    synth.cancel(); // never queue behind a previous announcement

    const utter = new SpeechSynthesisUtterance(message);
    utter.lang = 'hi-IN'; // Hindi voice
    utter.rate = 0.9;     // natural speaking speed
    utter.pitch = 1.0;

    const voice = pickVoice();
    if (voice) utter.voice = voice;

    synth.speak(utter);
    return true;
  } catch (err) {
    console.warn('[voice] speakOrderAlert failed:', err?.message || err);
    return false;
  }
}

// Prime the voice list the moment this module reaches a browser.
if (typeof window !== 'undefined' && window.speechSynthesis) {
  primeVoices();
}
