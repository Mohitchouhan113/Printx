/**
 * Paytm Soundbox-style counter voice alerts — Web Speech Synthesis.
 *
 * Announces new orders in a Hindi/English (hi-IN / en-IN) voice using the
 * exact engine script:
 *
 *   "Naya order aaya hai! [Token No] number token, [Total Pages] pages,
 *    Total amount [Amount] rupees."
 *
 * Voice selection: an explicit hi-IN voice wins, then en-IN, then any
 * Hindi/English voice, then whatever the OS default is (utterance.lang
 * still steers the engine when no voice matches).
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
 * `order` is an `orders` sidecar row: token_no / token_number, pages,
 * bw_pages / color_pages and total_amount (walk-ins + new uploads set it;
 * older rows fall back to the default B&W/Color rates).
 */
export function speakOrderAlert(order = {}) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return false;

  const token =
    order.token_no != null
      ? String(order.token_no)
      : String(order.token_number || '').replace(/[^\d]/g, '') || '?';

  const pages = Number(order.pages ?? order.page_count) || 0;

  let amount = Number(order.total_amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    const bw = Number(order.bw_pages);
    const color = Number(order.color_pages);
    amount = Number.isFinite(bw) && Number.isFinite(color) ? bw * 2 + color * 10 : 0;
  }
  amount = Math.round(amount);

  const text = `Naya order aaya hai! ${token} number token, ${pages} pages, Total amount ${amount} rupees.`;

  try {
    const synth = window.speechSynthesis;
    synth.cancel(); // never queue behind a previous announcement
    const utter = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) utter.voice = voice;
    utter.lang = (voice && voice.lang) || 'hi-IN';
    utter.rate = 1;
    utter.pitch = 1;
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
