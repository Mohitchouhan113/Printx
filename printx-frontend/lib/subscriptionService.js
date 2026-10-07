import { supabaseAdmin, isSupabaseAdminConfigured } from './supabaseAdmin';
import { getPlanLabel, PLANS } from './plans';

/**
 * Subscription activation service — shared by /api/razorpay/verify and
 * /api/razorpay/webhook so both paths apply EXACTLY the same database
 * changes (idempotent by payment_id).
 *
 *  1. shops.subscription_plan        = planId
 *  2. shops.subscription_expires_at  = NOW + 1mo/1yr (NULL for lifetime)
 *  3. subscriptions row insert       (invoice tracking + feature-limit
 *     snapshot: max_printers, max_pages, max_orders_monthly, has_whatsapp_bot,
 *     has_analytics, has_custom_poster — read back by getShopActivePlan)
 *
 * Demo mode (no Supabase): returns the computed expiry without persisting.
 */

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Columns this deployment's `wallet_transactions` table turned out not to have.
 * Discovered once at runtime (the first insert that names a missing column
 * trips PGRST204/42703) and remembered, so later upgrades stop paying for the
 * same failed round-trips.
 */
const LEDGER_MISSING_COLUMNS = new Set();

/**
 * Columns this deployment's `subscriptions` table turned out not to have.
 * Same progressive-column-drop pattern as LEDGER_MISSING_COLUMNS.
 */
const SUBSCRIPTIONS_MISSING_COLUMNS = new Set();

/**
 * Columns this deployment's `shops` table turned out not to have.
 * Same progressive-column-drop pattern. Primarily used to handle `is_lifetime`
 * which may not be present on all deployments.
 */
const SHOPS_MISSING_COLUMNS = new Set();

/**
 * Attribution string for a subscription charge.
 *
 * The live `wallet_transactions` table on this project is only
 * (id, wallet_id, amount, type, description, created_at) — it has no shop_id
 * and no reference_id. A row written without attribution cannot be traced back
 * to the shop that paid or the payment that caused it, and cannot be used to
 * detect a replayed callback. So the shop and payment ids are embedded in the
 * description, which is the one free-text column guaranteed to exist. This also
 * gives the replay guard a filter key that works on ANY schema:
 *
 *     ?description=like.*<paymentId>*
 */
function ledgerDescription({ planId, billingCycle, shopId, paymentId }) {
  const label = getPlanLabel(planId, billingCycle);
  return `${label} subscription · shop ${shopId} · payment ${paymentId || 'unknown'}`;
}

/**
 * Feature-limit snapshot written INTO the subscriptions row when a plan is
 * purchased or assigned. Source chain: `plans` table (live admin config) →
 * static lib/plans.js catalog → fail-open -1 quotas. Lifetime entitlements
 * are forced to the documented values: 9999 printers / 999999 pages / every
 * feature flag true (finite but effectively unlimited — every quota check
 * gets a concrete number to compare instead of a magic sentinel).
 *
 * @param {string} planId       - basic | pro | advance | lifetime | free
 * @param {string} billingCycle - monthly | yearly | lifetime
 * @returns {Promise<object>}   - the limit columns for the subscriptions row
 */
export async function resolvePlanLimits(planId, billingCycle = 'monthly') {
  const isLifetime = planId === 'lifetime' || billingCycle === 'lifetime';
  const staticPlan = PLANS[planId] || PLANS.free;

  let planRow = null;
  if (isSupabaseAdminConfigured && supabaseAdmin) {
    try {
      const { data, error } = await supabaseAdmin
        .from('plans')
        .select('max_printers, max_pages, max_orders_monthly, has_whatsapp_bot, has_analytics, has_custom_poster')
        .eq('code', planId)
        .maybeSingle();
      if (error) {
        console.warn(`[subscription] plans limit fetch for "${planId}" failed — static catalog used:`, error.message);
      } else {
        planRow = data || null;
      }
    } catch (err) {
      console.warn('[subscription] plans limit fetch threw — static catalog used:', err?.message || err);
    }
  }

  const limits = {
    max_printers: planRow?.max_printers ?? staticPlan.max_printers ?? -1,
    max_pages: planRow?.max_pages ?? staticPlan.max_pages ?? -1,
    max_orders_monthly: planRow?.max_orders_monthly ?? staticPlan.max_orders_monthly ?? -1,
    has_whatsapp_bot: planRow?.has_whatsapp_bot ?? staticPlan.has_whatsapp_bot ?? false,
    has_analytics: planRow?.has_analytics ?? staticPlan.has_analytics ?? false,
    has_custom_poster: planRow?.has_custom_poster ?? staticPlan.has_custom_poster ?? false,
  };

  if (isLifetime) {
    limits.max_printers = 9999;
    limits.max_pages = 999999;
    limits.has_whatsapp_bot = true;
    limits.has_analytics = true;
    limits.has_custom_poster = true;
  }
  return limits;
}

