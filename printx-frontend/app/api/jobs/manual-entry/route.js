import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendWhatsAppFireAndForget, buildWalkInMessage } from '../../../../lib/whatsapp';
import { nextDailyToken } from '../../../../lib/dailyToken';
import { priorityWrite, PRIORITY_FEE } from '../../../../lib/priority';
import { getShopActivePlan } from '../../../../lib/getShopActivePlan';

/**
 * POST /api/jobs/manual-entry
 *
 * Creates a walk-in print job manually from the shop owner dashboard.
 *
 * Supports both JSON and FormData (for file uploads).
 *
 * JSON body:
 *   shopSlug, customerName, customerPhone,
 *   bwPages, colorPages, sides, copies,
 *   paymentMethod ('cash'|'upi'), paymentStatus ('paid'|'unpaid'),
 *   source ('walkin')
 *
 * FormData (with file):
 *   Same fields + file (PDF/PNG/JPG/DOCX)
 *
 * Generates a sequential token number, inserts into print_jobs,
 * and triggers realtime Supabase channels.
 *
 * Demo mode (no Supabase): returns a mock token without persisting.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
// Preferred storage bucket first; the legacy name stays as a fallback so
// walk-in files land in the same bucket as online orders (/api/upload).
const BUCKETS = ['print-files', 'print-uploads'];

const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY) : null;

export async function POST(request) {
  try {
    let payload = {};
    let file = null;

    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      // FormData — file upload mode
      const formData = await request.formData();
      file = formData.get('file');
      payload = {
        shopSlug: String(formData.get('shopSlug') || '').trim(),
        customerName: String(formData.get('customerName') || 'Walk-in Customer').trim(),
        customerPhone: String(formData.get('customerPhone') || '').trim() || null,
        bwPages: parseInt(formData.get('bwPages') || '0', 10) || 0,
        colorPages: parseInt(formData.get('colorPages') || '0', 10) || 0,
        sides: formData.get('sides') || 'single',
        copies: parseInt(formData.get('copies') || '1', 10) || 1,
        paymentMethod: formData.get('paymentMethod') || 'cash',
        paymentStatus: formData.get('paymentStatus') || 'paid',
        source: formData.get('source') || 'walkin',
        paperSize: formData.get('paperSize') || 'A4',
        bindingType: formData.get('bindingType') || 'none',
        bindingCost: parseFloat(formData.get('bindingCost') || '0') || 0,
        completeNow: String(formData.get('completeNow') || '') === 'true',
        isPriority: String(formData.get('isPriority') || '') === 'true',
      };
    } else {
      // JSON body — manual page count mode
      payload = await request.json();
    }

    const {
      shopSlug = 'ramesh-xerox',
      customerName = 'Walk-in Customer',
      customerPhone = null,
      bwPages = 0,
      colorPages = 0,
      sides = 'single',
      copies = 1,
      paymentMethod = 'cash',
      paymentStatus = 'paid',
      source = 'walkin',
      paperSize = 'A4',
      bindingType = 'none',
      bindingCost = 0,
      completeNow = false,
      isPriority = false,
    } = payload;

    /* ---- Quick Cash Order normalisation ----
     * `completeNow` marks an offline counter sale as settled on the spot, so
     * the job lands COMPLETED instead of PRINTING/PENDING. */
    const safePaperSize = ['A4', 'A3', 'Legal', 'Glossy'].includes(String(paperSize)) ? String(paperSize) : 'A4';
    const safeBinding = String(bindingType || 'none').trim() || 'none';
    const safeBindingCost = Math.max(0, Number(bindingCost) || 0);
    const settleNow = Boolean(completeNow);
    const jobStatus = settleNow
      ? 'COMPLETED'
      : paymentStatus === 'paid'
        ? 'PRINTING'
        : 'PENDING';

    /* ---- Validation ---- */
    if (bwPages + colorPages <= 0) {
      return NextResponse.json(
        { success: false, error: 'At least 1 page (B&W or Color) is required' },
        { status: 400 }
      );
    }
    if (copies < 1 || copies > 99) {
      return NextResponse.json(
        { success: false, error: 'Copies must be between 1 and 99' },
        { status: 400 }
      );
    }

    /* ---- Demo mode (no Supabase) ---- */
    if (!supabaseAdmin) {
      const tokenNumber = generateToken();
      const totalPages = (bwPages + colorPages) * copies;
      const total = (bwPages * 2 + colorPages * 10) * copies;

      console.warn(
        `[manual-entry] DEMO mode — Token ${tokenNumber} for "${customerName}" @ ${shopSlug}: ${bwPages}B&W + ${colorPages}Color × ${copies} copies = ₹${total}`
      );

      return NextResponse.json({
        success: true,
        demo: true,
        tokenNumber,
        jobId: `demo-${Date.now()}`,
        totalPages,
        totalAmount: total,
        config: { bwPages, colorPages, sides, copies, paymentMethod, paymentStatus },
      });
    }

    /* ---- Resolve shop (select('*') — schema-drift tolerant; a named
     * column like whatsapp_notifications_enabled404s the whole row) ---- */
    const { data: shop, error: shopErr } = await supabaseAdmin
      .from('shops')
      .select('*')
      .eq('slug', shopSlug)
      .single();

    if (shopErr || !shop) {
      return NextResponse.json({ success: false, error: 'Shop not found' }, { status: 404 });
    }

    /* ---- Monthly order quota enforcement ----
     * Fail-open: any error degrades to "allow" so a DB hiccup never blocks
     * a legitimate walk-in order at the counter. */
    try {
      const activePlan = await getShopActivePlan(shop.id);
      const maxOrders = activePlan.max_orders_monthly ?? -1;
      if (maxOrders !== -1) {
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        const { count, error: countErr } = await supabaseAdmin
          .from('print_jobs')
          .select('*', { count: 'exact', head: true })
          .eq('shop_id', shop.id)
          .gte('created_at', monthStart.toISOString());
        if (!countErr && count != null && count >= maxOrders) {
          return NextResponse.json(
            {
              success: false,
              error: 'Monthly order limit reached. Please upgrade your plan.',
              planLimitReached: true,
            },
            { status: 403 }
          );
        }
      }
    } catch (quotaErr) {
      console.warn('[manual-entry] quota check error — allowing order:', quotaErr?.message || quotaErr);
    }

    /* ---- Upload file if provided ---- */
    let fileUrl = null;
    let fileName = null;
    let pageCount = bwPages + colorPages;

    if (file && typeof file !== 'string') {
      const safeName = (file.name || 'walkin-doc').replace(/[^\w.\-() ]/g, '_').slice(-120);
      const storagePath = `${shop.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;

      // Try 'print-files' first (legacy 'print-uploads' fallback) and
      // self-heal a missing bucket — a Storage problem never blocks the
      // job: fileUrl simply stays null when every bucket fails.
      let storedBucket = null;
      for (const bucket of BUCKETS) {
        const { error: uploadErr } = await supabaseAdmin.storage
          .from(bucket)
          .upload(storagePath, file, { contentType: file.type, upsert: false });
        if (!uploadErr) { storedBucket = bucket; break; }
        if (/bucket not found|nosuchbucket/i.test(uploadErr.message || '')) {
          const { error: createErr } = await supabaseAdmin.storage.createBucket(bucket, {
            public: true,
            fileSizeLimit: 20 * 1024 * 1024,
          });
          if (!createErr || /already exists|duplicate/i.test(createErr.message || '')) {
            const retry = await supabaseAdmin.storage
              .from(bucket)
              .upload(storagePath, file, { contentType: file.type, upsert: false });
            if (!retry.error) { storedBucket = bucket; break; }
          }
        }
      }

      if (storedBucket) {
        // Permanent public URL first (auto-print + downloads must never hit
        // an expired link); signed URL only as fallback for private buckets.
        const publicUrl = supabaseAdmin.storage.from(storedBucket).getPublicUrl(storagePath).data?.publicUrl;
        const { data: signed } = await supabaseAdmin.storage
          .from(storedBucket)
          .createSignedUrl(storagePath, 60 * 60 * 24 * 7);
        fileUrl =
          (publicUrl && /^https?:\/\//.test(publicUrl) ? publicUrl : null) ||
          signed?.signedUrl ||
          null;
        fileName = file.name;
        // Try to count actual pages from PDF
        if (file.type === 'application/pdf') {
          try {
            const buffer = await file.arrayBuffer();
            const text = new TextDecoder('latin1').decode(new Uint8Array(buffer).slice(0, 4_000_000));
            const counts = text.match(/\/Type\s*\/Page[^s]/g);
            if (counts) pageCount = counts.length * copies;
          } catch { /* keep calculated pageCount */ }
        }
      }
    }

    /* ---- Daily sequential token (shared with /api/upload via nextDailyToken)
     * so walk-ins and online orders draw from the SAME per-shop daily
     * counter. Legacy #TK-xx only when the lookup is unavailable. ---- */
    const dailyTokenNo = await nextDailyToken(supabaseAdmin, shop.id);
    const tokenNumber =
      dailyTokenNo != null ? `#${dailyTokenNo}` : await generateSequentialToken(shop.id);

    /* ---- Calculate totals ---- */
    const bwRate = shop.bw_rate || 2;
    const colorRate = shop.color_rate || 10;
    const totalPages = (bwPages + colorPages) * copies;
    const totalAmount =
      (bwPages * bwRate + colorPages * colorRate) * copies +
      safeBindingCost +
      (isPriority ? PRIORITY_FEE : 0);

    /* ---- Insert print_job (payload limited to columns this schema has:
     * print_jobs has pages/copies but NO page_count/config) ---- */
    const config = {
      bwPages,
      colorPages,
      sides,
      copies,
      paymentMethod,
      paymentStatus,
      source,
      totalAmount,
      paperSize: safePaperSize,
      bindingType: safeBinding,
      bindingCost: safeBindingCost,
      settleNow,
    };

    const insertPayload = {
      shop_id: shop.id,
      token_number: tokenNumber,
      customer_name: customerName,
      customer_phone: customerPhone || null,
      file_url: fileUrl || '',
      file_name: fileName || 'manual-entry',
      pages: totalPages,
      copies,
      status: jobStatus,
    };

    let { data: job, error: insertErr } = await supabaseAdmin
      .from('print_jobs')
      .insert(insertPayload)
      .select('id')
      .single();

    if (insertErr) {
      // Schema drift safety net — retry with base columns so a walk-in job
      // is never lost to a missing extended column.
      const { pages: _p, copies: _c, ...basePayload } = insertPayload;
      const retry = await supabaseAdmin
        .from('print_jobs')
        .insert(basePayload)
        .select('id')
        .single();
      if (retry.data) {
        console.warn('[manual-entry] schema drift — inserted base columns only:', insertErr.message);
        job = retry.data;
        insertErr = null;
      }
    }

    if (insertErr) {
      console.error('[manual-entry] insert error:', insertErr);
      return NextResponse.json({ success: false, error: 'Could not create print job' }, { status: 500 });
    }

    /* ---- Orders sidecar — daily token_no + print specs (same table the
     * online upload path writes, so the vendor queue shows walk-ins with
     * the exact same TOKEN #n badge). Also carries the page/price detail
     * this schema's print_jobs can't (no config column). Non-fatal. ---- */
    const sidecarPayload = {
      id: job.id,
      shop_id: shop.id,
      customer_phone: customerPhone || null,
      file_name: fileName || 'manual-entry',
      file_url: fileUrl || '',
      pages: totalPages,
      copies,
      bw_pages: bwPages,
      color_pages: colorPages,
      double_sided: sides === 'double',
      total_amount: totalAmount,
      payment_method: paymentMethod,
      binding_type: safeBinding,
      binding_cost: safeBindingCost,
      paper_size: safePaperSize,
      status: jobStatus,
      // Priority flag (is_priority column + batch_id carrier — see lib/priority)
      ...priorityWrite(isPriority),
      ...(dailyTokenNo != null ? { token_no: dailyTokenNo } : {}),
    };
    let { error: sidecarErr } = await supabaseAdmin.from('orders').insert(sidecarPayload);
    if (sidecarErr) {
      /* Progressive schema fallback — drop ONLY the offending key (or the
       * token on a concurrent-mint clash) and retry, so the price/paper/
       * binding data on the row is never thrown away wholesale. */
      let sidecarRow = { ...sidecarPayload };
      for (let attempt = 0; sidecarErr && attempt < 8; attempt++) {
        const msg = sidecarErr.message || '';
        const isDuplicate = /duplicate|unique/i.test(msg);
        if (isDuplicate && 'token_no' in sidecarRow) {
          console.warn('[manual-entry] orders sidecar: token clash — retrying without token_no');
          delete sidecarRow.token_no;
        } else {
          const missing = msg.match(/'([\w]+)'\s+column|column\s+"(\w+)"|Could not find the '([\w]+)'/);
          const col = missing?.[1] || missing?.[2] || missing?.[3];
          if (!col || !(col in sidecarRow)) break;
          console.warn(`[manual-entry] orders sidecar: dropping missing column "${col}"`);
          delete sidecarRow[col];
        }
        const retrySidecar = await supabaseAdmin.from('orders').insert(sidecarRow);
        sidecarErr = retrySidecar.error || null;
      }
    }
    if (sidecarErr) {
      console.error('[manual-entry] orders sidecar insert failed:', sidecarErr.message);
    }

    /* ---- Quick Cash side-effects: paper stock + daily revenue audit ---- */
    let stockRemaining = null;
    if (jobStatus === 'COMPLETED') {
      stockRemaining = await deductPaperStock(supabaseAdmin, shop, totalPages, safePaperSize);
    }
    if (paymentMethod === 'cash' && paymentStatus === 'paid') {
      await bumpDailyRevenueAudit(supabaseAdmin, { amount: totalAmount, pages: totalPages });
    }

    /* ---- WhatsApp notification ----
     * Non-blocking: a WhatsApp failure must never fail a created order. */
    try {
      if (customerPhone && shop?.name && shop?.whatsapp_notifications_enabled !== false) {
        const msg = buildWalkInMessage({
          customerName,
          shopName: shop.name,
          tokenNumber,
          totalPages,
          bwPages,
          colorPages,
          totalAmount,
        });
        sendWhatsAppFireAndForget({ to: customerPhone, message: msg });
      }
    } catch (waErr) {
      console.error('[manual-entry] WhatsApp notification failed (non-fatal):', waErr?.message);
    }

    return NextResponse.json({
      success: true,
      tokenNumber,
      tokenNo: dailyTokenNo,
      jobId: job.id,
      totalPages,
      totalAmount,
      status: jobStatus,
      stockRemaining,
      config,
    });
  } catch (err) {
    console.error('[manual-entry] unexpected error:', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Deduct A4 sheets from shops.a4_paper_stock once a job is settled.
 * Read-then-write (this schema exposes no RPC); stock floors at 0 and an
 * untracked (null) column is left untouched — mirrors the client-side
 * decrement in LiveQueueTable, which only fires on a vendor-initiated
 * completion (these rows arrive already COMPLETED, so no double-deduct).
 *
 * @returns {Promise<number|null>} remaining sheets, or null when not tracked
 */
async function deductPaperStock(admin, shop, sheets, paperSize) {
  try {
    if (String(paperSize || 'A4').toUpperCase() !== 'A4') return null;
    const n = Math.floor(Math.max(0, Number(sheets) || 0));
    if (n <= 0 || !shop?.id) return null;
    if (shop.a4_paper_stock == null || shop.a4_paper_stock === '') return null;
    const current = Number(shop.a4_paper_stock);
    if (!Number.isFinite(current)) return null;
    const next = Math.max(0, current - n);
    const { error } = await admin
      .from('shops')
      .update({ a4_paper_stock: next })
      .eq('id', shop.id);
    if (error) {
      console.error('[manual-entry] stock decrement failed:', error.message);
      return null;
    }
    return next;
  } catch (err) {
    console.error('[manual-entry] stock decrement failed:', err);
    return null;
  }
}

/** Local YYYY-MM-DD key for the daily revenue audit bucket. */
function localDayKey() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Increment today's cash revenue audit bucket in system_settings
 * (key `daily_revenue_audit` → { 'YYYY-MM-DD': { cash_amount, cash_orders, pages } }).
 * Best-effort: an audit hiccup never fails the order itself.
 */
async function bumpDailyRevenueAudit(admin, { amount = 0, pages = 0 } = {}) {
  try {
    const KEY = 'daily_revenue_audit';
    const { data: row } = await admin
      .from('system_settings')
      .select('value')
      .eq('key', KEY)
      .maybeSingle();
    const audit =
      row && row.value && typeof row.value === 'object' && !Array.isArray(row.value)
        ? { ...row.value }
        : {};
    const k = localDayKey();
    const cur = audit[k] && typeof audit[k] === 'object' ? audit[k] : {};
    audit[k] = {
      cash_amount: Math.round(((Number(cur.cash_amount) || 0) + (Number(amount) || 0)) * 100) / 100,
      cash_orders: (Number(cur.cash_orders) || 0) + 1,
      pages: (Number(cur.pages) || 0) + (Number(pages) || 0),
      updated_at: new Date().toISOString(),
    };
    // Keep the audit window bounded to the last 31 days.
    const trimmed = {};
    Object.keys(audit)
      .sort()
      .slice(-31)
      .forEach((day) => { trimmed[day] = audit[day]; });
    const { error } = await admin
      .from('system_settings')
      .upsert({ key: KEY, value: trimmed }, { onConflict: 'key' });
    if (error) console.warn('[manual-entry] revenue audit upsert failed:', error.message);
  } catch (err) {
    console.warn('[manual-entry] revenue audit failed:', err);
  }
}

/**
 * Generate next sequential token for the shop.
 * Queries the highest existing token number and increments.
 * Falls back to random if query fails.
 */
async function generateSequentialToken(shopId) {
  try {
    // Get the highest token number for this shop
    const { data, error } = await supabaseAdmin
      .from('print_jobs')
      .select('token_number')
      .eq('shop_id', shopId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error || !data || data.length === 0) {
      return `#TK-${Math.floor(Math.random() * 90) + 10}`;
    }

    // Extract numeric parts from token numbers
    let maxNum = 10;
    for (const row of data) {
      const match = (row.token_number || '').match(/(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }

    return `#TK-${maxNum + 1}`;
  } catch {
    return `#TK-${Math.floor(Math.random() * 90) + 10}`;
  }
}
