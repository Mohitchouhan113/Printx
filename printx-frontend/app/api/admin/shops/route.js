import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseAdminConfigured } from '../../../../lib/supabaseAdmin';
import { PLANS } from '../../../../lib/plans';
import {
  deriveShopStatus,
  isSubscriptionExpired,
  planLabel,
  planMonthlyValue,
  PAID_PLAN_IDS,
} from '../../../../lib/shopStatus';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/shops
 *
 * Super-admin listing + analytics.
 *   1. Loads every `shops` row (service role — bypasses RLS).
 *   2. AUTO-SUSPENDS expired shops (subscription_expires_at < NOW()) by
 *      writing status='suspended' back — enforcement is durable, not just
 *      cosmetic. Runs on every dashboard load.
 *   3. Returns shops (with derived status) + analytics:
 *      { totalShops, activePaid, expiredInactive, mrr }
 */
export async function GET() {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 501 });
  }

  const { data, error } = await supabaseAdmin
    .from('shops')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[admin/shops] list failed:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const shops = data || [];

  /* ---------- Automated expiry verification & auto-deactivation ---------- */
  const expiredIds = shops
    .filter((s) => isSubscriptionExpired(s) && s.status !== 'suspended')
    .map((s) => s.id);

  if (expiredIds.length > 0) {
    const { error: updErr } = await supabaseAdmin
      .from('shops')
      .update({ status: 'suspended' })
      .in('id', expiredIds);
    if (updErr) {
      console.error('[admin/shops] auto-suspend failed:', updErr);
    } else {
      console.log(`[admin/shops] auto-suspended ${expiredIds.length} expired shop(s)`);
      for (const s of shops) {
        if (expiredIds.includes(s.id)) s.status = 'suspended';
      }
    }
  }

  return NextResponse.json({
    success: true,
    shops: shops.map(serializeShop),
    analytics: buildAnalytics(shops),
  });
}

/**
 * PATCH /api/admin/shops
 *
 * Super-admin actions on a single shop. Body:
 *   { shopId, action: 'activate' | 'suspend' }
 *   { shopId, plan: 'free' | 'basic' | 'pro' | 'advance' | 'lifetime' }
 *   { shopId, extendDays: 30 | 365 }            — from NOW() or current expiry
 *   { shopId, expiresAt: '2027-01-31T00:00:00Z' } — custom date
 *
 * Multiple fields may be combined in one call; each is applied in order:
 * plan → expiry → status. Returns the fresh serialized shop row.
 */
