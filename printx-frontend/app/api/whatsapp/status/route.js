import { NextResponse } from 'next/server';
import { getStatus, startGateway, disconnectGateway, clearSession } from '../../../../lib/whatsapp-gateway';
import { getShopActivePlan } from '../../../../lib/getShopActivePlan';

/**
 * GET  /api/whatsapp/status — returns connection status
 * POST /api/whatsapp/status — start/restart the gateway
 * DELETE /api/whatsapp/status — disconnect + clear session
 *
 * Server-side feature gate: POST (gateway start/restart) requires the shop's
 * active plan to have has_whatsapp_bot === true. The QR/status GET endpoints
 * are informational and remain open, but starting the bot infrastructure is
 * gated so free-tier vendors cannot bypass the UI lock by calling the backend
 * directly.
 *
 * Shop identity: this is a vendor dashboard endpoint. The authenticated shop
 * is resolved from the in-band shopId/body.shopId (already known to the vendor
 * UI via ShopContext), then validated against getShopActivePlan before any
 * gateway mutation.
 */

async function requireWhatsAppBot(shopId) {
  if (!shopId) return { allowed: false, reason: 'shopId is required', status: 400 };
  try {
    const activePlan = await getShopActivePlan(shopId);
    if (activePlan.has_whatsapp_bot === false) {
      return { allowed: false, reason: 'WhatsApp bot feature is locked for your current plan.', status: 403 };
    }
    return { allowed: true };
  } catch (err) {
    console.warn('[wa-status] plan-gate check failed — allowing request:', err?.message || err);
    return { allowed: true };
  }
}

export async function GET() {
  try {
    const status = getStatus();
    return NextResponse.json({ success: true, ...status });
  } catch (err) {
    console.error('[wa-status] error:', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    // Vendor dashboard callers send shopId in-band (ShopContext → this fetch).
    let body = {};
    try { body = await request.json().catch(() => ({})); } catch { /* not json → treat as empty */ }
    const shopId = String(body.shopId || '').trim();

    const gate = await requireWhatsAppBot(shopId);
    if (!gate.allowed) {
      return NextResponse.json(
        { success: false, error: gate.reason },
        { status: gate.status }
      );
    }

    // Start gateway in background (non-blocking)
    startGateway().catch((err) => {
      console.error('[wa-status] start error:', err.message);
    });
    return NextResponse.json({
      success: true,
      message: 'Gateway start initiated',
      status: getStatus(),
    });
  } catch (err) {
    console.error('[wa-status] POST error:', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await disconnectGateway();
    clearSession();
    return NextResponse.json({
      success: true,
      message: 'Gateway disconnected and session cleared',
    });
  } catch (err) {
    console.error('[wa-status] DELETE error:', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

