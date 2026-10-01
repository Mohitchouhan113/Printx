import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseAdminConfigured as isSupabaseConfigured } from '../../../../lib/supabaseAdmin';
import { sendWhatsAppFireAndForget, buildCompletedMessage, calculatePrice } from '../../../../lib/whatsapp';

/**
 * POST /api/jobs/update-status
 *
 * Updates a print job's status and triggers WhatsApp notification when
 * the shop owner marks a job as COMPLETED.
 *
 * Body: { jobId, status, shopId? }
 *
 * When Supabase env vars are absent the route runs in DEMO mode:
 * validates the request and logs what would happen.
 */

const VALID_STATUSES = ['PENDING', 'PRINTING', 'COMPLETED', 'CANCELLED'];

export async function POST(request) {
  try {
    const body = await request.json();
    const { jobId, status, shopId } = body;

    /* ---- Validation ---- */
    if (!jobId) {
      return NextResponse.json({ success: false, error: 'jobId is required' }, { status: 400 });
    }
    if (!status || !VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { success: false, error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` },
        { status: 400 }
      );
    }

    /* ---- Demo mode (no Supabase) ---- */
    if (!isSupabaseConfigured || !supabaseAdmin) {
      console.log(`[update-status] DEMO — would update job ${jobId} to ${status}`);
      if (status === 'COMPLETED') {
        console.log(`[update-status] DEMO — would send WhatsApp pickup-ready notification`);
      }
      return NextResponse.json({
        success: true,
        demo: true,
        jobId,
        status,
        whatsappSent: status === 'COMPLETED',
      });
    }

    /* ---- Fetch current job ---- */
    const { data: job, error: fetchErr } = await supabaseAdmin
      .from('print_jobs')
      .select('id, status, customer_name, customer_phone, token_number, page_count, config, shop_id')
      .eq('id', jobId)
      .single();

    if (fetchErr || !job) {
      return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
    }

    /* ---- Update status ---- */
    const updatePayload = { status };
    if (status === 'COMPLETED') {
      updatePayload.completed_at = new Date().toISOString();
    }
    if (status === 'CANCELLED') {
      updatePayload.cancelled_at = new Date().toISOString();
    }

    const { error: updateErr } = await supabaseAdmin
      .from('print_jobs')
      .update(updatePayload)
      .eq('id', jobId);

    if (updateErr) {
      console.error('[update-status] update error:', updateErr);
      return NextResponse.json(
        { success: false, error: 'Failed to update status' },
        { status: 500 }
      );
    }

    /* ---- WhatsApp notification on COMPLETED ---- */
    let whatsappSent = false;
    if (status === 'COMPLETED' && job.customer_phone) {
      // Fetch shop details for notification
      const resolvedShopId = shopId || job.shop_id;

      const { data: shop } = await supabaseAdmin
        .from('shops')
        .select('name, bw_rate, color_rate, whatsapp_notifications_enabled')
        .eq('id', resolvedShopId)
        .single();

      if (shop?.whatsapp_notifications_enabled !== false && shop?.name) {
        const bwRate = shop.bw_rate || 2;
        const colorRate = shop.color_rate || 10;
        const price = calculatePrice(job.page_count, job.config || {}, bwRate, colorRate);

        const msg = buildCompletedMessage({
          customerName: job.customer_name || 'Customer',
          shopName: shop.name,
          tokenNumber: job.token_number,
          totalPrice: price.total,
        });

        sendWhatsAppFireAndForget({ to: job.customer_phone, message: msg });
        whatsappSent = true;
        console.log(`[update-status] WhatsApp pickup-ready sent for ${job.token_number}`);
      }
    }

    return NextResponse.json({
      success: true,
      jobId,
      status,
      previousStatus: job.status,
      whatsappSent,
    });
  } catch (err) {
    console.error('[update-status] unexpected error:', err?.message, err?.stack);
    return NextResponse.json(
      { success: false, error: err?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
