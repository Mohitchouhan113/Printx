import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { DEMO_COUPONS } from '../../../../lib/pricing';

/**
 * POST /api/coupons/validate
 *
 * Validates a promo code against the shop's coupons table.
 *
 * Body: { code, shopSlug }
 *   code     — coupon code as entered by customer (case-insensitive)
 *   shopSlug — shop whose coupons to check
 *
 * Returns:
 *   200 { success: true, coupon: { code, discount_type, discount_value } }
 *   404 { success: false, error: 'Invalid or expired coupon code' }
 *
 * Demo mode (no Supabase): validates against lib/pricing DEMO_COUPONS.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY) : null;

export async function POST(request) {
  try {
    const body = await request.json();
    const code = String(body.code || '').trim().toUpperCase();
    const shopSlug = String(body.shopSlug || '').trim();

    if (!code) {
      return NextResponse.json({ success: false, error: 'Coupon code is required' }, { status: 400 });
    }

    /* --------------------- Demo mode --------------------- */
    if (!supabaseAdmin) {
      const demo = DEMO_COUPONS[code];
      if (demo && demo.active) {
        return NextResponse.json({
          success: true,
          demo: true,
          coupon: {
            code: demo.code,
            discount_type: demo.discount_type,
            discount_value: demo.discount_value,
          },
        });
      }
      return NextResponse.json(
        { success: false, error: 'Invalid or expired coupon code' },
        { status: 404 }
      );
    }

    /* --------------------- Live mode --------------------- */
    // Resolve shop (slug is the caller's tenant handle)
    if (!shopSlug) {
      return NextResponse.json(
        { success: false, error: 'shopSlug is required' },
        { status: 400 }
      );
    }
    const { data: shop, error: shopErr } = await supabaseAdmin
      .from('shops')
      .select('id')
      .eq('slug', shopSlug)
      .maybeSingle();

    if (shopErr || !shop) {
      return NextResponse.json({ success: false, error: 'Shop not found' }, { status: 404 });
    }

    // Look up coupon — live coupons columns ONLY. The previous list
    // (discount_type, discount_value, active) plus the shop_id filter don't
    // exist on this table, so every request 400'd and even valid codes came
    // back as 404 "Invalid or expired". Coupons are global on this schema;
    // the response keeps the documented discount_type/discount_value shape.
    const { data: coupon, error: couponErr } = await supabaseAdmin
      .from('coupons')
      .select('id, code, discount_percent, max_uses, used_count, is_active')
      .eq('code', code)
      .eq('is_active', true)
      .maybeSingle();

    if (couponErr || !coupon) {
      if (couponErr) console.error('[coupons/validate] coupon query failed:', couponErr.message);
      return NextResponse.json(
        { success: false, error: 'Invalid or expired coupon code' },
        { status: 404 }
      );
    }

    // Check max_uses if set (print_jobs.applied_coupon is the live ledger)
    if (coupon.max_uses != null) {
      const { count } = await supabaseAdmin
        .from('print_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('applied_coupon', coupon.code);
      if ((count || 0) >= coupon.max_uses) {
        return NextResponse.json(
          { success: false, error: 'This coupon has reached its usage limit' },
          { status: 410 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      coupon: {
        code: coupon.code,
        // Live schema stores a single discount_percent — map it onto the
        // documented type/value pair the clients render.
        discount_type: 'percentage',
        discount_value: coupon.discount_percent,
      },
    });
  } catch (err) {
    console.error('[coupons/validate] unexpected error:', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
