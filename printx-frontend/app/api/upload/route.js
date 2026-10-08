import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendWhatsAppFireAndForget, buildSubmissionMessage, calculatePrice } from '../../../lib/whatsapp';
import { nextDailyToken } from '../../../lib/dailyToken';
import { priorityWrite } from '../../../lib/priority';
import { getShopActivePlan } from '../../../lib/getShopActivePlan';
// NOTE: PLANS static catalog is intentionally NOT imported here — quota
// enforcement goes exclusively through getShopActivePlan (which has its
// own static fallback internally). Removing this import makes the intent
// explicit: this route does not use hardcoded plan limits.

/**
 * POST /api/upload — customer file upload → Supabase Storage + print_jobs row.
 *
 * Supports BOTH single-file (legacy) and multi-file batch uploads.
 *
 * FormData fields:
 *   file             — (legacy single-file) the document
 *   files            — (multi-file) multiple File entries under same key
 *   filesMetadata    — JSON string: Array<{ index, fileName, pageCount, colorMode, sides, copies }>
 *   customerName     — required string
 *   customerPhone    — optional 10-digit string
 *   shopSlug         — required, resolves to shops.id
 *   printConfig      — (legacy single-file) JSON string: { color, copies, doubleSided }
 *   pageCount        — (legacy single-file) integer
 *
 * Multi-file uploads produce ONE token number for the entire batch.
 * The print_jobs row stores `files_metadata` JSONB with per-file details,
 * and `file_url` points to the FIRST file (for backward compatibility with previews).
 *
 * When Supabase env vars are absent the route runs in DEMO mode.
 */

const MAX_SIZE_BYTES = 20 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
// Preferred storage bucket first; the legacy name stays as a fallback so
// existing deployments keep working.
const BUCKETS = ['print-files', 'print-uploads'];

const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY) : null;

/**
 * Columns the LIVE print_jobs schema has rejected so far.
 *
 * Module scope → persists for the lifetime of a warm serverless instance, so
 * schema drift is discovered once per cold start instead of once per order.
 * Populated adaptively from 42703 / PGRST204 responses.
 */
const MISSING_COLUMNS = new Set();

/** Same adaptive cache for the `orders` sidecar row (its own column set). */
const MISSING_ORDER_COLUMNS = new Set();

/**
 * Reshape a payload using what we already know the live schema lacks, so a
 * cached column is skipped on the FIRST request instead of costing a retry.
 *
 * `page_count` is REMAPPED onto `pages` rather than dropped — otherwise every
 * cached order would silently lose its page count and fall back to the column
 * default (1), which corrupts queue maths and the print ticket.
 */
function applyKnownColumns(payload) {
  if (MISSING_COLUMNS.size === 0) return payload;
  let out = payload;
  for (const col of MISSING_COLUMNS) {
    if (!Object.prototype.hasOwnProperty.call(out, col)) continue;
    if (col === 'page_count' && out.pages === undefined) {
      const { page_count: pagesValue, ...rest } = out;
      out = { ...rest, pages: pagesValue };
    } else {
      const { [col]: _dropped, ...rest } = out;
      out = rest;
    }
  }
  return out;
}

