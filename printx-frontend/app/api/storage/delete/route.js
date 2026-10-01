import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseAdminConfigured } from '../../../../lib/supabaseAdmin';

/**
 * POST /api/storage/delete  { jobId }
 *
 * Privacy purge for ONE completed print job:
 *   1. Remove the job's PDF from its Supabase Storage bucket.
 *   2. NULL print_jobs.file_url (row retained for analytics, link is dead).
 *   3. Set orders.is_deleted_from_storage = true on the sidecar row.
 *
 * Fire-and-forget from the vendor queue when an order hits COMPLETED —
 * every step is logged loudly, partial failures still return what happened.
 */
export async function POST(request) {
  try {
    if (!isSupabaseAdminConfigured || !supabaseAdmin) {
      return NextResponse.json(
        { success: false, error: 'Storage service not configured (demo mode)' },
        { status: 503 }
      );
    }

    const { jobId } = await request.json().catch(() => ({}));
    if (!jobId) {
      return NextResponse.json({ success: false, error: 'jobId is required' }, { status: 400 });
    }

    const { data: job, error: jobErr } = await supabaseAdmin
      .from('print_jobs')
      .select('id, file_url, file_name')
      .eq('id', jobId)
      .maybeSingle();
    if (jobErr) {
      console.error('[storage/delete] job query failed:', jobErr.message);
      return NextResponse.json({ success: false, error: jobErr.message }, { status: 500 });
    }
    if (!job) {
      return NextResponse.json({ success: false, error: 'Job not found' }, { status: 404 });
    }

    let deleted = false;
    let warning = null;

    if (job.file_url) {
      const target = parseStorageTarget(job.file_url);
      if (target) {
        const { error: rmErr } = await supabaseAdmin.storage.from(target.bucket).remove([target.path]);
        if (rmErr) {
          warning = `storage remove failed: ${rmErr.message}`;
          console.error('[storage/delete]', warning);
        } else {
          deleted = true;
        }
      } else {
        console.warn('[storage/delete] unparseable file_url, skipping storage remove:', job.file_url);
      }
    }

    // Retain the row for analytics but kill the link. (No `updated_at` —
    // that column doesn't exist on every print_jobs schema; a missing column
    // would reject the WHOLE update.)
    const { error: nullErr } = await supabaseAdmin
      .from('print_jobs')
      .update({ file_url: null })
      .eq('id', jobId);
    if (nullErr) {
      warning = warning || `file_url clear failed: ${nullErr.message}`;
      console.error('[storage/delete]', warning);
    }

    // Spec: flag the sidecar row so the UI shows "Purged" instead of Download.
    let flagged = false;
    const { error: flagErr } = await supabaseAdmin
      .from('orders')
      .update({ is_deleted_from_storage: true })
      .eq('id', jobId);
    if (flagErr) {
      warning = warning || `sidecar flag failed: ${flagErr.message}`;
      console.error('[storage/delete] sidecar flag failed:', flagErr.message);
    } else {
      flagged = true;
    }

    return NextResponse.json({ success: deleted || flagged, deleted, flagged, warning });
  } catch (err) {
    console.error('[storage/delete] unexpected error:', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/** Supabase object URL → { bucket, path } (handles /public/ and /object/sign/). */
function parseStorageTarget(fileUrl) {
  try {
    const u = new URL(fileUrl);
    const m = u.pathname.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/);
    if (!m) return null;
    return { bucket: m[1], path: decodeURIComponent(m[2]) };
  } catch {
    return null;
  }
}
