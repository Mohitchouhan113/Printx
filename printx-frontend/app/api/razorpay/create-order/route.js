import { NextResponse } from 'next/server';
import Razorpay from 'razorpay';
import { getPlanAmountPaise, getPlanLabel, PLANS } from '../../../../lib/plans';

/**
 * POST /api/razorpay/create-order
 *
 * Body: { planId, billingCycle, shopId }
 *   planId       — basic | pro | advance | lifetime
 *   billingCycle — monthly | yearly (ignored for lifetime)
 *   shopId       — shops.id (uuid) or slug (demo mode)
 *
 * Returns { success, orderId, amount, currency, keyId }.
 * Demo mode (no keys or auth failure): returns a mock order so the UI
 * flow remains fully testable without real Razorpay credentials.
 */

const RZP_KEY_ID = process.env.RAZORPAY_KEY_ID || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
const RZP_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const planId = String(body.planId || '').trim();
    const billingCycle = String(body.billingCycle || 'monthly').trim();
    const shopId = String(body.shopId || '').trim();
    const shopSlug = String(body.shopSlug || '').trim();
    // Use shopSlug as fallback identifier when shopId is missing
    // (e.g. context hasn't loaded yet, or demo mode).
    const effectiveShopId = shopId || shopSlug || 'demo';

    /* ------------------------- Validation ------------------------- */
    if (!PLANS[planId]) {
      return NextResponse.json(
        { success: false, error: `Unknown plan "${planId}". Valid: ${Object.keys(PLANS).join(', ')}` },
        { status: 400 },
      );
    }
    if (!['monthly', 'yearly', 'lifetime'].includes(billingCycle)) {
      return NextResponse.json(
        { success: false, error: 'billingCycle must be monthly, yearly or lifetime' },
        { status: 400 },
      );
    }
    if (planId === 'free') {
      return NextResponse.json(
        { success: false, error: 'Free plan does not require payment' },
        { status: 400 },
      );
    }

    const amountPaise = getPlanAmountPaise(planId, billingCycle);
    if (!amountPaise) {
      return NextResponse.json(
        { success: false, error: `Plan "${planId}" is not purchasable with cycle "${billingCycle}"` },
        { status: 400 },
      );
    }

    const planLabel = getPlanLabel(planId, billingCycle);

    /* --------------------- Demo mode (no keys) --------------------- */
    if (!RZP_KEY_ID || !RZP_KEY_SECRET) {
      const demoOrderId = `order_demo_${Date.now()}`;
      console.warn(
        `[razorpay/create-order] DEMO order: ${demoOrderId} ${planLabel} ₹${amountPaise / 100} shop=${effectiveShopId}`,
      );
      return NextResponse.json({
        success: true,
        demo: true,
        orderId: demoOrderId,
        amount: amountPaise,
        currency: 'INR',
        keyId: 'rzp_test_demo',
        planLabel,
      });
    }

    /* --------------------- Real Razorpay order --------------------- */
    let instance;
    try {
      instance = new Razorpay({ key_id: RZP_KEY_ID, key_secret: RZP_KEY_SECRET });
    } catch (sdkErr) {
      console.error('[razorpay/create-order] SDK init failed:', sdkErr);
      // Treat SDK init failure as demo mode — keys are likely invalid
      return fallbackDemo(amountPaise, planLabel, shopId, String(sdkErr?.message || 'SDK init failed'));
    }

    let order;
    try {
      order = await instance.orders.create({
        amount: amountPaise, // paise
        currency: 'INR',
        receipt: `rcpt_${effectiveShopId.slice(0, 8)}_${Date.now().toString(36)}`,
        notes: {
          shopId: effectiveShopId,
          planId,
          billingCycle: planId === 'lifetime' ? 'lifetime' : billingCycle,
        },
      });
    } catch (apiErr) {
      const apiMsg = String(apiErr?.message || apiErr?.error?.description || '');
      const statusCode = apiErr?.statusCode || apiErr?.status || 0;

      // Auth failure (401) or other key issues — fall back to demo mode
      const isAuthFailure =
        statusCode === 401 ||
        /authentication|auth|invalid.*key|unauthorized|BAD_REQUEST/i.test(apiMsg);

      if (isAuthFailure) {
        return fallbackDemo(amountPaise, planLabel, shopId, apiMsg);
      }

      // Other Razorpay errors — include the real message
      console.error('[razorpay/create-order] API error:', apiErr);
      return NextResponse.json(
        { success: false, error: `Payment gateway error: ${apiMsg || 'Unknown'}` },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: RZP_KEY_ID,
      planLabel,
    });
  } catch (err) {
    console.error('[razorpay/create-order] unexpected error:', err);
    return NextResponse.json(
      { success: false, error: 'Could not create payment order. Please try again.' },
      { status: 500 },
    );
  }
}

/**
 * Return a demo-mode success response when Razorpay keys are missing,
 * expired, or rejected. The UI flow continues as if a real order was
 * created — the verify endpoint also handles demo mode.
 */
function fallbackDemo(amountPaise, planLabel, shopId, reason) {
  const demoOrderId = `order_demo_${Date.now()}`;
  console.warn(
    `[razorpay/create-order] Razorpay unavailable — falling back to demo mode.\n` +
      `  Plan: ${planLabel}  Amount: ₹${amountPaise / 100}  Shop: ${shopId}\n` +
      `  Reason: ${reason}\n` +
      `  Hint: set valid RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET in .env.local`,
  );
  return NextResponse.json({
    success: true,
    demo: true,
    orderId: demoOrderId,
    amount: amountPaise,
    currency: 'INR',
    keyId: 'rzp_test_demo',
    planLabel,
  });
}
