import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin, isSupabaseAdminConfigured } from '../../../../lib/supabaseAdmin';
import { applySubscriptionUpgrade } from '../../../../lib/subscriptionService';
import { getPlanLabel, getPlanAmountPaise } from '../../../../lib/plans';
import { readPlanIntent } from '../../../../lib/planOrders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/billing/verify-payment
 *
 * The ONLY path that may upgrade a shop's subscription.
 *
 * Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature, intentId }
 *
 * Order of operations — the plan is applied ONLY after ALL of these pass:
 *   1. `intentId` must be a valid, unexpired token signed by this server
 *      (minted by /api/billing/create-plan-order). Plan, billing cycle, shop
 *      and amount are read from THAT token, never from this request body.
 *   2. The HMAC-SHA256 of `${order_id}|${payment_id}` keyed with
 *      RAZORPAY_KEY_SECRET must match, compared in constant time.
 *   3. Razorpay must report the order as PAID and the amount it actually
 *      charged must equal the amount we priced in step 1.
 *
 * A failure at any step returns HTTP 400 and logs a security warning. There
 * is no demo/no-keys branch that grants a plan — a missing key configuration
 * is a 503, never a free upgrade.
 */

const RZP_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const RZP_KEY_ID = process.env.RAZORPAY_KEY_ID || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const orderId = String(body.razorpay_order_id || '').trim();
    const paymentId = String(body.razorpay_payment_id || '').trim();
    const signature = String(body.razorpay_signature || '').trim();
    const intentId = String(body.intentId || '').trim();

    /* --------------------- Shape check --------------------- */
    if (!orderId || !paymentId || !signature || !intentId) {
      return NextResponse.json(
        {
          success: false,
          error: 'razorpay_order_id, razorpay_payment_id, razorpay_signature and intentId are required.',
        },
        { status: 400 }
      );
    }

    /* --------------------- Config guard --------------------- */
    if (!RZP_KEY_SECRET || !isSupabaseAdminConfigured || !supabaseAdmin) {
      console.error('[billing/verify-payment] payments not configured — refusing upgrade');
      return NextResponse.json(
        { success: false, error: 'Payments are not configured on this deployment.' },
        { status: 503 }
      );
    }

    /* --------------------- 1. Server-signed intent --------------------- */
    const intent = readPlanIntent(intentId);
    if (!intent) {
      console.warn(
        '[billing/verify-payment] SECURITY: invalid, forged or expired intent — refusing upgrade',
        { orderId, paymentId }
      );
      return NextResponse.json(
        { success: false, error: 'This payment session is no longer valid. Please start again.' },
        { status: 400 }
      );
    }

    /* --------------------- 2. Signature --------------------- */
    const expected = crypto
      .createHmac('sha256', RZP_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    if (!safeEqual(expected, signature)) {
      console.warn(
        '[billing/verify-payment] SECURITY: signature mismatch — refusing upgrade',
        { orderId, paymentId, intentId, planId: intent.planId, shopId: intent.shopId }
      );
      return NextResponse.json(
        { success: false, error: 'Payment signature verification failed.' },
        { status: 400 }
      );
    }

    /* --------------------- 3. Confirm with Razorpay --------------------- */
    // The signature proves the callback is well-formed; this proves the money
    // actually arrived for THIS order at THIS amount.
    let rzpOrder = null;
    try {
      const Razorpay = (await import('razorpay')).default;
      const rzp = new Razorpay({ key_id: RZP_KEY_ID, key_secret: RZP_KEY_SECRET });
      rzpOrder = await rzp.orders.fetch(orderId);
    } catch (err) {
      console.error('[billing/verify-payment] could not fetch order from Razorpay:', err?.message);
      return NextResponse.json(
        { success: false, error: 'Could not confirm the payment with Razorpay.' },
        { status: 502 }
      );
    }

    if (String(rzpOrder?.status || '').toUpperCase() !== 'PAID') {
      console.warn('[billing/verify-payment] SECURITY: order is not PAID — refusing upgrade', {
        orderId,
        status: rzpOrder?.status,
      });
      return NextResponse.json(
        { success: false, error: 'Payment has not completed.' },
        { status: 400 }
      );
    }

    // The charged amount must equal the price we quoted. Catches a tampered
    // or mismatched order.
    const charged = Number(rzpOrder?.amount ?? 0);
    if (charged !== intent.amountPaise) {
      console.warn('[billing/verify-payment] SECURITY: amount mismatch — refusing upgrade', {
        orderId,
        charged,
        expected: intent.amountPaise,
      });
      return NextResponse.json(
        { success: false, error: 'Payment amount does not match the plan price.' },
        { status: 400 }
      );
    }

    // Defence in depth: the price must still be the catalog price.
    const catalogPaise = getPlanAmountPaise(intent.planId, intent.billingCycle);
    if (!catalogPaise || catalogPaise !== intent.amountPaise) {
      console.warn('[billing/verify-payment] SECURITY: intent no longer matches catalog — refusing', {
        intentId,
        planId: intent.planId,
      });
      return NextResponse.json(
        { success: false, error: 'This plan price is no longer valid. Please start again.' },
        { status: 400 }
      );
    }

    /* --------------------- APPLY --------------------- */
    const result = await applySubscriptionUpgrade({
      shopId: intent.shopId,
      planId: intent.planId,
      billingCycle: intent.billingCycle,
      amountRupees: intent.amountPaise / 100,
      paymentId,
      orderId,
    });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error || 'Upgrade could not be applied.' },
        { status: 500 }
      );
    }

    console.info(
      `[billing] plan activated shop=${intent.shopId} plan=${intent.planId} payment=${paymentId}`
    );

    return NextResponse.json({
      success: true,
      verified: true,
      planId: intent.planId,
      planLabel: getPlanLabel(intent.planId, intent.billingCycle),
      shopId: intent.shopId,
      // Real references for the receipt — the UI must not invent them.
      paymentId,
      orderId,
      amountRupees: intent.amountPaise / 100,
      expiresAt: result.expiresAt,
      duplicate: Boolean(result.duplicate),
    });
  } catch (err) {
    console.error('[billing/verify-payment] error:', err);
    return NextResponse.json(
      { success: false, error: 'Verification failed.' },
      { status: 500 }
    );
  }
}

/** Timing-safe string comparison. */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}