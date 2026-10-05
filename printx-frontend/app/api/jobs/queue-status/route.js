import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/jobs/queue-status?jobId=…&shopId=…
 *
 * Real-time queue position + ETA engine for the customer confirmation screen.
 *
 * Calculation:
 *   1. Count jobs for the same shop with status IN ('PENDING','PRINTING')
 *      created BEFORE this job → queuePosition = count + 1.
 *   2. estimatedMinutes = orders ahead × 1.5 minutes (spec: average 1.5
 *      minutes per order). ordersAhead = queuePosition − 1.
 *
 * When Supabase is not configured the endpoint returns `unavailable: true`
 * rather than simulated queue data — status is never faked on the client.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY) : null;

/** Seconds of print time per page (used for aheadPages context) */
const SECONDS_PER_PAGE = 5;
/** Average minutes to process ONE queued order (spec: 1.5 min/order) */
const MINUTES_PER_ORDER = 1.5;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');
    let shopId = searchParams.get('shopId');
    const shopSlug = searchParams.get('shopSlug');
    const tokenNumber = searchParams.get('token');

    /* ------------------------- Validation ------------------------- */
    if (!jobId && !tokenNumber) {
      return NextResponse.json(
        { success: false, error: 'jobId (or token) is required' },
        { status: 400 }
      );
    }

    /* --------------------- No database configured --------------------- */
    if (!supabaseAdmin) {
      // STRICT MODE: never invent queue numbers or a job status. This used to
      // hash the token into a fake position and report the order as PRINTING,
      // which is indistinguishable from a real queue update on the customer's
      // screen. Report the failure honestly instead.
      console.warn('[queue-status] Supabase not configured — queue unavailable');
      return NextResponse.json({
        success: true,
        unavailable: true,
        queuePosition: null,
        ordersAhead: null,
        totalInQueue: null,
        aheadPages: null,
        estimatedMinutes: null,
        jobStatus: null,
        error: 'Live queue is unavailable right now — ask the counter for your status.',
        updatedAt: new Date().toISOString(),
      });
    }

    /* --------------------- Resolve the job --------------------- */
    // Token-only lookups need the shop to disambiguate. The customer page
    // knows the slug it was loaded from, so resolve slug → shop_id here.
    if (!shopId && shopSlug && supabaseAdmin) {
      const { data: shopRow } = await supabaseAdmin
        .from('shops')
        .select('id')
        .eq('slug', shopSlug)
        .maybeSingle();
      if (shopRow?.id) shopId = shopRow.id;
    }

    let job = null;
    if (jobId && /^[0-9a-f-]{36}$/i.test(jobId)) {
      const { data } = await supabaseAdmin
        .from('print_jobs')
        .select('id, shop_id, pages, status, created_at')
        .eq('id', jobId)
        .single();
      job = data;
    }
    if (!job && tokenNumber && shopId) {
      const { data } = await supabaseAdmin
        .from('print_jobs')
        .select('id, shop_id, pages, status, created_at')
        .eq('token_number', tokenNumber)
        .eq('shop_id', shopId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      job = data;
    }

    if (!job) {
      return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
    }

    const jobShopId = job.shop_id || shopId;

    /* --------------------- Jobs ahead in queue --------------------- */
    const { data: aheadJobs, error: aheadErr } = await supabaseAdmin
      .from('print_jobs')
      .select('id, pages, status, created_at')
      .eq('shop_id', jobShopId)
      .in('status', ['PENDING', 'PRINTING'])
      .lt('created_at', job.created_at)
      .order('created_at', { ascending: true });

    if (aheadErr) {
      console.error('[queue-status] ahead query error:', aheadErr);
      return NextResponse.json({ success: false, error: 'Queue lookup failed' }, { status: 500 });
    }

    const queuePosition = (aheadJobs?.length || 0) + 1;
    const ordersAhead = queuePosition - 1;
    const aheadPages = (aheadJobs || []).reduce(
      (sum, j) => sum + (j.pages || 1),
      0
    );

    // Spec: average 1.5 minutes per order ahead of you.
    const estimatedMinutes = Math.round(ordersAhead * MINUTES_PER_ORDER * 10) / 10;

    return NextResponse.json({
      success: true,
      queuePosition,
      ordersAhead,
      totalInQueue: queuePosition + (await countBehind(job, jobShopId)),
      aheadPages,
      estimatedMinutes,
      jobStatus: job.status,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[queue-status] unexpected error:', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/** Count active jobs created after this one (for "X in queue" display). */
async function countBehind(job, shopId) {
  try {
    const { count, error } = await supabaseAdmin
      .from('print_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('shop_id', shopId)
      .in('status', ['PENDING', 'PRINTING'])
      .gt('created_at', job.created_at);
    if (error) return 0;
    return count || 0;
  } catch {
    return 0;
  }
}
