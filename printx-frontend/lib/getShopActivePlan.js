/**
 * getShopActivePlan — server-side helper (API routes only).
 *
 * Resolves a shop's EFFECTIVE PLAN ID and its quota/feature limits.
 *
 * Effective plan id precedence:
 *   shops.subscription_plan + subscription_expires_at (admin controls,
 *   expiry, lifetime, documented null-expiry backdoor — unchanged) →
 *   active `subscriptions` purchase record when the shops row is missing →
 *   'free'.
 *
 * Limit precedence (per-column, null-tolerant — a NULL in one column never
 * zeroes out the others):
 *   1. Active `subscriptions` row for the shop whose plan_id matches the
 *      effective plan — the limit snapshot written at payment/assignment
 *      time (max_printers, max_pages, max_orders_monthly, has_* flags).
 *   2. `plans` catalog row for the effective plan code (live admin edits).
 *   3. Static lib/plans.js catalog.
 *   4. Fail-open defaults (-1 quotas, flags enabled) when the DB itself is
 *      unreachable — an infrastructure failure must never throttle a vendor
 *      to hardcoded quotas.
 *
 * Edge cases: no shops row, no active subscriptions row, or effective plan
 * 'free' ⇒ genuine 'free'-TIER limits from the catalog (1 printer,
 * 500 pages/month, no paid features) — never a silent hardcoded guess.
 *
 * Fail-open design: if the DB is unreachable or a table is missing,
 * returns FREE_PLAN_DEFAULTS (unlimited quotas) so no vendor is wrongly
 * blocked due to an infrastructure issue.
 */
import { supabaseAdmin, isSupabaseAdminConfigured } from './supabaseAdmin';
import { PLANS } from './plans';
import { pickActiveSubscription, mergeSubscriptionLimits, normalizeQuota } from './subscriptionLimits';

/**
 * Fail-open defaults — used only when Supabase is unreachable/unconfigured.
 * Deliberately NOT the 'free' tier (1 printer): an infrastructure failure
 * must not throttle shops to free quotas. Genuine free-tier shops resolve
 * planId 'free' against a working DB and get real free-tier limits below.
 */
export const FREE_PLAN_DEFAULTS = {
  planId: 'free',
  max_printers: -1,
  max_pages: -1,
  max_orders_monthly: -1,
  has_whatsapp_bot: true,
  has_analytics: true,
  has_custom_poster: true,
  is_lifetime: false,
  expires_at: null,
};

/** Static-catalog limits for an effective plan id (final fallback layer). */
function staticLimits(planId) {
  const staticPlan = PLANS[planId] || PLANS.free;
  return {
    max_printers: staticPlan.max_printers ?? -1,
    max_pages: staticPlan.max_pages ?? -1,
    max_orders_monthly: staticPlan.max_orders_monthly ?? -1,
    has_whatsapp_bot: staticPlan.has_whatsapp_bot ?? true,
    has_analytics: staticPlan.has_analytics ?? true,
    has_custom_poster: staticPlan.has_custom_poster ?? true,
  };
}