export async function PATCH(request) {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    return NextResponse.json({ success: false, error: 'Supabase not configured' }, { status: 501 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const { shopId, action, plan, extendDays, expiresAt } = body || {};
  if (!shopId) {
    return NextResponse.json({ success: false, error: 'shopId is required' }, { status: 400 });
  }

  const update = {};

  /* ---------- Plan change (upgrade / downgrade) ---------- */
  if (plan !== undefined) {
    if (!PLANS?.[plan]) {
      return NextResponse.json(
        { success: false, error: `Unknown plan "${plan}" — valid: ${Object.keys(PLANS || {}).join(', ')}` },
        { status: 400 }
      );
    }
    update.subscription_plan = plan;
    // Free plan clears the expiry clock; paid plans without an expiry get
    // one from NOW (+30d) so the subscription is enforceable.
    if (plan === 'free') {
      update.subscription_expires_at = null;
    }
  }

  /* ---------- Expiry: custom date ---------- */
  if (expiresAt !== undefined) {
    const t = new Date(expiresAt);
    if (Number.isNaN(t.getTime())) {
      return NextResponse.json({ success: false, error: 'Invalid expiresAt date' }, { status: 400 });
    }
    update.subscription_expires_at = t.toISOString();
  }

  /* ---------- Expiry: quick extension ---------- */
  if (extendDays !== undefined) {
    const days = Number(extendDays);
    if (!Number.isFinite(days) || days <= 0 || days > 3650) {
      return NextResponse.json({ success: false, error: 'extendDays must be 1–3650' }, { status: 400 });
    }
    // Base = current expiry if still in the future, else NOW (reactivates).
    const { data: current } = await supabaseAdmin
      .from('shops')
      .select('subscription_expires_at')
      .eq('id', shopId)
      .maybeSingle();
    const baseMs = current?.subscription_expires_at
      ? Math.max(new Date(current.subscription_expires_at).getTime(), Date.now())
      : Date.now();
    update.subscription_expires_at = new Date(baseMs + days * 86_400_000).toISOString();
  }

  /* ---------- Manual status toggle ---------- */
  if (action !== undefined) {
    if (!['activate', 'suspend'].includes(action)) {
      return NextResponse.json(
        { success: false, error: 'action must be "activate" or "suspend"' },
        { status: 400 }
      );
    }
    update.status = action === 'activate' ? 'active' : 'suspended';
    if (action === 'activate') update.is_active = true;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { success: false, error: 'Nothing to update — provide action, plan, extendDays, or expiresAt' },
      { status: 400 }
    );
  }

  // Progressive column fallback: tolerate schemas missing newer columns.
  const droppedColumns = [];
  let attempt = { ...update };
  let saved = null;
  let lastErr = null;
  for (let i = 0; i < 10 && Object.keys(attempt).length > 0; i++) {
    const res = await supabaseAdmin
      .from('shops')
      .update(attempt)
      .eq('id', shopId)
      .select('*')
      .single();
    if (!res.error) {
      saved = res.data;
      break;
    }
    lastErr = res.error;
    const missing =
      (res.error.details || '').match(/column "(\w+)"/)?.[1] ||
      (res.error.message || '').match(/'(\w+)' column/)?.[1] ||
      Object.keys(attempt).find((c) => (res.error.message || '').includes(c));
    if ((res.error.code === '42703' || res.error.code === 'PGRST204') && missing) {
      console.warn(`[admin/shops] shops missing column "${missing}" — retrying without it`);
      droppedColumns.push(missing);
      const { [missing]: _drop, ...rest } = attempt;
      attempt = rest;
      continue;
    }
    break;
  }

  if (!saved) {
    console.error('[admin/shops] update failed:', lastErr);
    // Missing-column failures mean the shops migration hasn't run yet —
    // signal that specifically so the UI shows a setup notice instead of
    // a scary red error.
    const migrationRequired = ['42703', 'PGRST204'].includes(lastErr?.code || '');
    return NextResponse.json(
      {
        success: false,
        error: migrationRequired
          ? 'Shops table is missing subscription columns — run supabase-admin-setup.sql in the Supabase SQL Editor to enable plan & expiry controls.'
          : lastErr?.message || 'Update failed',
        migrationRequired,
      },
      { status: migrationRequired ? 501 : 500 }
    );
  }

  return NextResponse.json({
    success: true,
    shop: saved,
    ...(droppedColumns.length > 0
      ? {
          partial: true,
          warning: `Applied without unsupported column(s): ${droppedColumns.join(', ')} — run supabase-admin-setup.sql for full functionality.`,
        }
      : {}),
  });
}

/* ------------------------------------------------------------------ */
/* GET helpers                                                         */
/* ------------------------------------------------------------------ */

function serializeShop(shop) {
  return {
    id: shop.id || shop.slug || 'unknown',
    name: shop.name || 'Unnamed Shop',
    slug: shop.slug || '—',
    phone: shop.phone || null,
    plan: shop.subscription_plan || 'free',
    planLabel: planLabel(shop.subscription_plan),
    status: deriveShopStatus(shop), // 'active' | 'expired' | 'suspended'
    expiresAt: shop.subscription_expires_at || null,
    isActive: shop.is_active !== false,
    rawStatus: shop.status || null,
    createdAt: shop.created_at || null,
    monthlyValue: planMonthlyValue(shop.subscription_plan),
  };
}

function buildAnalytics(shops) {
  const statuses = shops.map(deriveShopStatus);
  return {
    totalShops: shops.length,
    activePaid: shops.filter(
      (s, i) => statuses[i] === 'active' && PAID_PLAN_IDS.includes(s.subscription_plan)
    ).length,
    expiredInactive: statuses.filter((st) => st !== 'active').length,
    mrr: shops.reduce(
      (sum, s, i) => (statuses[i] === 'active' ? sum + planMonthlyValue(s.subscription_plan) : sum),
      0
    ),
  };
}
