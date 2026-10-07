/**
 * activeSubscription — CLIENT-side helper for reading the shop's active
 * `subscriptions` row from the browser (anon Supabase client).
 *
 * Used by the printers page (max_printers gate) and the analytics page
 * (has_analytics gate) so feature checks read the SAME entitlement snapshot
 * the server writes at payment/assignment time — with graceful fallbacks:
 * RLS denial, missing table, or missing columns ⇒ returns null and the
 * caller falls back to the plans catalog / static lib/plans.js tier.
 *
 * Never throws — every failure path logs a warning and returns null.
 */
import { supabase, isSupabaseConfigured } from './supabaseClient';
import { pickActiveSubscription } from './subscriptionLimits';

/**
 * Fetch THE active subscriptions row for a shop.
 *
 * @param {string} shopId                - shops.id (uuid)
 * @param {string|null} [expectedPlanId] - effective plan id; rows from a
 *                                         different plan are treated as stale
 *                                         and ignored (returns null)
 * @returns {Promise<object|null>}       - the active row, or null
 */
export async function fetchActiveSubscription(shopId, expectedPlanId = null) {
  if (!shopId || !isSupabaseConfigured || !supabase) return null;
  try {
    // select('*') + NO ORDER BY — ordering/filtering on a column this
    // deployment lacks would 400 the whole query; pickActiveSubscription
    // sorts and filters in JS instead (shared with the server helper).
    const { data, error } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('shop_id', shopId)
      .limit(20);

    if (error) {
      console.warn('[activeSubscription] fetch failed — falling back to plans catalog:', error.message);
      return null;
    }

    const picked = pickActiveSubscription(data || [], expectedPlanId);
    if (!picked) return null;
    // Stale-row guard: a row from another plan must not gate this plan's
    // features (the caller falls back to the plans catalog instead).
    if (
      expectedPlanId &&
      String(picked.plan_id || '').toLowerCase() !== String(expectedPlanId).toLowerCase()
    ) {
      return null;
    }
    return picked;
  } catch (err) {
    console.warn('[activeSubscription] fetch threw — falling back to plans catalog:', err?.message || err);
    return null;
  }
}
