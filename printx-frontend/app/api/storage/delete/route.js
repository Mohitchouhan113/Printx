import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseAdminConfigured } from '../../../../lib/supabaseAdmin';

/**
 * POST /api/storage/delete  { jobId }
 *
 * Privacy purge for ONE completed print job:
 *   1. Remove the job's file(s) from their Supabase Storage bucket(s) —
 *      both the legacy file_url object and every files_metadata[].fileUrl
 *      object (multi-file orders upload one object per file).
 *   2. NULL print_jobs.file_url AND scrub files_metadata[].fileUrl
 *      (row retained for analytics; links are dead). Leaving stale metadata
 *      URLs behind made the preview modal fetch objects that no longer exist.
 *   3. NULL orders.file_url + set orders.is_deleted_from_storage = true on
 *      the sidecar row.
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
      .select('id, file_url, file_name, files_metadata')
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

    // Collect every object the row points at: legacy file_url plus each
    // multi-file metadata entry, grouped by bucket, deduped.
    const urls = [job.file_url];
    if (Array.isArray(job.files_metadata)) {
      job.files_metadata.forEach((f) => urls.push(f?.fileUrl));
    }
    const byBucket = new Map();
    for (const u of urls.filter(Boolean)) {
      const target = parseStorageTarget(u);
      if (target) {
        if (!byBucket.has(target.bucket)) byBucket.set(target.bucket, new Set());
        byBucket.get(target.bucket).add(target.path);
      } else {
        console.warn('[storage/delete] unparseable file URL, skipping storage remove:', u);
      }
    }

    for (const [bucket, paths] of byBucket) {
      const { error: rmErr } = await supabaseAdmin.storage.from(bucket).remove([...paths]);
      if (rmErr) {
        warning = `storage remove failed (${bucket}): ${rmErr.message}`;
        console.error('[storage/delete]', warning);
      } else {
        deleted = true;
      }
    }

    // Retain the row for analytics but kill every link. (No `updated_at` —
    // that column doesn't exist on every print_jobs schema; a missing column
    // would reject the WHOLE update.)
    const { error: nullErr } = await supabaseAdmin
      .from('print_jobs')
      .update({ file_url: null, files_metadata: scrubMetadataUrls(job.files_metadata) })
      .eq('id', jobId);
    if (nullErr) {
      warning = warning || `file_url clear failed: ${nullErr.message}`;
      console.error('[storage/delete]', warning);
    }

    // Spec: flag the sidecar row so the UI shows "Purged" instead of Download.
    // Its file_url must die with the object too — the preview modal falls back
    // to the sidecar URL when files_metadata is absent.
    let flagged = false;
    const { error: flagErr } = await supabaseAdmin
      .from('orders')
      .update({ is_deleted_from_storage: true, file_url: null })
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

/**
 * Zero out fileUrl on every files_metadata entry while KEEPING the analytics
 * fields (pageCount, colorMode, sides, copies…). Returning null for the whole
 * array would throw away the page/color metadata the modal renders.
 */
function scrubMetadataUrls(metadata) {
  if (!Array.isArray(metadata)) return null;
  return metadata.map((f) => (f && typeof f === 'object' ? { ...f, fileUrl: null } : f));
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
