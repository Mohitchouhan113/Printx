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
 * When Supabase is not configured (demo mode) the endpoint returns a
 * deterministic simulated response so the UI is fully explorable locally.
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
    const shopId = searchParams.get('shopId');
    const tokenNumber = searchParams.get('token'); // demo fallback identifier

    /* ------------------------- Validation ------------------------- */
    if (!jobId && !tokenNumber) {
      return NextResponse.json(
        { success: false, error: 'jobId (or token) is required' },
        { status: 400 }
      );
    }

    /* --------------------- Demo mode (no Supabase) --------------------- */
    if (!supabaseAdmin) {
      // Deterministic pseudo-random from token/jobId so the number is stable
      // between polls but varies between different customers.
      const seedSource = String(jobId || tokenNumber || 'demo');
      let hash = 0;
      for (let i = 0; i < seedSource.length; i++) {
        hash = (hash * 31 + seedSource.charCodeAt(i)) % 997;
      }
      const position = (hash % 3) + 1; // 1..3
      const aheadPages = (hash % 40) + 10; // 10..50 pages ahead
      const ordersAhead = position - 1;
      const etaMinutes = Math.round(ordersAhead * MINUTES_PER_ORDER * 10) / 10;

      return NextResponse.json({
        success: true,
        demo: true,
        queuePosition: position,
        ordersAhead,
        totalInQueue: position + (hash % 2),
        aheadPages,
        estimatedMinutes: etaMinutes,
        jobStatus: position === 1 ? 'PRINTING' : 'PENDING',
        updatedAt: new Date().toISOString(),
      });
    }

    /* --------------------- Resolve the job --------------------- */
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