/**
 * Insert one subscriptions row with progressive column-drop — any column
 * this deployment's schema lacks is remembered (SUBSCRIPTIONS_MISSING_COLUMNS)
 * and dropped, so a schema difference never blocks a paid activation.
 * Shared with the admin plan-assignment route (/api/admin/shops) so payment
 * verification and admin assignment write identical entitlement shapes.
 *
 * @returns {Promise<{ ok: boolean, error: any }>}
 */
export async function writeSubscriptionRow(payload) {
  let subRow = { ...payload };
  for (const col of SUBSCRIPTIONS_MISSING_COLUMNS) delete subRow[col];

  let lastErr = null;
  // 17 payload keys max (base 11 + 6 limit columns); one drop per round trip.
  for (let i = 0; i < 14 && Object.keys(subRow).length > 0; i++) {
    const { error: err } = await supabaseAdmin.from('subscriptions').insert(subRow);
    if (!err) return { ok: true, error: null };
    lastErr = err;
    const missing =
      (err.message || '').match(/'([\w]+)'\s+column|column\s+"(\w+)"/)?.[1] ||
      (err.message || '').match(/'([\w]+)'\s+column|column\s+"(\w+)"/)?.[2];
    if ((err.code === 'PGRST204' || err.code === '42703') && missing && missing in subRow) {
      console.warn(`[subscription] subscriptions missing column "${missing}" — dropping it`);
      SUBSCRIPTIONS_MISSING_COLUMNS.add(missing);
      delete subRow[missing];
      continue;
    }
    break;
  }
  return { ok: false, error: lastErr };
}

/**
 * Apply a successful payment to the database.
 * @param {object} params
 * @param {string} params.shopId        - shops.id (uuid) or slug in demo mode
 * @param {string} params.planId        - basic | pro | advance | lifetime
 * @param {string} params.billingCycle  - monthly | yearly | lifetime
 * @param {number} params.amountRupees  - charged amount (display only)
 * @param {string} params.paymentId     - razorpay payment id (idempotency key)
 * @param {string} [params.orderId]     - razorpay order id
 * @param {string} [params.invoiceNumber] - generated invoice reference
 * @returns {Promise<{ ok: boolean, expiresAt: string|null, demo?: boolean, error?: string }>}
 */
