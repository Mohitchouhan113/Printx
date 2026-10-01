import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { applySubscriptionUpgrade } from '../../../../lib/subscriptionService';
import { PLANS } from '../../../../lib/plans';

/**
 * POST /api/razorpay/webhook — Razorpay server-to-server events.
 *
 * Handles `payment.captured`:
 *   1. Verify X-Razorpay-Signature (HMAC-SHA256 of the RAW body with
 *      RAZORPAY_WEBHOOK_SECRET). The raw-body requirement is why this route
 *      reads request.text() instead of request.json().
 *   2. Extract shopId / planId / billingCycle from event.payload.payment.notes
 *      (written by create-order), falling back to the webhook-config notes.
 *   3. Update shops.subscription_plan + subscription_expires_at
 *      (NOW + 1 month / 1 year, NULL for LIFETIME).
 *   4. Insert a subscriptions row (invoice tracking, idempotent by payment id).
 *
 * Always returns 200 for signature-valid requests (Razorpay retries non-200s
 * with backoff); returns 401 for signature failures.
 */

const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

export async function POST(request) {
  // ---- Raw body (signature is computed over exact bytes) ----
  const rawBody = await request.text();
  const signature = request.headers.get('x-razorpay-signature');

  if (!WEBHOOK_SECRET) {
    console.error('[razorpay/webhook] RAZORPAY_WEBHOOK_SECRET not configured');
    return NextResponse.json({ success: false, error: 'Webhook not configured' }, { status: 500 });
  }

  // ---- Signature verification ----
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
  if (!signature || !safeEqual(expected, signature)) {
    console.error('[razorpay/webhook] signature verification FAILED — rejecting');
    return NextResponse.json({ success: false, error: 'Invalid signature' }, { status: 401 });
  }

  // ---- Parse event ----
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const eventType = event.event;

  // Acknowledge non-payment events so Razorpay stops retrying them.
  if (eventType !== 'payment.captured' && eventType !== 'order.paid') {
    console.info(`[razorpay/webhook] ignored event: ${eventType}`);
    return NextResponse.json({ success: true, ignored: eventType });
  }

  const payment = event.payload?.payment?.entity;
  if (!payment) {
    return NextResponse.json({ success: false, error: 'Missing payment entity' }, { status: 400 });
  }

  // ---- Attribution: notes were stamped by /api/razorpay/create-order ----
  const notes = payment.notes || {};
  const shopId = notes.shopId || notes.shop_id;
  const planId = notes.planId || notes.plan_id;
  const billingCycle = notes.billingCycle || notes.billing_cycle || 'monthly';
  const amountRupees = (payment.amount || 0) / 100;

  if (!shopId || !planId || !PLANS[planId]) {
    console.error('[razorpay/webhook] payment missing usable notes:', { paymentId: payment.id, notes });
    // 200 — a retry won't fix a missing-notes payment; surface for manual reconcile.
    return NextResponse.json(
      { success: false, error: 'Payment notes missing shopId/planId — needs manual reconciliation' },
      { status: 200 }
    );
  }

  // ---- Apply upgrade (idempotent by payment_id) ----
  const result = await applySubscriptionUpgrade({
    shopId,
    planId,
    billingCycle,
    amountRupees,
    paymentId: payment.id,
    orderId: payment.order_id,
    invoiceNumber: `INV-${new Date().getFullYear()}-${String(payment.id).slice(-6).toUpperCase()}`,
  });

  if (!result.ok) {
    // 500 makes Razorpay retry — appropriate for transient DB failures.
    return NextResponse.json({ success: false, error: result.error }, { status: 500 });
  }

  console.info(
    `[razorpay/webhook] processed payment.captured: ${payment.id} → shop=${shopId} plan=${planId}${result.duplicate ? ' (duplicate ignored)' : ''}`
  );
  return NextResponse.json({ success: true, duplicate: result.duplicate || false });
}

/** Timing-safe string comparison. */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
