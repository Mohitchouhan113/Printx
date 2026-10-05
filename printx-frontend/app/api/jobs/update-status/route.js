import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseAdminConfigured as isSupabaseConfigured } from '../../../../lib/supabaseAdmin';
import { selectStrict, isMissingColumn } from '../../../../lib/supabaseSelect';
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

const VALID_STATUSES = ['PENDING', 'QUEUED', 'PRINTING', 'COMPLETED', 'CANCELLED'];

/** 'QUEUED' is the spec's name for the stored 'PENDING' state — one canonical value in the DB. */
const canonStatus = (s) => (String(s || '').toUpperCase() === 'QUEUED' ? 'PENDING' : String(s || '').toUpperCase());

export async function POST(request) {
  try {
    const body = await request.json();
    const { jobId, shopId } = body;
    const status = canonStatus(body?.status);

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
    // `page_count` / `config` are not present on every print_jobs schema and
    // PostgREST rejects the WHOLE select when one column is missing — which
    // made every status update answer 404 "Job not found", so orders could
    // never leave the queue. selectStrict retries with the columns that are
    // guaranteed to exist.
    const { data: job, error: fetchErr } = await selectStrict(
      (cols) =>
        supabaseAdmin
          .from('print_jobs')
          .select(cols)
          .eq('id', jobId)
          .single(),
      'id, status, customer_name, customer_phone, token_number, page_count, pages, config, shop_id',
      'id, status, customer_name, customer_phone, token_number, pages, shop_id',
      'print_jobs:update-status'
    );

    if (fetchErr || !job) {
      return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
    }

    /* ---- Update status ---- */
    // `completed_at` / `cancelled_at` are migration-dependent columns. When
    // they are absent PostgREST rejects the WHOLE update (PGRST204), which
    // made "Mark Ready for Pickup" fail with a 500 — an order could never
    // reach COMPLETED. Retry with just `status` (the field that actually
    // drives the queue and the customer's screen) when a column is missing.
    const stampKey =
      status === 'COMPLETED' ? 'completed_at' : status === 'CANCELLED' ? 'cancelled_at' : null;

    const runUpdate = (payload) =>
      supabaseAdmin.from('print_jobs').update(payload).eq('id', jobId);

    let { error: updateErr } = await runUpdate({
      status,
      ...(stampKey ? { [stampKey]: new Date().toISOString() } : {}),
    });

    if (updateErr && stampKey && isMissingColumn(updateErr)) {
      console.warn(
        `[update-status] print_jobs has no "${stampKey}" column — persisting status only`
      );
      ({ error: updateErr } = await runUpdate({ status }));
    }

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

      // Non-blocking: status updates must succeed even if WhatsApp fails.
      try {
        if (shop?.whatsapp_notifications_enabled !== false && shop?.name) {
          const bwRate = shop.bw_rate || 2;
          const colorRate = shop.color_rate || 10;
          const price = calculatePrice(job.page_count ?? job.pages ?? 1, job.config || {}, bwRate, colorRate);

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
      } catch (waErr) {
        console.error('[update-status] WhatsApp notification failed (non-fatal):', waErr?.message);
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
