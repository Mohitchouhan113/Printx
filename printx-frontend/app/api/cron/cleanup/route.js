import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseAdminConfigured } from '../../../../lib/supabaseAdmin';

// This route reads the request's Authorization header (CRON_SECRET) and must
// query Supabase at request time. Without this, `next build` attempts to
// pre-render it as a static route and fails.
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/cleanup — 24-hour file auto-cleanup cron job.
 *
 * Secured by CRON_SECRET header — only Vercel Cron (or a manual call
 * with the correct token) can trigger this.
 *
 * What it does:
 *   1. Finds print_jobs older than 24 hours.
 *   2. Extracts storage paths from file_url AND files_metadata[].fileUrl.
 *   3. Deletes those files from whichever bucket they live in.
 *   4. NULLs file_url AND scrubs files_metadata[].fileUrl (retains analytics,
 *      clears sensitive files, and stops the preview modal from requesting
 *      objects that no longer exist).
 *
 * Called by Vercel Cron: "0 0 * * *" (midnight daily).
 * Can also be triggered manually:
 *   curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/cleanup
 */

const BUCKET = 'print-uploads'; // legacy fallback for raw (non-URL) paths
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours in ms

export async function GET(request) {
  try {
    /* ---- 1. Authenticate via CRON_SECRET ---- */
    const authHeader = request.headers.get('authorization') || '';
    const cronSecret = process.env.CRON_SECRET;

    // In production, CRON_SECRET must be set and must match.
    // In demo mode (no secret configured), we still run but log a warning.
    if (cronSecret) {
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      if (token !== cronSecret) {
        return NextResponse.json(
          { success: false, error: 'Unauthorized — invalid or missing CRON_SECRET' },
          { status: 401 }
        );
      }
    } else {
      console.warn('[cleanup] ⚠ CRON_SECRET not set — running without auth (demo mode)');
    }

    /* ---- 2. Demo mode fallback ---- */
    if (!isSupabaseAdminConfigured || !supabaseAdmin) {
      console.warn('[cleanup] DEMO mode — Supabase not configured. No files deleted.');
      return NextResponse.json({
        success: true,
        demo: true,
        deletedFilesCount: 0,
        cleanedJobCount: 0,
        message: 'Demo mode — no Supabase to clean',
      });
    }

    /* ---- 3. Find expired print_jobs (>24h old) ---- */
    const cutoff = new Date(Date.now() - MAX_AGE_MS).toISOString();

    const { data: expiredJobs, error: queryErr } = await supabaseAdmin
      .from('print_jobs')
      .select('id, file_url, file_name, shop_id, files_metadata')
      .lt('created_at', cutoff)
      .or('file_url.not.is.null,files_metadata.not.is.null');

    if (queryErr) {
      console.error('[cleanup] query error:', queryErr);
      return NextResponse.json(
        { success: false, error: 'Failed to query expired jobs' },
        { status: 500 }
      );
    }

    if (!expiredJobs || expiredJobs.length === 0) {
      return NextResponse.json({
        success: true,
        deletedFilesCount: 0,
        cleanedJobCount: 0,
        message: 'No expired jobs found',
      });
    }

    console.log(`[cleanup] Found ${expiredJobs.length} expired jobs (>24h old)`);

    /* ---- 4. Extract storage paths and delete files ---- */
    // Bucket comes FROM the URL (print-files on current deploys, print-uploads
    // on legacy ones) — hardcoding one bucket silently skipped every live
    // object while file_url was still nulled below.
    const byBucket = new Map();
    const urlCandidates = [];
    for (const job of expiredJobs) {
      if (job.file_url) urlCandidates.push(job.file_url);
      if (Array.isArray(job.files_metadata)) {
        job.files_metadata.forEach((f) => f?.fileUrl && urlCandidates.push(f.fileUrl));
      }
    }
    for (const u of urlCandidates) {
      const target = extractStorageTarget(u);
      if (!target) continue;
      if (!byBucket.has(target.bucket)) byBucket.set(target.bucket, new Set());
      byBucket.get(target.bucket).add(target.path);
    }

    let deletedFilesCount = 0;

    for (const [bucket, pathSet] of byBucket) {
      const paths = [...pathSet];
      // Supabase storage.remove accepts up to 1000 paths per call
      // Batch in chunks of 100 for safety
      const BATCH_SIZE = 100;
      for (let i = 0; i < paths.length; i += BATCH_SIZE) {
        const batch = paths.slice(i, i + BATCH_SIZE);
        const { data: removed, error: removeErr } = await supabaseAdmin.storage
          .from(bucket)
          .remove(batch);

        if (removeErr) {
          console.error(`[cleanup] storage remove error (${batch} on ${bucket}):`, removeErr);
          // Continue — we still null the file_url even if storage delete fails
          // (the file might already be gone or the path was malformed)
        } else {
          deletedFilesCount += removed?.length || batch.length;
        }
      }
    }

    console.log(`[cleanup] Deleted ${deletedFilesCount} files from storage`);

    /* ---- 5. NULL file_url + scrub files_metadata URLs on expired rows ---- */
    const expiredIds = expiredJobs.map((j) => j.id);
    const scrubbedById = new Map(
      expiredJobs.map((j) => [j.id, scrubMetadataUrls(j.files_metadata)])
    );

    // One update per row: files_metadata is JSONB and differs per job, and a
    // missing `updated_at` column would reject the whole update.
    for (const id of expiredIds) {
      const { error: updateErr } = await supabaseAdmin
        .from('print_jobs')
        .update({ file_url: null, files_metadata: scrubbedById.get(id) ?? null })
        .eq('id', id);
      if (updateErr) {
        console.error(`[cleanup] update error (job ${id}):`, updateErr);
        return NextResponse.json(
          { success: false, error: 'Files deleted but failed to update job records' },
          { status: 500 }
        );
      }
    }

    console.log(`[cleanup] Cleared file_url on ${expiredIds.length} jobs`);

    return NextResponse.json({
      success: true,
      deletedFilesCount,
      cleanedJobCount: expiredIds.length,
      message: `Cleaned ${expiredIds.length} expired jobs, deleted ${deletedFilesCount} files`,
    });
  } catch (err) {
    console.error('[cleanup] unexpected error:', err);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Zero out fileUrl on every files_metadata entry, KEEPING the analytics
 * fields (pageCount, colorMode, sides, copies…).
 */
function scrubMetadataUrls(metadata) {
  if (!Array.isArray(metadata)) return null;
  return metadata.map((f) => (f && typeof f === 'object' ? { ...f, fileUrl: null } : f));
}

/**
 * Extract { bucket, path } from a Supabase file URL.
 *
 * Handles:
 *   - Signed URLs:   https://xxx.supabase.co/storage/v1/object/sign/print-files/path?token=…
 *   - Public URLs:   https://xxx.supabase.co/storage/v1/object/public/print-files/path
 *   - Raw paths:     shop-id/1234567890-abc123-document.pdf (no URL prefix →
 *                    falls back to the legacy BUCKET)
 */
function extractStorageTarget(fileUrl) {
  if (!fileUrl) return null;

  // Already a raw path (no http prefix)
  if (!fileUrl.startsWith('http')) return { bucket: BUCKET, path: fileUrl };

  try {
    const url = new URL(fileUrl);

    // Match /storage/v1/object/{sign|public|authenticated}/BUCKET/PATH
    const match = url.pathname.match(
      /\/storage\/v1\/object\/(?:sign|public|authenticated)\/([^/]+)\/(.+)/
    );
    if (match) return { bucket: match[1], path: decodeURIComponent(match[2]) };
  } catch {
    // malformed URL
  }

  return null;
}
