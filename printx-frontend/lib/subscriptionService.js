import { supabaseAdmin, isSupabaseAdminConfigured } from './supabaseAdmin';
import { getPlanLabel } from './plans';

/**
 * Subscription activation service — shared by /api/razorpay/verify and
 * /api/razorpay/webhook so both paths apply EXACTLY the same database
 * changes (idempotent by payment_id).
 *
 *  1. shops.subscription_plan        = planId
 *  2. shops.subscription_expires_at  = NOW + 1mo/1yr (NULL for lifetime)
 *  3. subscriptions row insert       (invoice tracking)
 *
 * Demo mode (no Supabase): returns the computed expiry without persisting.
 */

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

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
  const expiresAt = computeExpiry(planId, billingCycle);
  const label = getPlanLabel(planId, billingCycle);

  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    console.warn(
      `[subscription] DEMO mode — upgrade not persisted: shop=${shopId} plan=${planId} payment=${paymentId}`
    );
    return { ok: true, demo: true, expiresAt };
  }

  // ---- Idempotency: skip if this payment was already applied ----
  const { data: existing } = await supabaseAdmin
    .from('subscriptions')
    .select('id')
    .eq('payment_id', paymentId)
    .maybeSingle();
  if (existing) {
    return { ok: true, expiresAt, duplicate: true };
  }

  // ---- 1. Update the shop's plan ----
  const { error: shopErr } = await supabaseAdmin
    .from('shops')
    .update({
      subscription_plan: planId,
      subscription_expires_at: expiresAt,
    })
    .eq('id', shopId);

  if (shopErr) {
    console.error('[subscription] shops update failed:', shopErr);
    return { ok: false, expiresAt, error: shopErr.message };
  }

  // ---- 2. Invoice/subscription record ----
  const { error: subErr } = await supabaseAdmin.from('subscriptions').insert({
    shop_id: shopId,
    plan_id: planId,
    billing_cycle: planId === 'lifetime' ? 'lifetime' : billingCycle,
    amount_rupees: amountRupees,
    payment_id: paymentId,
    order_id: orderId || null,
    invoice_number: invoiceNumber || `INV-${new Date().getFullYear()}-${paymentId?.slice(-6) || 'NA'}`,
    status: 'paid',
  });

  if (subErr) {
    // Shop plan already updated; log but don't fail the activation.
    console.error('[subscription] subscriptions insert failed:', subErr);
  }

  console.info(`[subscription] activated: shop=${shopId} plan=${label} until=${expiresAt || 'never'}`);
  return { ok: true, expiresAt };
}

/** Expiry timestamp: NULL for lifetime, else NOW + 1 month / 1 year (ISO). */
function computeExpiry(planId, billingCycle) {
  if (planId === 'lifetime' || billingCycle === 'lifetime') return null;
  const base = Date.now();
  const ms = billingCycle === 'yearly' ? YEAR_MS : MONTH_MS;
  return new Date(base + ms).toISOString();
}
