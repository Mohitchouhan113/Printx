import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseAdminConfigured } from '../../../../lib/supabaseAdmin';

const BUCKET = 'print-files';

/**
 * GET /api/storage/admin
 * Live storage metrics for the Super Admin Storage tab:
 *   - usedBytes / fileCount  — real recursive listing of the bucket
 *   - orphanCount            — files on storage no print job references
 */
export async function GET() {
  try {
    if (!isSupabaseAdminConfigured || !supabaseAdmin) {
      return NextResponse.json({ success: false, error: 'Storage service not configured' }, { status: 503 });
    }

    const files = await collectBucketFiles();

    const { data: jobs, error: jobsErr } = await supabaseAdmin
      .from('print_jobs')
      .select('file_url')
      .not('file_url', 'is', null)
      .limit(5000);
    if (jobsErr) {
      console.error('[storage/admin] job query failed:', jobsErr.message);
    }

    const referenced = new Set(
      (jobs || [])
        .map((j) => parseStoragePath(j.file_url)?.path)
        .filter(Boolean)
    );
    const orphanCount = files.filter((f) => !referenced.has(f.path)).length;
    const usedBytes = files.reduce((sum, f) => sum + (f.size || 0), 0);

    return NextResponse.json({
      success: true,
      bucket: BUCKET,
      usedBytes,
      fileCount: files.length,
      orphanCount,
      referencedCount: referenced.size,
    });
  } catch (err) {
    console.error('[storage/admin] stats failed:', err);
    return NextResponse.json({ success: false, error: err.message || 'Stats failed' }, { status: 500 });
  }
}

/**
 * POST /api/storage/admin  { olderThanHours = 24 }
 * "🧹 Purge Completed Order Files (> 24 Hrs)":
 *   1. Find COMPLETED print_jobs older than the cutoff with a live file_url.
 *   2. Remove their PDFs from storage (batched ≤100 per call).
 *   3. NULL file_url + set orders.is_deleted_from_storage = true.
 */
export async function POST(request) {
  try {
    if (!isSupabaseAdminConfigured || !supabaseAdmin) {
      return NextResponse.json({ success: false, error: 'Storage service not configured' }, { status: 503 });
    }

    const body = await request.json().catch(() => ({}));
    const hours = Number(body.olderThanHours);
    const olderThanHours = Number.isFinite(hours) && hours >= 0 ? hours : 24;
    const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000).toISOString();

    const { data: jobs, error: queryErr } = await supabaseAdmin
      .from('print_jobs')
      .select('id, file_url, file_name')
      .eq('status', 'COMPLETED')
      .lt('created_at', cutoff)
      .not('file_url', 'is', null)
      .limit(1000);
    if (queryErr) {
      console.error('[storage/admin] purge query failed:', queryErr.message);
      return NextResponse.json({ success: false, error: queryErr.message }, { status: 500 });
    }
    if (!jobs || jobs.length === 0) {
      return NextResponse.json({ success: true, deletedFiles: 0, cleanedJobs: 0, flaggedRows: 0, message: 'Nothing to purge' });
    }

    // Remove storage objects (grouped per bucket, batched ≤100).
    const targets = jobs
      .map((j) => ({ id: j.id, ...parseStoragePath(j.file_url) }))
      .filter((t) => t.path);
    const byBucket = new Map();
    targets.forEach((t) => {
      if (!byBucket.has(t.bucket)) byBucket.set(t.bucket, []);
      byBucket.get(t.bucket).push(t.path);
    });

    let deletedFiles = 0;
    for (const [bucket, paths] of byBucket) {
      for (let i = 0; i < paths.length; i += 100) {
        const batch = paths.slice(i, i + 100);
        const { error: rmErr } = await supabaseAdmin.storage.from(bucket).remove(batch);
        if (rmErr) {
          // Keep going — a path may already be gone; rows are nulled below anyway.
          console.error(`[storage/admin] remove batch failed (${bucket}):`, rmErr.message);
        } else {
          deletedFiles += batch.length;
        }
      }
    }

    // Kill the links, keep the analytics rows. (No `updated_at` — missing
    // columns reject the entire update on drifted schemas.)
    const ids = jobs.map((j) => j.id);
    const { error: nullErr } = await supabaseAdmin
      .from('print_jobs')
      .update({ file_url: null })
      .in('id', ids);
    if (nullErr) console.error('[storage/admin] file_url clear failed:', nullErr.message);

    // Flag sidecar rows so vendor UIs show "Purged".
    const { error: flagErr } = await supabaseAdmin
      .from('orders')
      .update({ is_deleted_from_storage: true })
      .in('id', ids);
    if (flagErr) console.error('[storage/admin] sidecar flag failed:', flagErr.message);

    return NextResponse.json({
      success: true,
      deletedFiles,
      cleanedJobs: jobs.length,
      flaggedRows: flagErr ? 0 : ids.length,
      olderThanHours,
    });
  } catch (err) {
    console.error('[storage/admin] purge failed:', err);
    return NextResponse.json({ success: false, error: err.message || 'Purge failed' }, { status: 500 });
  }
}

/** Recursively list the bucket (folders = shop UUIDs), paginated at 1000. */
async function collectBucketFiles() {
  const files = [];
  const walk = async (prefix, depth) => {
    if (depth > 4) return;
    let offset = 0;
    for (;;) {
      const { data, error } = await supabaseAdmin.storage
        .from(BUCKET)
        .list(prefix, { limit: 1000, offset });
      if (error) throw new Error(`storage list failed: ${error.message}`);
      const entries = data || [];
      for (const e of entries) {
        const full = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.metadata == null) {
          await walk(full, depth + 1); // folder
        } else {
          files.push({ path: full, size: e.metadata.size ?? e.metadata.contentLength ?? 0 });
        }
      }
      if (entries.length < 1000) break;
      offset += 1000;
    }
  };
  await walk('', 0);
  return files;
}

/** Supabase object URL → { bucket, path } or null. */
function parseStoragePath(fileUrl) {
  if (!fileUrl) return null;
  try {
    const u = new URL(fileUrl);
    const m = u.pathname.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/);
    if (!m) return null;
    return { bucket: m[1], path: decodeURIComponent(m[2]) };
  } catch {
    return null;
  }
}
