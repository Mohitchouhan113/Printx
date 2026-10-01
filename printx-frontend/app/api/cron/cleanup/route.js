import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseAdminConfigured } from '../../../../lib/supabaseAdmin';

/**
 * GET /api/cron/cleanup — 24-hour file auto-cleanup cron job.
 *
 * Secured by CRON_SECRET header — only Vercel Cron (or a manual call
 * with the correct token) can trigger this.
 *
 * What it does:
 *   1. Finds print_jobs older than 24 hours.
 *   2. Extracts storage file paths from file_url.
 *   3. Deletes files from the print-uploads bucket.
 *   4. NULLs file_url on the row (retains analytics, clears sensitive files).
 *
 * Called by Vercel Cron: "0 0 * * *" (midnight daily).
 * Can also be triggered manually:
 *   curl -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/cleanup
 */

const BUCKET = 'print-uploads';
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
      .select('id, file_url, file_name, shop_id')
      .lt('created_at', cutoff)
      .not('file_url', 'is', null);

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
    const filePaths = [];
    for (const job of expiredJobs) {
      const path = extractStoragePath(job.file_url);
      if (path) filePaths.push(path);
    }

    let deletedFilesCount = 0;

    if (filePaths.length > 0) {
      // Supabase storage.remove accepts up to 1000 paths per call
      // Batch in chunks of 100 for safety
      const BATCH_SIZE = 100;
      for (let i = 0; i < filePaths.length; i += BATCH_SIZE) {
        const batch = filePaths.slice(i, i + BATCH_SIZE);
        const { data: removed, error: removeErr } = await supabaseAdmin.storage
          .from(BUCKET)
          .remove(batch);

        if (removeErr) {
          console.error(`[cleanup] storage remove error (batch ${i}):`, removeErr);
          // Continue — we still null the file_url even if storage delete fails
          // (the file might already be gone or the path was malformed)
        } else {
          deletedFilesCount += removed?.length || batch.length;
        }
      }

      console.log(`[cleanup] Deleted ${deletedFilesCount} files from storage`);
    }

    /* ---- 5. NULL file_url on expired rows (retain analytics) ---- */
    const expiredIds = expiredJobs.map((j) => j.id);

    const { error: updateErr } = await supabaseAdmin
      .from('print_jobs')
      // No `updated_at` — the column doesn't exist on every print_jobs
      // schema and a missing column rejects the WHOLE update.
      .update({ file_url: null })
      .in('id', expiredIds);

    if (updateErr) {
      console.error('[cleanup] update error:', updateErr);
      return NextResponse.json(
        { success: false, error: 'Files deleted but failed to update job records' },
        { status: 500 }
      );
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
 * Extract the storage file path from a Supabase file URL.
 *
 * Handles:
 *   - Signed URLs:   https://xxx.supabase.co/storage/v1/object/sign/print-uploads/path/to/file?token=...
 *   - Public URLs:   https://xxx.supabase.co/storage/v1/object/public/print-uploads/path/to/file
 *   - Raw paths:     shop-id/1234567890-abc123-document.pdf (no URL prefix)
 */
function extractStoragePath(fileUrl) {
  if (!fileUrl) return null;

  // Already a raw path (no http prefix)
  if (!fileUrl.startsWith('http')) return fileUrl;

  try {
    const url = new URL(fileUrl);
    const pathname = url.pathname;

    // Match /storage/v1/object/{sign|public|authenticated}/BUCKET/PATH
    const match = pathname.match(
      /\/storage\/v1\/object\/(?:sign|public|authenticated)\/print-uploads\/(.+)/
    );
    if (match) return decodeURIComponent(match[1]);
  } catch {
    // malformed URL
  }

  return null;
}
