import { NextResponse } from 'next/server';
import Razorpay from 'razorpay';
import { supabaseAdmin, isSupabaseAdminConfigured } from '../../../../lib/supabaseAdmin';
import { getPlanAmountPaise, getPlanLabel, PLANS } from '../../../../lib/plans';
import { createPlanIntent } from '../../../../lib/planOrders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/billing/create-plan-order
 *
 * Creates the Razorpay order for a subscription upgrade.
 *
 * SECURITY — the whole point of this route:
 *   · The plan is validated against the SERVER catalog (lib/plans.js).
 *   · The amount is computed SERVER-SIDE from that catalog. Any `amount` the
 *     client sends is ignored, so a client cannot buy a ₹1999 Lifetime plan
 *     for ₹1.
 *   · A signed `intentId` is minted here and returned to the client. It
 *     carries the plan, cycle, shop and amount actually charged, sealed with
 *     the server secret (lib/planOrders.js). /api/billing/verify-payment
 *     resolves the plan from that token — never from the request body — so a
 *     client cannot upgrade itself to a plan it did not pay for. The token is
 *     stateless, so it still validates when the verify call lands on a
 *     different serverless instance than this one.
 *   · The shop must exist; `shopId` is resolved against the shops table.
 *
 * Body: { planId, billingCycle, shopId, shopSlug? }
 * Returns: { success, orderId, intentId, amount, currency, keyId, planLabel }
 */

const RZP_KEY_ID = process.env.RAZORPAY_KEY_ID || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
const RZP_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const planId = String(body.planId || '').trim().toLowerCase();
    const billingCycle = String(body.billingCycle || 'monthly').trim().toLowerCase();
    const shopId = String(body.shopId || '').trim();
    const shopSlug = String(body.shopSlug || '').trim();

    /* --------------------- Validation --------------------- */
    if (!PLANS[planId]) {
      return NextResponse.json(
        { success: false, error: `Unknown plan "${planId}".` },
        { status: 400 }
      );
    }
    if (planId === 'free') {
      return NextResponse.json(
        { success: false, error: 'The free plan does not require payment.' },
        { status: 400 }
      );
    }
    if (!['monthly', 'yearly', 'lifetime'].includes(billingCycle)) {
      return NextResponse.json(
        { success: false, error: 'billingCycle must be monthly, yearly or lifetime.' },
        { status: 400 }
      );
    }

    // Amount ALWAYS comes from the server catalog — never from the client.
    const amountPaise = getPlanAmountPaise(planId, billingCycle);
    if (!amountPaise) {
      return NextResponse.json(
        { success: false, error: `No price configured for ${planId}/${billingCycle}.` },
        { status: 400 }
      );
    }

    /* --------------------- Resolve the shop --------------------- */
    if (!isSupabaseAdminConfigured || !supabaseAdmin) {
      return NextResponse.json(
        { success: false, error: 'Billing is not configured on this deployment.' },
        { status: 503 }
      );
    }
    const { data: shop, error: shopErr } = await supabaseAdmin
      .from('shops')
      .select('id, name, phone, slug')
      .eq('id', shopId)
      .maybeSingle();
    if (shopErr) {
      console.error('[billing/create-plan-order] shop lookup failed:', shopErr.message);
      return NextResponse.json(
        { success: false, error: 'Could not verify your shop.' },
        { status: 500 }
      );
    }
    if (!shop) {
      return NextResponse.json(
        { success: false, error: `Shop ${shopId || shopSlug || '(none)'} was not found.` },
        { status: 404 }
      );
    }

    /* --------------------- Razorpay keys --------------------- */
    if (!RZP_KEY_ID || !RZP_KEY_SECRET) {
      // Demo mode must NOT be able to grant a paid plan. Surface the
      // misconfiguration instead of faking a successful upgrade.
      console.error('[billing/create-plan-order] RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET missing');
      return NextResponse.json(
        { success: false, error: 'Payments are not configured on this deployment.' },
        { status: 503 }
      );
    }

    /* --------------------- Create the order --------------------- */
    const rzp = new Razorpay({ key_id: RZP_KEY_ID, key_secret: RZP_KEY_SECRET });
    const { intentId } = createPlanIntent({
      shopId: shop.id,
      shopName: shop.name || null,
      planId,
      billingCycle: planId === 'lifetime' ? 'lifetime' : billingCycle,
      amountPaise,
    });

    const order = await rzp.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: `sub_${planId}_${Date.now().toString(36)}`,
      notes: {
        kind: 'plan_subscription',
        // Plan/cycle/shop are duplicated into Razorpay's notes as a
        // server-written record of what this order is FOR.
        planId,
        billingCycle,
        shopId: shop.id,
        intentId,
      },
    });

    console.info(
      `[billing] order created plan=${planId}/${billingCycle} amount=${amountPaise} shop=${shop.id}`
    );

    return NextResponse.json({
      success: true,
      orderId: order.id,
      intentId,
      amount: amountPaise,
      currency: 'INR',
      keyId: RZP_KEY_ID,
      planId,
      planLabel: getPlanLabel(planId, billingCycle),
      prefill: { name: shop.name || '', contact: shop.phone || '' },
    });
  } catch (err) {
    console.error('[billing/create-plan-order] error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Could not start the payment.' },
      { status: 500 }
    );
  }
}