export async function applySubscriptionUpgrade({
  shopId,
  planId,
  billingCycle,
  amountRupees,
  paymentId,
  orderId,
  invoiceNumber,
}) {
  const label = getPlanLabel(planId, billingCycle);

  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    // Demo mode: compute without a base (no DB to read from)
    const expiresAt = computeExpiryFromBase(planId, billingCycle, null);
    console.warn(
      `[subscription] DEMO mode — upgrade not persisted: shop=${shopId} plan=${planId} payment=${paymentId}`
    );
    return { ok: true, demo: true, expiresAt };
  }

  // ---- Fetch current shop subscription state FIRST ----
  // Must happen before any early-return paths so that even on a duplicate
  // replay the returned expiresAt reflects the shop's real future expiry,
  // not now + plan_duration (which would mislead the receipt modal).
  const { data: currentShop } = await supabaseAdmin
    .from('shops')
    .select('subscription_expires_at, subscription_plan')
    .eq('id', shopId)
    .maybeSingle();

  // ---- Idempotency: skip if this payment was already applied ----
  // Plan intents are stateless (lib/planOrders.js), so nothing server-side
  // marks an intent as "used". A replayed — but genuinely paid — callback
  // must therefore not re-apply and silently push the expiry forward.
  //
  // `wallet_transactions` is the ledger that actually exists on this project
  // (`subscriptions` / `billing_history` do not), and its only always-present
  // identifying column is `description`, which carries the payment id. A
  // failed lookup degrades to "apply anyway" rather than blocking a real
  // paid upgrade on a schema quirk.
  if (paymentId) {
    const { data: applied, error: dupErr } = await supabaseAdmin
      .from('wallet_transactions')
      .select('id')
      .like('description', `*${paymentId}*`)
      .limit(1);
    if (!dupErr && applied && applied.length > 0) {
      console.info(`[subscription] payment ${paymentId} already applied — duplicate ignored`);
      // Use real shop expiry so the receipt modal shows the correct renewal date.
      const expiresAt = computeExpiryFromBase(planId, billingCycle, currentShop?.subscription_expires_at);
      return { ok: true, expiresAt, duplicate: true };
    }
    if (dupErr) {
      console.warn(`[subscription] duplicate check unavailable (${dupErr.message}) — proceeding`);
    }
  }

  const { data: existing } = await supabaseAdmin
    .from('subscriptions')
    .select('id')
    .eq('payment_id', paymentId)
    .maybeSingle();
  if (existing) {
    // Use real shop expiry so the receipt modal shows the correct renewal date.
    const expiresAt = computeExpiryFromBase(planId, billingCycle, currentShop?.subscription_expires_at);
    return { ok: true, expiresAt, duplicate: true };
  }

  // Compute new expiry — extends from current_expiry if it is still in the future
  const expiresAt = computeExpiryFromBase(planId, billingCycle, currentShop?.subscription_expires_at);

  // The base date used for the start_date audit field:
  // same logic as inside computeExpiryFromBase — future expiry or now.
  const now = Date.now();
  const currentMs = currentShop?.subscription_expires_at
    ? new Date(currentShop.subscription_expires_at).getTime()
    : NaN;
  const baseDate = Number.isFinite(currentMs) && currentMs > now
    ? new Date(currentMs).toISOString()
    : new Date(now).toISOString();

  // ---- 1. Update the shop's plan (with progressive-drop for is_lifetime) ----
  // is_lifetime may not exist on all deployments. Use the same progressive-column-drop
  // pattern so a missing column never blocks a lifetime activation.
  const shopPayload = {
    subscription_plan: planId,
    subscription_expires_at: expiresAt,
    ...(planId === 'lifetime' ? { is_lifetime: true } : {}),
  };
  let shopRow = { ...shopPayload };
  for (const col of SHOPS_MISSING_COLUMNS) delete shopRow[col];

  let shopErr = null;
  for (let i = 0; i < 3; i++) {
    const { error: err } = await supabaseAdmin
      .from('shops')
      .update(shopRow)
      .eq('id', shopId);
    if (!err) { shopErr = null; break; }
    shopErr = err;
    const missing =
      (err.message || '').match(/'([\w]+)'\s+column|column\s+"(\w+)"/)?.[1] ||
      (err.message || '').match(/'([\w]+)'\s+column|column\s+"(\w+)"/)?.[2];
    if ((err.code === 'PGRST204' || err.code === '42703') && missing && missing in shopRow) {
      console.warn(`[subscription] shops missing column "${missing}" — dropping it`);
      SHOPS_MISSING_COLUMNS.add(missing);
      delete shopRow[missing];
      continue;
    }
    break;
  }

  if (shopErr) {
    console.error('[subscription] shops update failed:', shopErr);
    return { ok: false, expiresAt, error: shopErr.message };
  }

  // ---- 2. Invoice/subscription record ----
  // Includes the plan's feature-limit snapshot so every quota/feature check
  // can read entitlements straight off this row (getShopActivePlan). The
  // write itself is progressive-column-drop (writeSubscriptionRow) so a
  // schema without the limit columns still records the purchase.
  const planLimits = await resolvePlanLimits(planId, billingCycle);
  const subPayload = {
    shop_id: shopId,
    plan_id: planId,
    ...planLimits,
    billing_cycle: planId === 'lifetime' ? 'lifetime' : billingCycle,
    amount_rupees: amountRupees,
    payment_id: paymentId,
    order_id: orderId || null,
    invoice_number: invoiceNumber || `INV-${new Date().getFullYear()}-${paymentId?.slice(-6) || 'NA'}`,
    status: 'paid',
    start_date: baseDate,
    end_date: expiresAt,
  };
  const { ok: subOk, error: subErr } = await writeSubscriptionRow(subPayload);

  if (!subOk) {
    // Shop plan already updated; log but don't fail the activation.
    console.error('[subscription] subscriptions insert failed:', subErr);
  }

  // ---- 2b. Billing transaction ledger ----
  // wallet_transactions is the live table that exists on this project
  // (`subscriptions` / `billing_history` do not). Progressive column-drop so
  // a schema difference here can never undo a paid upgrade — the shop row above
  // is already written by this point.
  //
  // Columns absent on this deployment (shop_id / reference_id / status) are
  // dropped permanently after the first discovery, so later upgrades write the
  // row in a single round-trip instead of three.
  const txPayload = {
    shop_id: shopId,
    type: 'credit',
    amount: amountRupees,
    description: ledgerDescription({ planId, billingCycle, shopId, paymentId }),
    reference_id: paymentId || null,
    status: 'success',
  };
  let txRow = { ...txPayload };
  for (const col of LEDGER_MISSING_COLUMNS) delete txRow[col];

  for (let i = 0; i < 4; i++) {
    const { error: txErr } = await supabaseAdmin.from('wallet_transactions').insert(txRow);
    if (!txErr) break;
    const missing =
      (txErr.message || '').match(/'([\w]+)'\s+column|column\s+"(\w+)"/)?.[1] ||
      (txErr.message || '').match(/'([\w]+)'\s+column|column\s+"(\w+)"/)?.[2];
    if ((txErr.code === 'PGRST204' || txErr.code === '42703') && missing && missing in txRow) {
      console.warn(`[subscription] wallet_transactions missing column "${missing}" — dropping it`);
      LEDGER_MISSING_COLUMNS.add(missing);
      delete txRow[missing];
      continue;
    }
    console.error('[subscription] wallet_transactions insert failed:', txErr.message);
    break;
  }

  console.info(`[subscription] activated: shop=${shopId} plan=${label} until=${expiresAt || 'never'}`);
  return { ok: true, expiresAt };
}

