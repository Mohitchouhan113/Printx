import { NextResponse } from 'next/server';
import Razorpay from 'razorpay';

/**
 * POST /api/razorpay/create-print-order
 *
 * Body: { amountRupees, shopSlug, customerName?, customerPhone?, description? }
 *
 * Creates a Razorpay Order for a one-off customer print payment (NOT a
 * subscription plan — that flow lives in /api/razorpay/create-order).
 * The key_secret never leaves the server.
 *
 * Returns { success, orderId, amount, currency, keyId }.
 * Demo mode (no keys configured): returns a mock order so the customer
 * payment step stays testable end-to-end without real credentials.
 */

const RZP_KEY_ID = process.env.RAZORPAY_KEY_ID || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
const RZP_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const amountRupees = parseFloat(body.amountRupees);
    const shopSlug = String(body.shopSlug || '').trim() || 'demo-shop';
    const customerName = String(body.customerName || '').trim() || 'Customer';
    const customerPhone = String(body.customerPhone || '').trim();
    const description = String(body.description || 'Print order').slice(0, 200);

    if (!Number.isFinite(amountRupees) || amountRupees < 1) {
      return NextResponse.json(
        { success: false, error: 'amountRupees must be a number >= 1' },
        { status: 400 }
      );
    }

    const amountPaise = Math.round(amountRupees * 100);

    /* --------------------- Demo mode (no keys) --------------------- */
    if (!RZP_KEY_ID || !RZP_KEY_SECRET) {
      console.warn(
        `[create-print-order] DEMO mode — ₹${amountRupees} for "${customerName}" @ ${shopSlug}`
      );
      return NextResponse.json({
        success: true,
        demo: true,
        orderId: `order_demo_${Date.now().toString(36)}`,
        amount: amountPaise,
        currency: 'INR',
        keyId: 'rzp_test_demo',
      });
    }

    /* --------------------- Real Razorpay order --------------------- */
    const rzp = new Razorpay({ key_id: RZP_KEY_ID, key_secret: RZP_KEY_SECRET });

    const order = await rzp.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: `prn_${shopSlug.slice(0, 20)}_${Date.now().toString(36)}`,
      notes: {
        kind: 'print_order',
        shopSlug,
        customerName,
        ...(customerPhone ? { customerPhone } : {}),
      },
    });

    return NextResponse.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: RZP_KEY_ID,
    });
  } catch (err) {
    // Always answer with JSON — never let a raw exception bubble up and
    // render Next.js' HTML error page (breaks API clients on Vercel).
    console.error('[create-print-order] error:', err);
    return NextResponse.json(
      {
        success: false,
        error: `Could not create payment order${err?.message ? `: ${err.message}` : ''}`,
      },
      { status: 500 }
    );
  }
}