export async function POST(request) {
  try {
    const formData = await request.formData();
    const customerName = String(formData.get('customerName') || '').trim();
    const customerPhone = String(formData.get('customerPhone') || '').trim();
    const shopSlug = String(formData.get('shopSlug') || '').trim();

    // Pricing snapshot (optional — sent by the customer page)
    const originalPrice = parseFloat(formData.get('originalPrice') || '0') || null;
    const discountAmount = parseFloat(formData.get('discountAmount') || '0') || null;
    const appliedCoupon = String(formData.get('appliedCoupon') || '').trim() || null;
    const finalPrice = parseFloat(formData.get('finalPrice') || '0') || null;

    // Binding & finishing (order-level, optional — legacy clients omit it)
    const bindingType = String(formData.get('bindingType') || 'none').trim() || 'none';
    const bindingCost = parseFloat(formData.get('bindingCost') || '0') || 0;
    // Paper tray selection (orders.paper_size — determines which tray to load)
    const paperSize = String(formData.get('paperSize') || 'A4').trim() || 'A4';

    // ⚡ Priority Express Print (+₹10) — orders.is_priority (+ print_type carrier)
    const isPriority = ['1', 'true', 'yes', 'on'].includes(
      String(formData.get('isPriority') || '').trim().toLowerCase()
    );

    // Selective page range from the customer page — 'all' or "1-5, 8, 11-15"
    const pageRange = String(formData.get('pageRange') || 'all').trim() || 'all';

    // Smart AI color split totals from the client-side pixel scan →
    // orders.bw_pages / orders.color_pages (NaN-safe; absent on legacy clients)
    const bwPagesTotal = parseInt(formData.get('bwPages') ?? '', 10);
    const colorPagesTotal = parseInt(formData.get('colorPages') ?? '', 10);

    // Special instructions / notes from the customer — stored in both
    // print_jobs and orders so every read path finds them.
    const userNote = String(formData.get('notes') || '').trim() || null;

    console.log('📦 CREATING ORDER WITH NOTES:', userNote);

    // Payment selection from the mandatory Step 2
    const paymentStatus = String(formData.get('paymentStatus') || 'UNPAID').trim().toUpperCase();
    const paymentMode = String(formData.get('paymentMode') || 'CASH').trim().toUpperCase();
    // PENDING_VERIFICATION + UPI_INTENT = direct UPI app deep-link checkout
    // (order is saved as a draft when the customer taps a UPI app button and
    // confirmed by /api/payment/confirm-direct-upi on window focus return).
    if (
      !['PAID', 'UNPAID', 'PENDING_VERIFICATION'].includes(paymentStatus) ||
      !['RAZORPAY', 'CASH', 'WALLET', 'UPI_INTENT'].includes(paymentMode)
    ) {
      return NextResponse.json(
        { success: false, error: 'Invalid payment selection' },
        { status: 400 }
      );
    }

    /* ------------------------------------------------------------------ */
    /* Detect multi-file vs legacy single-file                             */
    /* ------------------------------------------------------------------ */
    const filesMetadataRaw = formData.get('filesMetadata');
    const multiFiles = formData.getAll('files');
    const legacyFile = formData.get('file');

    const isMultiFile = filesMetadataRaw && multiFiles.length > 0;

    let filesToUpload = [];
    let filesMetadata = [];

    if (isMultiFile) {
      /* ---- Multi-file batch ---- */
      try {
        filesMetadata = JSON.parse(String(filesMetadataRaw));
      } catch {
        filesMetadata = [];
      }

      // Match metadata to files by index
      for (let i = 0; i < multiFiles.length; i++) {
        const f = multiFiles[i];
        if (typeof f === 'string') continue; // skip non-file form entries
        const meta = filesMetadata[i] || {};

        filesToUpload.push({
          file: f,
          fileName: meta.fileName || f.name || `file-${i}`,
          pageCount: meta.pageCount || 1,
          colorMode: meta.colorMode || 'auto',
          sides: meta.sides || 'single',
          copies: meta.copies || 1,
        });
      }
    } else if (legacyFile && typeof legacyFile !== 'string') {
      /* ---- Legacy single-file ---- */
      let config = { color: false, copies: 1, doubleSided: false };
      const rawConfig = formData.get('printConfig');
      if (rawConfig) {
        try {
          const parsed = JSON.parse(String(rawConfig));
          config = {
            color: Boolean(parsed.color ?? parsed.printType === 'color'),
            copies: Math.min(99, Math.max(1, parseInt(parsed.copies ?? 1, 10) || 1)),
            doubleSided: Boolean(parsed.doubleSided ?? parsed.sides === 'double'),
          };
        } catch { /* keep defaults */ }
      }
      const pageCount = parseInt(formData.get('pageCount') || '1', 10) || 1;

      filesToUpload.push({
        file: legacyFile,
        fileName: legacyFile.name || 'document',
        pageCount,
        colorMode: config.color ? 'color' : 'bw',
        sides: config.doubleSided ? 'double' : 'single',
        copies: config.copies,
      });
    }

    /* ------------------------- Validation ------------------------- */
    if (filesToUpload.length === 0) {
      return NextResponse.json({ success: false, error: 'At least one file is required' }, { status: 400 });
    }
    if (!customerName || customerName.length < 2) {
      return NextResponse.json({ success: false, error: 'Customer name is required' }, { status: 400 });
    }
    if (customerPhone && !/^[6-9]\d{9}$/.test(customerPhone.replace(/\s/g, ''))) {
      return NextResponse.json({ success: false, error: 'Invalid phone number' }, { status: 400 });
    }
    if (!shopSlug) {
      return NextResponse.json({ success: false, error: 'Shop slug is required' }, { status: 400 });
    }

    // Validate each file
    for (const { file: f, fileName } of filesToUpload) {
      if (!ALLOWED_MIME.has(f.type)) {
        return NextResponse.json(
          { success: false, error: `"${fileName}" — only PDF, PNG, JPG or DOCX files are allowed` },
          { status: 415 }
        );
      }
      if (f.size > MAX_SIZE_BYTES) {
        return NextResponse.json(
          { success: false, error: `"${fileName}" exceeds 20MB limit` },
          { status: 413 }
        );
      }
    }

    /* --------------------- Demo mode (no Supabase) --------------------- */
    if (!supabaseAdmin) {
      const tokenNumber = generateToken();
      const totalFiles = filesToUpload.length;
      console.warn(
        `[upload] DEMO mode — ${totalFiles} file(s) for "${customerName}" @ ${shopSlug} → ${tokenNumber}`
      );
      return NextResponse.json({
        success: true,
        demo: true,
        tokenNumber,
        jobId: `demo-${Date.now()}`,
        totalFiles,
      });
    }

    /* --------------------- Resolve shop by slug (with auto-provision) --------------------- */
    const requestedSlug = shopSlug || 'sharma_xerox';
    let shop = null;

    // Safe columns always exist; extras are fetched opportunistically so a
    // missing column (42703) can't fail shop resolution.
    const SHOP_COLS = 'id, name';
    const SHOP_EXTRA_COLS = 'bw_rate, color_rate, whatsapp_notifications_enabled, status, is_active, subscription_expires_at';

    const fetchShopAdmin = async (targetSlug) => {
      const primary = await supabaseAdmin
        .from('shops')
        .select(`${SHOP_COLS}, ${SHOP_EXTRA_COLS}`)
        .eq('slug', targetSlug)
        .maybeSingle();
      if (!primary.error && primary.data) return primary.data;
      if (primary.error) console.error('Supabase Error:', primary.error);
      const fallback = await supabaseAdmin
        .from('shops')
        .select(SHOP_COLS)
        .eq('slug', targetSlug)
        .maybeSingle();
      if (fallback.error) console.error('Supabase Error:', fallback.error);
      return fallback.data || null;
    };

    shop = await fetchShopAdmin(requestedSlug);

    if (!shop && requestedSlug !== 'sharma_xerox') {
      // Fall back to the default shop slug before auto-provisioning.
      shop = await fetchShopAdmin('sharma_xerox');
    }

    if (!shop) {
      // Neither the requested slug nor the default exists — create the
      // fallback 'Sharma Xerox' row (service-role key bypasses RLS, so this
      // always succeeds) and use its id for the job insert. Insert only
      // guaranteed columns; per-shop extras are added via migration.
      console.warn(`[upload] No shop row for "${requestedSlug}" — auto-provisioning fallback 'Sharma Xerox'`);
      const { data: created, error: createErr } = await supabaseAdmin
        .from('shops')
        .insert({ slug: 'sharma_xerox', name: 'Sharma Xerox' })
        .select(SHOP_COLS)
        .single();

      if (createErr || !created) {
        console.error('Supabase Error:', createErr);
        return NextResponse.json({ success: false, error: 'Shop not found and could not be created' }, { status: 500 });
      }
      shop = created;
    }

    /* --------------------- Subscription enforcement --------------------- */
    // Suspended (manual) or expired (past subscription_expires_at) shops
    // cannot accept new orders. Auto-provisioned fallback rows are always
    // active, so this only guards genuinely provisioned shops.
    const expired =
      shop.subscription_expires_at &&
      new Date(shop.subscription_expires_at).getTime() < Date.now();
    const suspended = shop.status === 'suspended' || shop.is_active === false;
    if (suspended || expired) {
      return NextResponse.json(
        {
          success: false,
          error: expired
            ? "This shop's subscription has expired — new orders are paused. Please contact the shop."
            : "This shop is not accepting orders right now. Please contact the shop.",
          shopSuspended: true,
        },
        { status: 403 }
      );
    }

    /* --------------------- Monthly quota enforcement ---------------------
     * Orders (max_orders_monthly) AND pages (max_pages) — both limits are
     * resolved from the shop's active subscriptions row (entitlement
     * snapshot) with plans-catalog fallback via getShopActivePlan.
     * Fail-open: any error in either check degrades to "allow" so a DB
     * hiccup never blocks a real customer order. */
    try {
      const activePlan = await getShopActivePlan(shop.id);
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const maxOrders = activePlan.max_orders_monthly ?? -1;
      if (maxOrders !== -1) {
        const { count, error: countErr } = await supabaseAdmin
          .from('print_jobs')
          .select('*', { count: 'exact', head: true })
          .eq('shop_id', shop.id)
          .gte('created_at', monthStart.toISOString());
        if (!countErr && count != null && count >= maxOrders) {
          return NextResponse.json(
            {
              success: false,
              error: 'Monthly order limit reached for this shop\'s plan. Please contact the shop owner to upgrade.',
              planLimitReached: true,
            },
            { status: 403 }
          );
        }
      }

      /* ---- Page quota (max_pages) ----
       * Caps this month's total sheets: pages already printed + the sheets
       * this order would add (pageCount × copies per file). -1/null =
       * unlimited. Usage query fail-open: schema without `pages` (PGRST204)
       * logs a warning and allows the order. */
      const maxPages = activePlan.max_pages;
      if (Number.isFinite(maxPages) && maxPages >= 0) {
        const incomingPages = filesToUpload.reduce(
          (sum, f) => sum + (parseInt(f.pageCount, 10) || 1) * (parseInt(f.copies, 10) || 1),
          0
        );
        const { data: pageRows, error: pageErr } = await supabaseAdmin
          .from('print_jobs')
          .select('pages')
          .eq('shop_id', shop.id)
          .gte('created_at', monthStart.toISOString())
          .limit(5000);
        if (pageErr) {
          console.warn('[upload] page-quota usage query failed — allowing order:', pageErr.message);
        } else {
          const usedPages = (pageRows || []).reduce((sum, r) => sum + (Number(r.pages) || 0), 0);
          if (usedPages + incomingPages > maxPages) {
            return NextResponse.json(
              {
                success: false,
                error: `Monthly page limit reached (${maxPages} pages/month on this shop's plan). Please contact the shop owner to upgrade.`,
                planLimitReached: true,
                maxPages,
                usedPages,
              },
              { status: 403 }
            );
          }
        }
      }
    } catch (quotaErr) {
      // Fail-open: log but never block an order on a quota-check failure
      console.warn('[upload] quota check error — allowing order:', quotaErr?.message || quotaErr);
    }

    /* --------------------- Upload all files to Storage --------------------- */
    // Targets 'print-files' first (legacy 'print-uploads' as fallback) and
    // self-heals by creating a missing bucket. Storage problems NEVER block
    // the order: if a file can't be stored we keep its metadata and continue
    // so the print_jobs row — and the customer's token — are still created.
    const readyBuckets = new Set();
    /* Public-URL verification cache — one probe per bucket per server
     * lifetime. listBuckets() has proven unreliable here (it can omit
     * buckets that plainly exist), so the ground truth is whether the
     * object's public URL actually answers: HEAD 200 → permanent public
     * links are usable; otherwise promote the bucket best-effort, re-test,
     * and fall back to 7-day signed URLs. */
    const bucketVisibility = new Map();
    const publicUrlWorks = async (bucket, storagePath) => {
      if (bucketVisibility.has(bucket)) return bucketVisibility.get(bucket);
      const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(storagePath);
      const publicUrl = data?.publicUrl;
      if (!publicUrl || !/^https?:\/\//.test(publicUrl)) {
        bucketVisibility.set(bucket, false);
        return false;
      }
      const probe = () => {
        try {
          return fetch(publicUrl, { method: 'HEAD' });
        } catch {
          return null;
        }
      };
      try {
        let res = await probe();
        if (res?.ok) {
          bucketVisibility.set(bucket, true);
          return true;
        }
        // Possibly a private bucket → promote, then re-test this object.
        const { error: updErr } = await supabaseAdmin.storage.updateBucket(bucket, { public: true });
        if (updErr) {
          console.warn(`[upload] bucket "${bucket}" stays private — using signed URLs:`, updErr.message);
        }
        res = await probe();
        if (res?.ok) {
          bucketVisibility.set(bucket, true);
          return true;
        }
      } catch (err) {
        console.warn('[upload] public-URL probe failed:', err?.message || err);
      }
      bucketVisibility.set(bucket, false);
      return false;
    };
    const ensureBucket = async (bucket) => {
      if (readyBuckets.has(bucket)) return true;
      // Public bucket → every object gets a permanent, non-expiring public
      // URL that auto-print can always fetch (signed URLs die after 7 days).
      const { error } = await supabaseAdmin.storage.createBucket(bucket, {
        public: true,
        fileSizeLimit: MAX_SIZE_BYTES,
      });
      if (error && !/already exists|duplicate/i.test(error.message || '')) {
        console.error(`Supabase Error: createBucket("${bucket}") failed —`, error.message);
        return false;
      }
      // Bucket created earlier as private? Best-effort promote to public so
      // its public URLs actually serve. Failure is non-fatal — the signed
      // URL fallback below still covers private buckets.
      if (error) {
        const { error: updErr } = await supabaseAdmin.storage.updateBucket(bucket, { public: true });
        if (updErr) console.warn(`[upload] could not make bucket "${bucket}" public — falling back to signed URLs:`, updErr.message);
      }
      readyBuckets.add(bucket);
      return true;
    };

    const uploadedFiles = [];
    let storageFailures = 0;

    for (const { file: f, fileName, pageCount, colorMode, sides, copies } of filesToUpload) {
      const safeName = fileName.replace(/[^\w.\-() ]/g, '_').slice(-120);
      let stored = false;

      for (const bucket of BUCKETS) {
        const storagePath = `${shop.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
        let { error: uploadErr } = await supabaseAdmin.storage
          .from(bucket)
          .upload(storagePath, f, { contentType: f.type, upsert: false });

        // NoSuchBucket → create it and retry this file once.
        if (uploadErr && /bucket not found|nosuchbucket/i.test(uploadErr.message || '')) {
          if (await ensureBucket(bucket)) {
            ({ error: uploadErr } = await supabaseAdmin.storage
              .from(bucket)
              .upload(storagePath, f, { contentType: f.type, upsert: false }));
          }
        }

        if (uploadErr) {
          console.error(`[upload] storage error on "${bucket}":`, uploadErr.message || uploadErr);
          continue; // try the next bucket name
        }

        // Permanent public URL FIRST (auto-print + downloads must never hit
        // an expired link) — but only when the public URL actually serves
        // (probe-verified); signed URL is the fallback for private buckets.
        const publicUrl = supabaseAdmin.storage.from(bucket).getPublicUrl(storagePath).data?.publicUrl;
        const isPublic = await publicUrlWorks(bucket, storagePath);
        const { data: signed } = await supabaseAdmin.storage
          .from(bucket)
          .createSignedUrl(storagePath, 60 * 60 * 24 * 7);
        const fileUrl =
          (isPublic && publicUrl && /^https?:\/\//.test(publicUrl) ? publicUrl : null) ||
          signed?.signedUrl ||
          (publicUrl && /^https?:\/\//.test(publicUrl) ? publicUrl : null) ||
          storagePath;
        console.log(`[upload] ${fileName}: ${isPublic ? 'public' : 'signed'} URL → ${fileUrl.slice(0, 80)}...`);

        uploadedFiles.push({
          fileUrl,
          fileName,
          pageCount,
          colorMode,
          sides,
          copies,
          storagePath,
          storageBucket: bucket,
        });
        stored = true;
        break;
      }

      if (!stored) {
        // Non-blocking fallback: save the file's metadata and complete the
        // order anyway — the counter can still print from the job details.
        storageFailures += 1;
        console.error(`[upload] all buckets failed for "${fileName}" — completing order with metadata only`);
        uploadedFiles.push({
          fileUrl: null,
          fileName,
          pageCount,
          colorMode,
          sides,
          copies,
          storagePath: null,
          storageError: 'storage unavailable',
        });
      }
    }

    const storageWarning = storageFailures > 0
      ? `${storageFailures} file${storageFailures !== 1 ? 's' : ''} could not be stored — the order was saved with file details only.`
      : null;

    /* --------------------- Token + insert print_job --------------------- */
    // Daily sequential pickup token (#1, #2, … resets each day per shop).
    // When present it IS the canonical token everywhere — print_jobs
    // token_number, orders.token_no, the API response, the customer banner
    // and the vendor queue badge all show the exact same value. Legacy
    // #TK-xx only remains as fallback when the lookup is unavailable.
    const dailyTokenNo = await nextDailyToken(supabaseAdmin, shop.id);
    const tokenNumber = dailyTokenNo != null ? `#${dailyTokenNo}` : generateToken();

    // Primary file URL for backward compatibility
    const primaryFileUrl = uploadedFiles[0]?.fileUrl || '';
    const primaryFileName = uploadedFiles[0]?.fileName || 'document';
    const totalPages = uploadedFiles.reduce((sum, f) => sum + f.pageCount * f.copies, 0);

    // Build files_metadata JSONB for the batch
    const filesMetadataPayload = uploadedFiles.map((f, idx) => ({
      index: idx,
      fileName: f.fileName,
      pageCount: f.pageCount,
      colorMode: f.colorMode,
      sides: f.sides,
      copies: f.copies,
      fileUrl: f.fileUrl,
    }));

    const insertPayload = {
      shop_id: shop.id,
      token_number: tokenNumber,
      customer_name: customerName,
      customer_phone: customerPhone || null,
      file_url: primaryFileUrl,
      file_name: primaryFileName,
      page_count: totalPages,
      config: {
        colorMode: uploadedFiles[0]?.colorMode || 'auto',
        sides: uploadedFiles[0]?.sides || 'single',
        copies: uploadedFiles[0]?.copies || 1,
        totalFiles: uploadedFiles.length,
        // Price snapshot INSIDE config jsonb — survives schemas that lack
        // dedicated price columns, so revenue analytics always have data.
        totalPrice: finalPrice,
        // Binding duplicated here too so the queue badge works even on
        // schemas without dedicated binding_type / binding_cost columns.
        bindingType,
        bindingCost,
        paperSize,
        pageRange,
        // Notes inside config JSONB as an extra fallback if the top-level
        // notes / special_instructions columns are absent or dropped.
        ...(userNote ? { notes: userNote } : {}),
      },
      files_metadata: filesMetadataPayload,
      // Pricing snapshot (null-safe for legacy rows / older clients).
      // total_price mirrors final_price for schemas that use that column.
      original_price: originalPrice,
      discount_amount: discountAmount,
      applied_coupon: appliedCoupon,
      final_price: finalPrice,
      total_price: finalPrice,
      // Binding & finishing — dedicated columns (dropped by the schema
      // fallback below if the migration hasn't run; config jsonb keeps it).
      binding_type: bindingType,
      binding_cost: bindingCost,
      paper_size: paperSize,
      // Payment selection from Step 2. Print Pass wallet payments also set
      // payment_method='wallet' per spec — dropped automatically by the
      // schema fallback below when the column doesn't exist.
      payment_status: paymentStatus,
      payment_mode: paymentMode,
      payment_method: paymentMode === 'WALLET' ? 'wallet' : paymentMode.toLowerCase(),
      // ⛔ NOT YET IN THE QUEUE. The order starts `unpaid` and is only
      // promoted to `Queued` by /api/payment/confirm-direct-upi once the
      // customer's payment has actually come back from the UPI app. This
      // route deliberately sends NO realtime broadcast to the vendor either
      // (see the sidecar insert below) — an unpaid draft must never ring the
      // counter or trigger an auto-print. The vendor's postgres_changes
      // listener still sees the row, but its status keeps it out of the
      // announced/active states until payment lands.
      status: 'unpaid',
      // Customer special instructions — stored on both tables so every
      // read path (realtime print_jobs, sidecar orders query) surfaces them.
      // Also written into `metadata` JSONB as a schema-drift-proof fallback:
      // JSONB columns survive MISSING_COLUMNS drops, so notes is always
      // recoverable even if the top-level column hasn't been migrated yet.
      notes: userNote,
      special_instructions: userNote,
      ...(userNote ? { metadata: { notes: userNote } } : {}),
    };

    // Insert with progressive schema fallback: on schema drift (missing
    // column → 42703 / PGRST204), drop or remap the offending key and retry
    // until the payload fits the live schema, so the job row is never blocked.
    //
    // PERFORMANCE/SCHEMA-DRIFT: the columns this schema is missing are a
    // FIXED set, but the naive version re-sent the FULL payload on every
    // retry — one failing column per round trip. Against this schema that
    // meant 8 INSERT requests per order (original_price, page_count,
    // paper_size, payment_method, payment_mode, payment_status, total_price
    // each failing in turn), which is what filled the Vercel logs with
    // "retries" and pushed functions past their duration limit.
    //
    // `MISSING_COLUMNS` remembers what the live schema rejected, so every
    // order after the first one is a SINGLE insert. Module scope survives
    // across requests inside a warm serverless instance, so the first order
    // still pays the discovery cost once per cold start.
    const insertJobWithFallback = async (basePayload) => {
      const dropped = [];
      let attemptPayload = { ...basePayload };
      let lastErr = null;
      for (let attempt = 0; attempt < 20 && Object.keys(attemptPayload).length > 0; attempt++) {
        // Pre-apply everything already known to be missing so the FIRST
        // request of an order is usually also the only one.
        attemptPayload = applyKnownColumns(attemptPayload);

        const res = await supabaseAdmin
          .from('print_jobs')
          .insert(attemptPayload)
          .select('id')
          .single();

        if (!res.error) {
          return { job: res.data, error: null };
        }
        lastErr = res.error;

        const missing =
          (res.error.details || '').match(/column "(\w+)"/)?.[1] ||
          (res.error.message || '').match(/'(\w+)' column/)?.[1] ||
          Object.keys(attemptPayload).find((c) => (res.error.message || '').includes(c));

        // 42703 = undefined column (SELECT-style), PGRST204 = unknown column
        // in INSERT payload — both mean schema drift; adapt and retry.
        if ((res.error.code === '42703' || res.error.code === 'PGRST204') && missing) {
          console.warn(`[upload] print_jobs missing column "${missing}" — retrying without it`);
          if (missing === 'page_count' && attemptPayload.pages === undefined) {
            // Remap to the legacy 'pages' column instead of dropping the data.
            const { page_count: pagesValue, ...rest } = attemptPayload;
            attemptPayload = { ...rest, pages: pagesValue };
          } else {
            const { [missing]: _dropped, ...rest } = attemptPayload;
            attemptPayload = rest;
          }
          dropped.push(missing);
          MISSING_COLUMNS.add(missing); // remember — never re-test this column
          continue;
        }
        break; // non-schema error — don't loop
      }
      return { job: null, error: lastErr };
    };

    let { job, error: insertErr } = await insertJobWithFallback(insertPayload);

    // Last-resort minimal insert: if the schema is drifted so far that even
    // the fully-adapted payload fails, persist the core order on the
    // guaranteed base columns so the customer's order is never lost — the
    // flow always proceeds to Step 3; only extended metadata may be absent.
    if (!job) {
      const minimal = await insertJobWithFallback({
        shop_id: shop.id,
        token_number: tokenNumber,
        customer_name: customerName,
        customer_phone: customerPhone || null,
        file_url: primaryFileUrl,
        file_name: primaryFileName,
        // Same rule as the full payload: a fallback row is still an UNPAID
        // draft and must not announce itself to the vendor.
        status: 'unpaid',
      });
      if (minimal.job) {
        job = minimal.job;
        insertErr = null;
        console.warn('[upload] extended insert failed — persisted minimal print_jobs row for', tokenNumber);
      } else {
        insertErr = minimal.error;
      }
    }

    if (!job) {
      console.error('[upload] insert error:', insertErr);
      return NextResponse.json({ success: false, error: 'Could not create print job' }, { status: 500 });
    }

    /* ------------- Orders sidecar — binding & finishing ------------- */
    // The live print_jobs schema has NO binding columns; the `orders` table
    // does (binding_type / binding_cost per spec). Link the sidecar row 1:1
    // to the job by reusing the job's id as orders.id (join key).
    /* dailyTokenNo was computed BEFORE the print_jobs insert (nextDailyToken)
     * so tokenNumber and orders.token_no can never drift apart. */
    const sidecarPayload = {
      id: job.id,
      shop_id: shop.id,
      customer_phone: customerPhone || null,
      file_name: primaryFileName,
      file_url: primaryFileUrl || '',
      pages: totalPages,
      copies: uploadedFiles[0]?.copies || 1,
      binding_type: bindingType,
      binding_cost: bindingCost,
      paper_size: paperSize,
      page_range: pageRange,
      ...(Number.isFinite(bwPagesTotal) ? { bw_pages: bwPagesTotal } : {}),
      ...(Number.isFinite(colorPagesTotal) ? { color_pages: colorPagesTotal } : {}),
      // Order amount — the Counter Soundbox voice reads this back live
      // ("Total amount ₹X rupees"); manual-entry sets it too. Includes the
      // ₹10 express fee when the customer ticked Priority Print.
      total_amount: Number.isFinite(finalPrice) ? finalPrice : null,
      // Settlement channel — the EOD report splits Online UPI vs Cash on this.
      payment_method: paymentMode === 'WALLET' ? 'wallet' : paymentMode.toLowerCase(),
      // Verification state — PAID / UNPAID / PENDING_VERIFICATION (direct UPI
      // deep-link draft). Progressive-drop: dropped while the migration
      // supabase/migrations/20260928_orders_payment_status.sql is pending.
      payment_status: paymentStatus,
      // ⚡ Express-rush flag (see lib/priority.js for the dual-write carrier)
      ...priorityWrite(isPriority),
      // Matches print_jobs above: unpaid until confirm-direct-upi verifies
      // the payment, then flipped to `Queued` (the two rows share an id, so
      // the vendor queue only ever sees one of them advance).
      status: 'unpaid',
      ...(dailyTokenNo != null ? { token_no: dailyTokenNo } : {}),
      // Customer special instructions — mirrored from print_jobs so both
      // the realtime listener and the sidecar orders query surface them.
      ...(userNote ? { notes: userNote, special_instructions: userNote, metadata: { notes: userNote } } : {}),
    };
    // Same adaptive strategy as print_jobs, with its own cache so the orders
    // sidecar also converges to ONE insert per order instead of re-probing
    // is_priority / payment_status on every single upload.
    const insertSidecarWithFallback = async (basePayload) => {
      let row = { ...basePayload };
      let err = null;
      for (let attempt = 0; attempt < 8; attempt++) {
        if (MISSING_ORDER_COLUMNS.size > 0) {
          row = Object.fromEntries(
            Object.entries(row).filter(([k]) => !MISSING_ORDER_COLUMNS.has(k))
          );
        }
        const res = await supabaseAdmin.from('orders').insert(row);
        err = res.error;
        if (!err) return null;

        const missing = (err.message || '').match(/'([\w]+)'\s+column|column\s+"(\w+)"/);
        const col = missing?.[1] || missing?.[2] ||
          Object.keys(row).find((c) => (err.message || '').includes(c));
        // Only schema drift is adaptive; a duplicate token_no or any other
        // real failure is returned so the caller can react.
        if ((err.code === 'PGRST204' || err.code === '42703') && col && col in row) {
          console.warn(`[upload] orders sidecar: dropping missing column "${col}"`);
          delete row[col];
          MISSING_ORDER_COLUMNS.add(col);
          continue;
        }
        break;
      }
      return err;
    };

    let sidecarErr = await insertSidecarWithFallback(sidecarPayload);
    if (sidecarErr && dailyTokenNo != null) {
      // Unique-token clash (concurrent upload) or a token_no surprise —
      // retry WITHOUT it so binding/paper/token-link data still lands.
      console.warn('[upload] sidecar retry without token_no:', sidecarErr.message);
      const { token_no: _droppedToken, ...withoutToken } = sidecarPayload;
      sidecarErr = await insertSidecarWithFallback(withoutToken);
    }
    if (sidecarErr) {
      // Non-fatal: the print job already exists; only the queue's binding
      // badge degrades. Logged loudly so schema drift is visible.
      console.error('[upload] orders sidecar insert failed:', sidecarErr.message);
    }

    /* --------------------- WhatsApp notification ---------------------
     * Non-blocking: any failure here must NEVER turn a successfully stored
     * upload into a 500. Wrapped in its own try/catch as belt & braces on
     * top of the fire-and-forget wrapper. */
    try {
      if (customerPhone && shop?.name && shop?.whatsapp_notifications_enabled !== false) {
      const bwRate = shop.bw_rate || 2;
      const colorRate = shop.color_rate || 10;
      // Calculate total price across all files
      let totalPrice = 0;
      let totalBw = 0;
      let totalColor = 0;
      for (const f of uploadedFiles) {
        const r = calculatePrice(f.pageCount, { color: f.colorMode === 'color', copies: f.copies, doubleSided: f.sides === 'double' }, bwRate, colorRate);
        totalPrice += r.total;
        totalBw += r.bwPages;
        totalColor += r.colorPages;
      }
      // The client's AI pixel-scan totals are authoritative when present
      // (the estimate above treats non-'color' modes as pure B&W).
      if (Number.isFinite(bwPagesTotal) && Number.isFinite(colorPagesTotal)) {
        totalBw = bwPagesTotal;
        totalColor = colorPagesTotal;
        totalPrice = totalBw * bwRate + totalColor * colorRate;
      }

      const msg = buildSubmissionMessage({
        customerName,
        shopName: shop.name,
        tokenNumber,
        pageCount: totalPages,
        bwPages: totalBw,
        colorPages: totalColor,
        totalPrice,
      });
        sendWhatsAppFireAndForget({ to: customerPhone, message: msg });
      }
    } catch (waErr) {
      console.error('[upload] WhatsApp notification failed (non-fatal):', waErr?.message);
    }

    return NextResponse.json({
      success: true,
      tokenNumber,
      tokenNo: dailyTokenNo,
      jobId: job.id,
      totalFiles: uploadedFiles.length,
      storageWarning,
    });
  } catch (err) {
    // Always answer with a JSON body carrying a usable reason — a raw throw
    // here rendered Next.js' HTML error page, which the client's
    // `res.json()` could not parse, so a failed order looked like an
    // unexplained "upload failed" instead of an actionable message.
    console.error('[upload] unexpected error:', err);
    const detail = err?.message || String(err || '');
    return NextResponse.json(
      {
        success: false,
        error: detail
          ? `Order placement failed: ${detail}`
          : 'Order placement failed, please try again.',
        // Postgres error codes are what Vercel log triage actually needs
        // (42703 = missing column, PGRST204 = unknown column in payload).
        code: err?.code || null,
      },
      { status: 500 }
    );
  }
}

/** Short token like #TK-98 (2-digit, zero-padded 10–99). */
function generateToken() {
  return `#TK-${Math.floor(Math.random() * 90) + 10}`;
}