/** Expiry timestamp: NULL for lifetime, else base + 1 month / 1 year (ISO).
 *
 * @param {string} planId          - plan identifier
 * @param {string} billingCycle    - 'monthly' | 'yearly' | 'lifetime'
 * @param {string|null} currentExpiryIso - existing subscription_expires_at from DB
 *
 * When `currentExpiryIso` is a genuinely future date (> now), the new expiry
 * is computed from that date so remaining paid days are preserved. Otherwise
 * the calculation falls back to Date.now() (plan expired or first purchase).
 *
 * @since 2025-01 — extension-from-current-expiry logic intentional:
 *   preserves all remaining paid days when the vendor buys/upgrades mid-cycle.
 */
function computeExpiryFromBase(planId, billingCycle, currentExpiryIso) {
  if (planId === 'lifetime' || billingCycle === 'lifetime') return null;
  const ms = billingCycle === 'yearly' ? YEAR_MS : MONTH_MS;
  const now = Date.now();
  const currentMs = currentExpiryIso ? new Date(currentExpiryIso).getTime() : NaN;
  // Extends from current expiry only if it is genuinely in the future —
  // preserves remaining paid days on same-plan renewal and plan upgrades.
  const base = Number.isFinite(currentMs) && currentMs > now ? currentMs : now;
  return new Date(base + ms).toISOString();
}
