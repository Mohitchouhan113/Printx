/**
 * subscription — SaaS subscription state for the vendor platform.
 *
 * shops.subscription_status is the source of truth once the admin has set
 * it ('active' | 'trial' | 'expired'). Before the migration
 * `supabase/migrations/20260928_core_features.sql` runs the column doesn't
 * exist — resolveSubscriptionState then derives a CONSERVATIVE state from
 * the columns that do exist so no live vendor is ever locked by accident:
 * only an explicit 'expired' (or a trial whose trial_ends_at has passed)
 * locks the dashboard.
 */

export const SUBSCRIPTION_STATUSES = ['active', 'trial', 'expired'];

/** True when an ISO date is present and in the past. */
function isPast(date) {
  if (!date) return false;
  const t = new Date(date).getTime();
  return Number.isFinite(t) && t < Date.now();
}

/**
 * @param {Object|null} shop — the shops row (tolerates missing columns)
 * @returns {{ status: 'active'|'trial'|'expired', expired: boolean,
 *             plan: string|null, trialEndsAt: string|null,
 *             expiresAt: string|null, locked: boolean, reason: string|null }}
 */
export function resolveSubscriptionState(shop) {
  if (!shop) {
    return {
      status: 'active', expired: false, plan: null, trialEndsAt: null,
      expiresAt: null, locked: false, reason: null,
    };
  }

  const plan = shop.subscription_plan || shop.plan_type || null;
  const trialEndsAt = shop.trial_ends_at || null;
  const expiresAt = shop.subscription_expires_at || shop.plan_expires_at || null;
  const explicit = String(shop.subscription_status || '').toLowerCase();

  let status;
  if (explicit === 'expired' || explicit === 'active' || explicit === 'trial') {
    status = explicit;
    // A trial whose window ended behaves like an expired subscription.
    if (status === 'trial' && isPast(trialEndsAt)) status = 'expired';
  } else {
    // Column missing / never set — derive from the legacy expiry columns.
    // NULL dates never lock (every live shop today has NULL expiries), so
    // this can only fire on a deliberately past-dated subscription.
    status = isPast(expiresAt) || (trialEndsAt && isPast(trialEndsAt)) ? 'expired' : 'active';
  }

  const expired = status === 'expired';
  const reason = expired
    ? explicit !== 'expired' && trialEndsAt && isPast(trialEndsAt) && !isPast(expiresAt)
      ? 'Free trial ended'
      : 'Platform subscription expired'
    : null;

  return {
    status,
    expired,
    locked: expired,
    plan,
    trialEndsAt,
    expiresAt,
    reason,
  };
}

/** Human labels/badges shared by the admin panel and the vendor shell. */
export const SUBSCRIPTION_META = {
  active: { label: 'Active', className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  trial: { label: 'Trial', className: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  expired: { label: 'Expired', className: 'bg-red-500/15 text-red-300 border-red-500/30' },
};
