import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseAdminConfigured as isSupabaseConfigured } from '../../../../lib/supabaseAdmin';
import { selectStrict } from '../../../../lib/supabaseSelect';
import {
  sendWhatsAppMessage,
  buildSubmissionMessage,
  buildCompletedMessage,
  buildWalkInMessage,
  formatPhone,
} from '../../../../lib/whatsapp';

/**
 * POST /api/notifications/whatsapp
 *
 * Central status-triggered WhatsApp notification endpoint.
 *
 * Body: { jobId, event, shopId? }
 *   event — 'ORDER_CREATED' | 'ORDER_READY'
 *
 * ORDER_CREATED: "Your order #TK-{token} has been received at {shopName}!"
 * ORDER_READY:   "🎉 Your prints are ready for pickup at {shopName}!
 *                 Show Token #{token} at the counter."
 *
 * Resolves the shop + job from Supabase, honours the shop's
 * whatsapp_notifications_enabled preference, and returns per-message
 * delivery results. Demo mode validates and reports what would send.
 */

const EVENTS = {
  ORDER_CREATED: {
    label: 'Order Created',
    // falls back to buildSubmissionMessage when full pricing metadata exists
    build: ({ shopName, tokenNumber, customerName, meta }) =>
      `Hello ${customerName || 'Customer'}! 📄\n` +
      `Your order *${tokenNumber}* has been received at *${shopName}*!\n\n` +
      (meta?.pageCount
        ? `📊 *Details:* ${meta.pageCount} Pages` +
          (meta.bwPages != null ? ` (${meta.bwPages} B&W, ${meta.colorPages ?? 0} Color)` : '') +
          '\n'
        : '') +
      (meta?.totalPrice != null ? `💰 *Bill Amount:* ₹${meta.totalPrice}\n\n` : '\n') +
      `Please present Token ${tokenNumber} at the counter.`,
  },
  ORDER_READY: {
    label: 'Order Ready',
    build: ({ shopName, tokenNumber, customerName, meta }) =>
      `🎉 *Your Prints are Ready!*\n\n` +
      `Your prints are ready for pickup at *${shopName}*!\n` +
      `Show Token *${tokenNumber}* at the counter.` +
      (meta?.totalPrice != null ? `\n💰 Amount: ₹${meta.totalPrice}` : '') +
      `\n\nThank you for using PrintX!`,
  },
};

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const jobId = String(body.jobId || '').trim();
    const event = String(body.event || '').trim().toUpperCase();
    const shopId = String(body.shopId || '').trim();

    /* ---- Validation ---- */
    if (!jobId) {
      return NextResponse.json({ success: false, error: 'jobId is required' }, { status: 400 });
    }
    if (!EVENTS[event]) {
      return NextResponse.json(
        { success: false, error: `Unknown event "${event}". Valid: ${Object.keys(EVENTS).join(', ')}` },
        { status: 400 }
      );
    }

    /* ---- Demo mode (no Supabase) ---- */
    if (!isSupabaseConfigured || !supabaseAdmin) {
      const tpl = EVENTS[event];
      const preview = tpl.build({
        shopName: 'Demo Shop',
        tokenNumber: '#TK-00',
        customerName: 'Demo Customer',
        meta: { pageCount: 1, totalPrice: 0 },
      });
      console.log(`[notifications] DEMO ${event} — would notify job ${jobId}:\n${preview}`);
      return NextResponse.json({
        success: true,
        demo: true,
        event,
        jobId,
        messagePreview: preview,
      });
    }

    /* ---- Fetch the job ---- */
    // page_count / final_price are absent on some print_jobs schemas; a single
    // missing column makes PostgREST reject the whole select, which silently
    // turned notifications into 404s. selectStrict degrades gracefully.
    const { data: job, error: jobErr } = await selectStrict(
      (cols) =>
        supabaseAdmin
          .from('print_jobs')
          .select(cols)
          .eq('id', jobId)
          .single(),
      'id, token_number, customer_name, customer_phone, page_count, pages, config, final_price, status, shop_id',
      'id, token_number, customer_name, customer_phone, pages, status, shop_id',
      'print_jobs:notify'
    );

    if (jobErr || !job) {
      return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
    }

    const resolvedShopId = shopId || job.shop_id;

    /* ---- Fetch the shop (name + notification preference) ---- */
    const { data: shop } = await supabaseAdmin
      .from('shops')
      .select('name, whatsapp_notifications_enabled')
      .eq('id', resolvedShopId)
      .single();

    if (!shop?.name) {
      return NextResponse.json({ success: false, error: 'Shop not found' }, { status: 404 });
    }
    if (shop.whatsapp_notifications_enabled === false) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'Shop has disabled WhatsApp notifications',
        event,
        jobId,
      });
    }

    /* ---- Recipient ---- */
    const to = formatPhone(job.customer_phone);
    if (!to) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'No valid customer phone on this job',
        event,
        jobId,
      });
    }

    /* ---- Build + send ---- */
    const meta = {
      pageCount: job.page_count ?? job.pages ?? null,
      totalPrice: job.final_price,
    };
    const message = EVENTS[event].build({
      shopName: shop.name,
      tokenNumber: job.token_number,
      customerName: job.customer_name,
      meta,
    });

    const result = await sendWhatsAppMessage({ to, message });

    return NextResponse.json({
      success: result.success,
      event,
      jobId,
      tokenNumber: job.token_number,
      to,
      provider: result.provider || (result.demo ? 'demo' : 'gateway'),
      messageId: result.messageId || null,
      error: result.error || null,
    });
  } catch (err) {
    console.error('[notifications] unexpected error:', err?.message, err?.stack);
    return NextResponse.json(
      { success: false, error: err?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
