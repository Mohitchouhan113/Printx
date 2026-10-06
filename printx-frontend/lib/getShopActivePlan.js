/**
 * getShopActivePlan — server-side helper (API routes only).
 *
 * Fetches the active plan row from the `plans` table for a given shopId.
 * Falls back to the 'free' plan if the subscription is expired or unset.
 * Uses progressive-column-drop so new quota columns (max_printers,
 * max_orders_monthly, has_whatsapp_bot, has_analytics, has_custom_poster)
 * degrade gracefully when the migration hasn't been applied yet.
 *
 * Fail-open design: if the DB is unreachable or plans table is missing,
 * returns FREE_PLAN_DEFAULTS with unlimited (-1) quotas so no vendor is
 * wrongly blocked due to an infrastructure issue.
 */
import { supabaseAdmin, isSupabaseAdminConfigured } from './supabaseAdmin';
import { PLANS } from './plans';

/** Hard-coded free-plan defaults — used when the DB is unreachable. */
export const FREE_PLAN_DEFAULTS = {
  planId: 'free',
  max_printers: 1,
  max_orders_monthly: 50,
  has_whatsapp_bot: false,
  has_analytics: false,
  has_custom_poster: false,
  is_lifetime: false,
  expires_at: null,
};

/**
 * Returns the active plan row merged with quota/feature fields for a shop.
 *
 * @param {string} shopId - shops.id (UUID)
 * @returns {Promise<{
 *   planId: string,
 *   max_printers: number,        // -1 = unlimited; null from DB → -1 (fail-open)
 *   max_orders_monthly: number,  // -1 = unlimited
 *   has_whatsapp_bot: boolean,
 *   has_analytics: boolean,
 *   has_custom_poster: boolean,
 *   is_lifetime: boolean,
 *   expires_at: string|null
 * }>}
 */
export async function getShopActivePlan(shopId) {
  // Demo mode — Supabase not configured
  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    return { ...FREE_PLAN_DEFAULTS };
  }

  try {
    // ---- 1. Fetch shop subscription state ----
    const { data: shop, error: shopErr } = await supabaseAdmin
      .from('shops')
      .select('subscription_plan, subscription_expires_at, is_lifetime')
      .eq('id', shopId)
      .maybeSingle();

    if (shopErr) {
      console.warn('[getShopActivePlan] shops fetch error — failing open:', shopErr.message);
      return { ...FREE_PLAN_DEFAULTS };
    }

    // ---- 2. Determine effective plan id ----
    const now = Date.now();
    let planId = 'free';
    let isLifetime = false;
    let expiresAt = null;

    if (shop) {
      // is_lifetime may be missing (progressive-drop) — treat null as false
      isLifetime = shop.is_lifetime === true;
      expiresAt = shop.subscription_expires_at || null;

      const rawPlan = shop.subscription_plan || 'free';
      const isExpired =
        !isLifetime &&
        rawPlan !== 'lifetime' &&
        expiresAt != null &&  // null-expiry = indefinite access (admin backdoor)
        new Date(expiresAt).getTime() < now;
      // DELIBERATE: when subscription_expires_at is NULL on a paid plan,
      // the shop keeps its paid plan indefinitely. This is an admin backdoor:
      // setting subscription_expires_at = null grants permanent access
      // (useful for manual grants, beta testers, or resolving billing issues).
      // Only an explicit past timestamp triggers a downgrade to 'free'.

      planId = isExpired ? 'free' : (rawPlan || 'free');
      if (planId === 'lifetime') isLifetime = true;
    }

    // ---- 3. Fetch quota columns from plans table ----
    const { data: planRow, error: planErr } = await supabaseAdmin
      .from('plans')
      .select('max_printers, max_orders_monthly, has_whatsapp_bot, has_analytics, has_custom_poster')
      .eq('code', planId)
      .maybeSingle();

    // If the plans table is missing the new columns (PGRST204/42703) or
    // the table itself doesn't exist, fall back to the static PLANS catalog.
    if (planErr) {
      console.warn('[getShopActivePlan] plans fetch error — using static fallback:', planErr.message);
      const staticPlan = PLANS[planId] || PLANS.free;
      return {
        planId,
        // Integer quotas: null → -1 (fail-open / unlimited)
        max_printers:       staticPlan.max_printers       ?? -1,
        max_orders_monthly: staticPlan.max_orders_monthly ?? -1,
        // Boolean flags: null → true (fail-open / enabled)
        has_whatsapp_bot:   staticPlan.has_whatsapp_bot   ?? true,
        has_analytics:      staticPlan.has_analytics       ?? true,
        has_custom_poster:  staticPlan.has_custom_poster   ?? true,
        is_lifetime: isLifetime,
        expires_at: expiresAt,
      };
    }

    // ---- 4. Merge DB row with safe defaults ----
    // New quota columns may still be NULL when migration hasn't run.
    // Integer quotas: null → -1 (unlimited / fail-open)
    // Boolean flags:  null → true (enabled / fail-open)
    const staticPlan = PLANS[planId] || PLANS.free;

    return {
      planId,
      max_printers: planRow?.max_printers       ?? staticPlan.max_printers       ?? -1,
      max_orders_monthly: planRow?.max_orders_monthly ?? staticPlan.max_orders_monthly ?? -1,
      has_whatsapp_bot: planRow?.has_whatsapp_bot ?? staticPlan.has_whatsapp_bot ?? true,
      has_analytics:    planRow?.has_analytics    ?? staticPlan.has_analytics    ?? true,
      has_custom_poster: planRow?.has_custom_poster ?? staticPlan.has_custom_poster ?? true,
      is_lifetime: isLifetime,
      expires_at: expiresAt,
    };
  } catch (err) {
    // Any unexpected error → fail-open with free plan
    console.error('[getShopActivePlan] unexpected error — failing open:', err?.message || err);
    return { ...FREE_PLAN_DEFAULTS };
  }
}
