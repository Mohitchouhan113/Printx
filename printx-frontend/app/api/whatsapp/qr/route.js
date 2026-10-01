import { NextResponse } from 'next/server';
import { getQR } from '../../../../lib/whatsapp-gateway';

/**
 * GET /api/whatsapp/qr — returns the current QR code string for scanning.
 *
 * The client renders this with qrcode.react or any QR library.
 * Returns null if no QR is pending (already connected or not started).
 */

export async function GET() {
  try {
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
