/**
 * subscriptionLimits — shared helpers for reading feature-limit columns off
 * `subscriptions` rows. Pure functions, NO Supabase import, so both the
 * server helper (lib/getShopActivePlan, service role) and browser code
 * (printers page, analytics gate) resolve limits with identical semantics.
 *
 * WHY: a subscriptions row written before the limit-columns migration has
 * NULL in (or is entirely missing) max_printers / max_pages / has_* flags.
 * Every reader merges per-column: subscription value → plans catalog →
 * static lib/plans.js fallback → fail-open default. A NULL in one column
 * never zeroes out the others.
 */

/** Limit/feature columns a subscriptions row is expected to carry. */
export const SUBSCRIPTION_LIMIT_FIELDS = [
  'max_printers',
  'max_pages',
  'max_orders_monthly',
  'has_whatsapp_bot',
  'has_analytics',
  'has_custom_poster',
];

/**
 * Statuses that count as a live entitlement. A row with no status column
 * (schema drift — the column was dropped by progressive fallback) passes.
 */
const ACTIVE_STATUSES = new Set(['paid', 'active', 'trialing', 'success', 'succeeded', 'granted', '']);

/** A subscription row is active when paid AND its end_date hasn't passed.
 * end_date = NULL means indefinite (lifetime plans / admin grants). */
export function isSubscriptionRowActive(row, now = Date.now()) {
  if (!row) return false;
  const status = String(row.status ?? '').toLowerCase();
  if (!ACTIVE_STATUSES.has(status)) return false;
  if (row.end_date == null || row.end_date === '') return true; // lifetime / open-ended
  const endMs = new Date(row.end_date).getTime();
  return !Number.isFinite(endMs) || endMs >= now;
}

/** Recency rank for sorting active rows (created_at → start_date → end_date). */
function rowTimestamp(row) {
  const raw = row?.created_at || row?.start_date || row?.end_date;
  const ms = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Pick THE active subscription row for a shop from a candidate list.
 * Preference: (1) rows matching the expected plan id, (2) the newest row.
 * Returns null when no row is active — callers then fall back to the plans
 * catalog / static 'free' tier limits.
 *
 * @param {Array<object>} rows       - candidate subscriptions rows (any shape)
 * @param {string|null}  [planId]    - expected effective plan id (optional)
 * @param {number}       [now]       - epoch ms (injectable for tests)
 */
export function pickActiveSubscription(rows, planId = null, now = Date.now()) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const active = rows.filter((r) => isSubscriptionRowActive(r, now));
  if (active.length === 0) return null;

  let best = null;
  let bestScore = null;
  for (const row of active) {
    const planMatch = planId && String(row.plan_id || '').toLowerCase() === String(planId).toLowerCase() ? 1 : 0;
    const score = [planMatch, rowTimestamp(row)];
    if (
      bestScore === null ||
      score[0] > bestScore[0] ||
      (score[0] === bestScore[0] && score[1] > bestScore[1])
    ) {
      best = row;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Merge an active subscriptions row over a fallback limit object,
 * per column: row value (when not null/undefined) wins, anything the
 * row doesn't carry inherits the fallback. Fallback should already be
 * plans-table → static-catalog resolved by the caller.
 */
export function mergeSubscriptionLimits(subRow, fallback = {}) {
  const merged = { ...fallback };
  if (subRow) {
    for (const field of SUBSCRIPTION_LIMIT_FIELDS) {
      const value = subRow[field];
      if (value !== undefined && value !== null) merged[field] = value;
    }
  }
  return merged;
}

/** Normalise an integer quota: null/undefined → fallback, anything < 0 → -1 (unlimited). */
export function normalizeQuota(value, fallback = -1) {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return n < 0 ? -1 : Math.floor(n);
}
