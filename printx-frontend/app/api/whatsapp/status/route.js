import { NextResponse } from 'next/server';
import { getStatus, startGateway, disconnectGateway, clearSession } from '../../../../lib/whatsapp-gateway';

/**
 * GET  /api/whatsapp/status — returns connection status
 * POST /api/whatsapp/status — start/restart the gateway
 * DELETE /api/whatsapp/status — disconnect + clear session
 */

export async function GET() {
  try {
    const status = getStatus();
    return NextResponse.json({ success: true, ...status });
  } catch (err) {
    console.error('[wa-status] error:', err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST() {
  try {
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
