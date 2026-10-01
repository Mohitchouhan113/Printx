/**
 * upiIntent — NPCI UPI deep-link generation + app launch helpers.
 *
 * Direct UPI app deep-linking lets a customer pay without typing a UTR:
 * the checkout builds one canonical `upi://pay?…` string (pa/pn/am/tr/tn/cu)
 * and wraps it in an app-specific scheme for one-tap launch:
 *
 *   PhonePe      phonepe://pay?pa=…&pn=…&am=…&tr=…&tn=…&cu=INR
 *   Google Pay   gpay://upi/pay?pa=…&pn=…&am=…&tr=…&tn=…&cu=INR
 *   Paytm/Any    upi://pay?pa=…            (system UPI chooser on Android)
 *
 * Query is built with explicit `encodeURIComponent` (not URLSearchParams)
 * because URLSearchParams serialises spaces as `+`, which some UPI apps
 * parse literally inside the `tn` narration field.
 */

/** One-tap brand buttons rendered on the checkout (mobile). */
export const UPI_APPS = [
  { id: 'phonepe', label: 'PhonePe', scheme: 'phonepe://pay', color: '#5F259F', emoji: '💜' },
  { id: 'gpay', label: 'Google Pay', scheme: 'gpay://upi/pay', color: '#1A73E8', emoji: '🅶' },
  { id: 'paytm', label: 'Paytm / Any UPI', scheme: null, color: '#00BAF2', emoji: '🇮🇳' },
];

/** Fallback VPA when the shop record has none configured. */
export function fallbackUpiId(slug) {
  return `${slug || 'printx'}@upi`;
}

/**
 * Build the standard NPCI UPI intent URL.
 *
 * @param {Object} p
 * @param {string} p.pa       shop VPA (upi_id)
 * @param {string} p.pn       payee name (shop name)
 * @param {number|string} p.am amount in ₹ (exact)
 * @param {string} p.ref      transaction ref (tr) — the order id
 * @param {string} p.note     narration (tn)
 * @param {string} [p.appId]  'phonepe' | 'gpay' | 'paytm' | anything else → generic upi://
 * @returns {string} deep-link URL
 */
export function buildUpiIntentUrl({ pa, pn, amount, ref, note, appId } = {}) {
  const q =
    `pa=${encodeURIComponent(pa || '')}` +
    `&pn=${encodeURIComponent(pn || 'PrintX Shop')}` +
    `&am=${encodeURIComponent(String(amount ?? ''))}` +
    `&tr=${encodeURIComponent(String(ref ?? ''))}` +
    `&tn=${encodeURIComponent(note || 'PrintX Order')}` +
    '&cu=INR';

  const app = UPI_APPS.find((a) => a.id === appId);
  if (app?.scheme) return `${app.scheme}?${q}`;
  return `upi://pay?${q}`;
}

/** True when the current device can open UPI apps (phones/tablets). */
export function prefersUpiApps() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const uaMobile = /Android|iPhone|iPad|iPod|Windows Phone|Mobile/i.test(ua);
  // Narrow windows (phone-sized viewport) also get app buttons so the flow
  // is testable in responsive desktop browsers.
  const narrow = typeof window !== 'undefined' && window.innerWidth < 768;
  return uaMobile || narrow;
}

/**
 * Hand the URL to the native UPI app.
 *
 * Android/iOS handle custom schemes from a top-level `location.href`
 * assignment; iOS Safari additionally needs the hidden-iframe bounce for
 * async (post-await) navigation, which is exactly where we launch after the
 * draft order upload finishes.
 *
 * Test hook: assign `window.__printx_upi_launcher = (url) => bool` to
 * capture the launch instead of navigating.
 *
 * @returns {boolean} true when a launch was attempted
 */
export function launchUpiIntent(url) {
  if (typeof window === 'undefined' || !url) return false;
  if (typeof window.__printx_upi_launcher === 'function') {
    return Boolean(window.__printx_upi_launcher(url));
  }
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  try {
    if (isIOS) {
      const ifr = document.createElement('iframe');
      ifr.style.display = 'none';
      ifr.style.width = '1px';
      ifr.style.height = '1px';
      ifr.src = url;
      document.body.appendChild(ifr);
      setTimeout(() => {
        try { ifr.remove(); } catch { /* noop */ }
      }, 3000);
    } else {
      window.location.href = url;
    }
    return true;
  } catch {
    // Unknown scheme on this device — caller falls back to QR / copy-link.
    return false;
  }
}
