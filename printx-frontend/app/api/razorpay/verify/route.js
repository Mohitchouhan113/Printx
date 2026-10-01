import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { applySubscriptionUpgrade } from '../../../../lib/subscriptionService';
import { getPlanLabel, PLANS } from '../../../../lib/plans';

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

    /* --------------------- Demo mode --------------------- */
    const isDemoOrder = String(orderId).startsWith('order_demo_') || String(paymentId).startsWith('pay_demo_');
    if (!RZP_KEY_SECRET || isDemoOrder) {
      const result = await applySubscriptionUpgrade({
        shopId,
        planId,
        billingCycle,
        amountRupees: body.amountRupees ?? 0,
        paymentId,
        orderId,
      });
      console.warn(`[razorpay/verify] DEMO verification accepted for ${paymentId}`);
      return NextResponse.json({
        success: true,
        demo: true,
        verified: true,
        planId,
        planLabel: getPlanLabel(planId, billingCycle),
        expiresAt: result.expiresAt,
      });
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

    /* --------------------- Apply upgrade --------------------- */
    const result = await applySubscriptionUpgrade({
      shopId,
      planId,
      billingCycle,
      amountRupees: body.amountRupees ?? 0,
      paymentId,
      orderId,
    });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error || 'Upgrade could not be applied' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      verified: true,
      planId,
      planLabel: getPlanLabel(planId, billingCycle),
      expiresAt: result.expiresAt,
      duplicate: result.duplicate || false,
    });
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
