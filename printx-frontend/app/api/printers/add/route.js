import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseAdminConfigured } from '../../../../lib/supabaseAdmin';
import { getShopActivePlan } from '../../../../lib/getShopActivePlan';

/**
 * POST /api/printers/add
 *
 * Server-side printer creation with max_printers quota enforcement.
 * Called by the vendor dashboard printers page instead of writing
 * directly to Supabase from the client.
 *
 * Body (JSON):
 *   shopId         — shops.id (UUID)
 *   name           — printer display name (required)
 *   connection_type — 'LAN_IP' | 'USB_LOCAL'
 *   ip_address     — required when connection_type = 'LAN_IP'
 *   port           — optional string
 *   is_color       — boolean
 *   is_default     — boolean
 *   model          — optional string
 *
 * Returns:
 *   200 { success: true, printer: { id, ... } }
 *   403 { success: false, error: '...', planLimitReached: true }
 *   400 { success: false, error: '...' }
 *   500 { success: false, error: '...' }
 */
export async function POST(request) {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    // Demo mode — accept the request without persisting
    return NextResponse.json({
      success: true,
      demo: true,
      printer: { id: `demo-${Date.now()}` },
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    shopId,
    name,
    connection_type = 'LAN_IP',
    ip_address = null,
    port = null,
    is_color = false,
    is_default = false,
    model = null,
  } = body || {};

  /* ---- Basic validation ---- */
  if (!shopId) {
    return NextResponse.json({ success: false, error: 'shopId is required' }, { status: 400 });
  }
  if (!name || !String(name).trim()) {
    return NextResponse.json({ success: false, error: 'Printer name is required' }, { status: 400 });
  }
  if (connection_type === 'LAN_IP' && !ip_address) {
    return NextResponse.json(
      { success: false, error: 'IP address is required for LAN printers' },
      { status: 400 }
    );
  }

  /* ---- Printer quota enforcement ----
   * max_printers is resolved from the shop's ACTIVE subscriptions row (the
   * entitlement snapshot written at payment/assignment time), falling back
   * to the plans catalog — see lib/getShopActivePlan. No hardcoded limit:
   * block ONLY when the live printer count has reached the numeric cap.
   * Fail-open: any error in the quota check degrades to "allow" so an
   * infrastructure issue never silently blocks a legitimate printer add. */
  try {
    const activePlan = await getShopActivePlan(shopId);
    const maxPrinters = activePlan.max_printers;

    // null / non-finite / negative (−1) ⇒ unlimited, nothing to enforce.
    if (Number.isFinite(maxPrinters) && maxPrinters >= 0) {
      const { count, error: countErr } = await supabaseAdmin
        .from('printers')
        .select('*', { count: 'exact', head: true })
        .eq('shop_id', shopId);

      if (!countErr && count != null && count >= maxPrinters) {
        return NextResponse.json(
          {
            success: false,
            error: `Printer limit reached. Your current plan supports up to ${maxPrinters} printer${maxPrinters === 1 ? '' : 's'}. Please upgrade your plan.`,
            planLimitReached: true,
            maxPrinters,
            currentCount: count,
          },
          { status: 403 }
        );
      }
    }
  } catch (quotaErr) {
    // Fail-open: log but never block a printer add on a quota-check failure
    console.warn('[printers/add] quota check error — allowing add:', quotaErr?.message || quotaErr);
  }

  /* ---- Insert printer row ---- */
  const insertPayload = {
    shop_id: shopId,
    name: String(name).trim(),
    connection_type: connection_type || 'LAN_IP',
    ip_address: ip_address ? String(ip_address).trim() : null,
    is_color: Boolean(is_color),
    is_default: Boolean(is_default),
    status: 'online',
  };
  if (port) insertPayload.port = String(port).trim();
  if (model && String(model).trim()) insertPayload.model = String(model).trim();

  const { data: printer, error: insertErr } = await supabaseAdmin
    .from('printers')
    .insert([insertPayload])
    .select()
    .single();

  if (insertErr) {
    console.error('[printers/add] insert error:', insertErr.message, insertErr.code);
    return NextResponse.json(
      { success: false, error: insertErr.message || 'Failed to add printer' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, printer });
}