/**
 * Returns the active plan row merged with quota/feature fields for a shop.
 *
 * @param {string} shopId - shops.id (UUID)
 * @returns {Promise<{
 *   planId: string,
 *   max_printers: number,        // -1 = unlimited
 *   max_pages: number,           // -1 = unlimited; monthly sheet cap
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
    // select('*') — schema-drift tolerant: a named column missing from this
    // deployment would 404 the whole row and wrongly fail open.
    const { data: shop, error: shopErr } = await supabaseAdmin
      .from('shops')
      .select('*')
      .eq('id', shopId)
      .maybeSingle();

    if (shopErr) {
      console.warn('[getShopActivePlan] shops fetch error — failing open:', shopErr.message);
      return { ...FREE_PLAN_DEFAULTS };
    }

    const now = Date.now();

    // ---- 2. Determine effective plan id (unchanged admin/expiry semantics) ----
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

    // ---- 3. Active subscriptions rows (purchase record + limit snapshot) ----
    // select('*') + NO ORDER BY: ordering or filtering on a column this
    // deployment lacks would 400 the whole query; sorting/filtering happens
    // in pickActiveSubscription() (pure, in lib/subscriptionLimits.js).
    let subRows = [];
    try {
      const { data, error } = await supabaseAdmin
        .from('subscriptions')
        .select('*')
        .eq('shop_id', shopId)
        .limit(20);
      if (error) throw error;
      subRows = data || [];
    } catch (subErr) {
      // Table missing / RLS / schema drift — degrade to plans-catalog limits.
      console.warn('[getShopActivePlan] subscriptions fetch failed — using plans catalog:', subErr?.message || subErr);
    }

    // ---- 4. No shops row? Derive the plan from the purchase record so a
    // paying shop is never stuck on free-tier limits (null/missing shops
    // state must not beat an active paid subscription). ----
    if (!shop) {
      const purchased = pickActiveSubscription(subRows, null, now);
      if (purchased?.plan_id) {
        planId = String(purchased.plan_id);
        if (planId === 'lifetime') isLifetime = true;
        expiresAt = purchased.end_date || null;
      }
    }

    // ---- 5. Fetch quota columns from plans table (live admin edits) ----
    let planRow = null;
    let planErr = null;
    try {
      const { data, error } = await supabaseAdmin
        .from('plans')
        .select('max_printers, max_pages, max_orders_monthly, has_whatsapp_bot, has_analytics, has_custom_poster')
        .eq('code', planId)
        .maybeSingle();
      planErr = error;
      planRow = data || null;
    } catch (err) {
      planErr = err;
    }

    if (planErr) {
      // Table missing, quota columns absent (PGRST204/42703), or transient
      // failure — static lib/plans.js catalog still has every field.
      console.warn('[getShopActivePlan] plans fetch error — using static fallback:', planErr.message || planErr);
    }

    // Catalog layer: DB row per-column, else static plan, else fail-open.
    const staticPlan = staticLimits(planId);
    const catalogLimits = planErr
      ? staticPlan
      : {
          max_printers: planRow?.max_printers ?? staticPlan.max_printers,
          max_pages: planRow?.max_pages ?? staticPlan.max_pages,
          max_orders_monthly: planRow?.max_orders_monthly ?? staticPlan.max_orders_monthly,
          has_whatsapp_bot: planRow?.has_whatsapp_bot ?? staticPlan.has_whatsapp_bot,
          has_analytics: planRow?.has_analytics ?? staticPlan.has_analytics,
          has_custom_poster: planRow?.has_custom_poster ?? staticPlan.has_custom_poster,
        };

    // ---- 6. Merge the active subscriptions row (plan-matched) over catalog ----
    // 'free' shops never read paid rows — the free tier is authoritative for
    // them. For paid plans, only a row whose plan_id matches the effective
    // plan is trusted: a stale row from an older/other plan must not
    // downgrade (or upgrade) the limits the catalog already expresses.
    let sub = null;
    if (planId !== 'free') {
      const picked = pickActiveSubscription(subRows, planId, now);
      if (picked && String(picked.plan_id || '').toLowerCase() === String(planId).toLowerCase()) {
        sub = picked;
      }
    }

    const limits = mergeSubscriptionLimits(sub, catalogLimits);

    return {
      planId,
      max_printers: normalizeQuota(limits.max_printers, -1),
      max_pages: normalizeQuota(limits.max_pages, -1),
      max_orders_monthly: normalizeQuota(limits.max_orders_monthly, -1),
      // Boolean flags: missing → true (fail-open / enabled)
      has_whatsapp_bot: limits.has_whatsapp_bot ?? true,
      has_analytics: limits.has_analytics ?? true,
      has_custom_poster: limits.has_custom_poster ?? true,
      is_lifetime: isLifetime,
      expires_at: expiresAt,
    };
  } catch (err) {
    // Any unexpected error → fail-open
    console.error('[getShopActivePlan] unexpected error — failing open:', err?.message || err);
    return { ...FREE_PLAN_DEFAULTS };
  }
}
