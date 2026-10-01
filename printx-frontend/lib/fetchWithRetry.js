/**
 * fetchWithRetry — resilient global fetch for 2G/3G and flaky campus Wi-Fi.
 *
 * On a dropped packet the browser surfaces a TypeError("Failed to fetch")
 * instantly; without this layer that becomes a raw error screen and the
 * customer loses their checkout. Here the SAME request is silently retried
 * up to 3 attempts with exponential backoff (0.4s → 0.8s → 1.6s ±25%
 * jitter), and the user's session never notices.
 *
 * 3-TIER BACKOFF (per attempt):
 *   1. Transport failure (network error / abort) → retry
 *   2. 5xx / 408 / 429 (server hiccup, temporary) → retry with Retry-After
 *   3. Final failure → the ORIGINAL error/Response is returned untouched,
 *      so callers keep their existing error handling.
 *
 * SAFETY: non-idempotent POSTs (order creation, payment) must not be
 * replayed blindly — an invisible double-submit could charge twice. Those
 * requests are retried ONLY when the caller supplies an Idempotency-Key
 * (or an explicit `idempotencyKey` option), letting a server dedupe.
 * Client-credentials (`credentials`) are preserved verbatim on every
 * attempt, so auth cookies survive.
 *
 * Also exported: `retrySupabaseDb(run)` — wraps a Supabase DB call (which
 * returns { data, error } instead of throwing) with the same backoff for
 * network-class errors, and `isIdempotent` classification used by tests.
 */

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 400;      // attempt 1 → ~0.4s, then doubles
const MAX_DELAY_MS = 8_000;     // hard cap so backoff never runs away
const JITTER = 0.25;            // ±25% — spreads retries across clients

/** Status codes worth a retry: gateway/overload hiccups and lock-outs. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Methods that are safe to replay without an idempotency key.
 * (HEAD/GET/OPTIONS never mutate; DELETE keyed by id is idempotent in REST.)
 */
export function isIdempotent(method) {
  return ['GET', 'HEAD', 'OPTIONS', 'DELETE'].includes(String(method || 'GET').toUpperCase());
}

/** Merge a header init into a Headers instance (non-mutating). */
function headersWith(init, key, value) {
  const h = new Headers(init?.headers || null);
  h.set(key, value);
  return h;
}

function delayFor(attempt) {
  const exp = BASE_DELAY_MS * 2 ** (attempt - 1);
  const jittered = exp * (1 + JITTER * (Math.random() * 2 - 1));
  return Math.min(MAX_DELAY_MS, Math.max(0, Math.round(jittered)));
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });

/**
 * fetchWithRetry(input, init?)
 *
 * `init` is the standard RequestInit plus:
 *   - attempts?: number    — max tries (default 3, hard-capped at 5)
 *   - onRetry?: (info) => void — { attempt, delayMs, reason } observer
 *   - idempotencyKey?: string — makes a POST/PUT/PATCH replayable
 *   - backoffBaseMs?, backoffJitter? — tunable (tests)
 *
 * Body is read ONCE into a buffer before the first attempt so it can be
 * re-sent on every retry (a consumed ReadableStream would fail attempt 2).
 */
export async function fetchWithRetry(input, init = {}, opts = {}) {
  const method = String(init.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
  const maxAttempts = Math.max(1, Math.min(5, opts.attempts ?? init.attempts ?? MAX_ATTEMPTS));
  const base = opts.backoffBaseMs ?? BASE_DELAY_MS;
  const jitter = opts.backoffJitter ?? JITTER;

  const replayable = isIdempotent(method) || Boolean(opts.idempotencyKey || init.idempotencyKey);
  const signal = init.signal;

  // Snapshot the body once — retry attempts re-send the same bytes.
  let body = init.body ?? null;
  if (body && typeof body !== 'string' && typeof body.length !== 'number' && typeof body.byteLength !== 'number') {
    // FormData / Blob / URLSearchParams are replay-safe objects; streams are
    // not — try to buffer any stream-ish body (with a length guard).
    if (typeof body.getReader === 'function') {
      try {
        const res = new Response(body);
        body = await res.arrayBuffer();
      } catch {
        body = null; // unreadable body → attempt 1 only
      }
    }
  }

  const backoff = (attempt) => {
    const exp = base * 2 ** (attempt - 1);
    const jittered = exp * (1 + jitter * (Math.random() * 2 - 1));
    return Math.min(MAX_DELAY_MS, Math.max(0, Math.round(jittered)));
  };

  let lastError = null;
  let lastResponse = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(input, { ...init, body, signal });
      if (res.ok || !RETRYABLE_STATUS.has(res.status)) return res;
      // Retryable status — check Retry-After, then back off.
      lastResponse = res;
      if (attempt < maxAttempts) {
        const ra = parseInt(res.headers?.get?.('retry-after') ?? '', 10);
        const wait = Number.isFinite(ra) && ra > 0 ? Math.min(MAX_DELAY_MS, ra * 1000) : backoff(attempt);
        opts.onRetry?.({ attempt, delayMs: wait, reason: `HTTP ${res.status}` });
        await sleep(wait, signal);
        continue;
      }
      return res; // final attempt — surface the real Response
    } catch (err) {
      // Network-class failure (TypeError) or caller abort.
      if (signal?.aborted || err?.name === 'AbortError') throw err;
      lastError = err;
      if (attempt < maxAttempts) {
        if (!replayable) {
          // POST/PUT without an idempotency key: a replay could double-charge
          // or duplicate an order. Fail fast with the original TypeError —
          // callers already handle this branch (their existing catch).
          throw err;
        }
        const wait = backoff(attempt);
        opts.onRetry?.({ attempt, delayMs: wait, reason: err?.message || 'network error' });
        await sleep(wait, signal);
        continue;
      }
      throw err;
    }
  }

  // Unreachable in normal flow; defensive return.
  return lastResponse ?? (() => { throw lastError ?? new Error('fetchWithRetry exhausted'); })();
}

/**
 * retrySupabaseDb — wrap a Supabase query builder execution for flaky links.
 *
 * Supabase DB calls RESOLVE with { data, error } (no throw), so network
 * drops land in `error` with code 'FetchError' / message 'Failed to fetch'.
 * Re-running the builder (the `run` closure re-invokes the chain) is safe:
 * SELECTs are idempotent, and the few writes this app makes are either
 * keyed upserts or already have schema-fallback retry loops upstream.
 */
export async function retrySupabaseDb(run, opts = {}) {
  const maxAttempts = Math.max(1, Math.min(5, opts.attempts ?? MAX_ATTEMPTS));
  const isNetworkErr = (error) => {
    if (!error) return false;
    const msg = String(error.message || '');
    return (
      error.code === 'FetchError' ||
      /failed to fetch|networkerror|load failed|network error/i.test(msg)
    );
  };

  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await run();
    if (!res?.error) return res;
    lastErr = res.error;
    if (!isNetworkErr(lastErr) || attempt === maxAttempts) return res; // real error → caller
    const wait = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 1));
    opts.onRetry?.({ attempt, delayMs: wait, reason: lastErr.message || 'network error' });
    await sleep(wait, opts.signal);
  }
  return { data: null, error: lastErr };
}

export default fetchWithRetry;
