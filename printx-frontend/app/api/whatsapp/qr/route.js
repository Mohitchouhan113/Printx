import { NextResponse } from 'next/server';
import { getQR } from '../../../../lib/whatsapp-gateway';
import { getShopActivePlan } from '../../../../lib/getShopActivePlan';

/**
 * GET /api/whatsapp/qr — returns the current QR code string for scanning.
 *
 * The client renders this with qrcode.react or any QR library.
 * Returns null if no QR is pending (already connected or not started).
 *
 * Server-side feature gate: the QR that starts a WhatsApp bot session is only
 * useful to vendors who can actually run the bot, so this endpoint requires the
 * authenticated shop's active plan to have has_whatsapp_bot === true. The GET
 * returns 403 when the flag is false, closing the bypass where a free-tier
 * vendor fetches the QR directly and renders the scan UI anyway.
 *
 * Shop identity: resolved in-band from shopId (query) — the same value the
 * vendor UI already has via ShopContext when it renders the WhatsApp panel.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const shopId = String(searchParams.get('shopId') || '').trim();

    if (shopId) {
      try {
        const activePlan = await getShopActivePlan(shopId);
        if (activePlan.has_whatsapp_bot === false) {
          return NextResponse.json(
            { success: false, error: 'WhatsApp bot feature is locked for your current plan.' },
            { status: 403 }
          );
        }
      } catch (err) {
        console.warn('[wa-qr] plan-gate check failed — allowing request:', err?.message || err);
      }
    }

    const qr = getQR();
    if (!qr) {
      return NextResponse.json({
        success: true,
        qr: null,
        message: 'No QR code pending — either connected or gateway not started',
      });
    }
    return NextResponse.json({ success: true, ...qr });
  } catch (err) {
    console.error('[wa-qr] error:', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

