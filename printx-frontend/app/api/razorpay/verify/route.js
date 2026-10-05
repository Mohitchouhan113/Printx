import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { PLANS } from '../../../../lib/plans';

/**
 * POST /api/razorpay/verify
 *
 * Client-side checkout callback verification (standard Razorpay flow):
 * Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature, planId, billingCycle, shopId }
 *
 * The signature is an HMAC-SHA256 of `${order_id}|${payment_id}` keyed with
 * RAZORPAY_KEY_SECRET. Verifying it here proves the payment callback came
 * from Razorpay and not a tampered client.
 *
 * On success the subscription upgrade is applied immediately (the webhook is
 * the backup path and is idempotent by payment_id).
 */

const RZP_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature,
      planId,
      billingCycle,
      shopId,
    } = body;

    if (!orderId || !paymentId || !signature) {
      return NextResponse.json(
        { success: false, error: 'Missing razorpay_order_id / razorpay_payment_id / razorpay_signature' },
        { status: 400 }
      );
    }
    if (!PLANS[planId] || !shopId) {
      return NextResponse.json({ success: false, error: 'planId and shopId are required' }, { status: 400 });
    }

    /* --------------------- Payment configuration ---------------------
     * SECURITY: this route used to have a demo branch —
     *   `if (!RZP_KEY_SECRET || orderId.startsWith('order_demo_')) → upgrade`
     * — which meant ANY caller could POST forged `order_demo_*` / `pay_demo_*`
     * ids with a garbage signature and receive a free paid plan (verified
     * live: a shop went pro → lifetime with no payment). A missing key
     * configuration also bypassed verification entirely.
     *
     * Upgrades now happen ONLY through /api/billing/verify-payment, which
     * checks the HMAC signature AND asks Razorpay whether the order was
     * actually PAID. This route is retained for the (already-verified)
     * webhook-less legacy client flow and now REFUSES to activate anything:
     * it tells the caller to use the secured endpoint.
     */
    if (!RZP_KEY_SECRET) {
      console.error('[razorpay/verify] RAZORPAY_KEY_SECRET is not configured — refusing to activate');
      return NextResponse.json(
        { success: false, error: 'Payments are not configured on this deployment.' },
        { status: 503 }
      );
    }

    /* --------------------- Signature check --------------------- */
    const expected = crypto
      .createHmac('sha256', RZP_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    const valid = safeEqual(expected, signature);
    if (!valid) {
      console.error('[razorpay/verify] signature mismatch', { orderId, paymentId });
      return NextResponse.json(
        { success: false, error: 'Payment signature verification failed' },
        { status: 400 }
      );
    }

    /* --------------------- Refuse --------------------- */
    // Signature is well-formed here, but the plan still comes from the
    // client body. Only /api/billing/verify-payment may apply an upgrade.
    console.warn(
      '[razorpay/verify] SECURITY: activation via this route is disabled — use /api/billing/verify-payment',
      { orderId, paymentId }
    );
    return NextResponse.json(
      {
        success: false,
        error: 'Plan activation must be completed through /api/billing/verify-payment.',
      },
      { status: 400 }
    );
  } catch (err) {
    console.error('[razorpay/verify] error:', err);
    return NextResponse.json({ success: false, error: 'Verification failed' }, { status: 500 });
  }
}

/** Timing-safe string comparison. */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
