/**
 * One-shot first-interaction audio unlock.
 *
 * Browsers block AudioContext creation/resume and HTMLMediaElement play()
 * until the user has performed a gesture on the page. The queue chimes call
 * ctx.resume() themselves, but a resume() issued BEFORE any gesture is
 * silently ignored — so the first incoming-order alert of a session was
 * dropped even though ensureCtx() "succeeded".
 *
 * Components register the callback that (re)creates/resumes their audio on
 * mount; the first pointerdown/keydown/touchstart anywhere runs them all
 * inside the gesture and the listeners are removed. A callback registered
 * after that point runs immediately (the browser considers the session
 * user-activated from then on).
 */

const GESTURE_EVENTS = ['pointerdown', 'keydown', 'touchstart'];

const pending = new Set();
let listening = false;
let unlocked = false;

function flush() {
  unlocked = true;
  stop();
  for (const fn of [...pending]) {
    pending.delete(fn);
    try {
      fn();
    } catch {
      /* one broken unlock must not block the rest */
    }
  }
}

function stop() {
  if (!listening) return;
  listening = false;
  GESTURE_EVENTS.forEach((ev) => window.removeEventListener(ev, flush, true));
}

function start() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  GESTURE_EVENTS.forEach((ev) => window.addEventListener(ev, flush, true));
}

/**
 * Run `fn` on the first user gesture of the session (immediately if one
 * already happened). Returns an unsubscribe function (for effect cleanup).
 */
export function onAudioUnlock(fn) {
  if (typeof window === 'undefined' || typeof fn !== 'function') return () => {};
  if (unlocked) {
    try {
      fn();
    } catch {
      /* audio unavailable — never block the UI */
    }
    return () => {};
  }
  pending.add(fn);
  start();
  return () => pending.delete(fn);
}

/** Whether a first gesture has already unlocked the session. */
export function isAudioUnlocked() {
  return unlocked;
}
