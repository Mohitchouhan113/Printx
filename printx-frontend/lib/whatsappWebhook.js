/**
 * WhatsApp Cloud API webhook engine.
 *
 * Pure, injectable helpers used by app/api/whatsapp/webhook/route.js:
 *
 *   1. verifyWebhook        — Meta GET challenge handshake (hub.verify_token)
 *   2. parseWebhookPayload  — flattens entry/changes/value envelope into messages
 *   3. quote helpers        — shop rates → page count → ₹ amount → UPI link
 *   4. message builders     — the two spec-exact customer replies
 *   5. pending-doc store    — system_settings KV (`whatsapp_pending`) with TTL
 *   6. processDocumentMessage / processPaymentConfirmation — the two flows,
 *      written against injected { supabase, fetchMediaBuffer, send } so the
 *      route owns network credentials and unit tests own the network.
 *
 * Page counting uses pdf-parse v2 (`PDFParse.getText().total`).
 */

import { PDFParse } from 'pdf-parse';

/* ================================================================== */
/* Constants                                                           */
/* ================================================================== */

/** Meta webhook verification token — set WHATSAPP_VERIFY_TOKEN in env. */
export const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'printx-webhook-verify';

/** system_settings KV keys. */
export const PENDING_KEY = 'whatsapp_pending';   // docs awaiting payment
export const BINDINGS_KEY = 'whatsapp_bindings'; // { phone_number_id: shopSlug }

/** Pending documents expire after 6 hours (media + quote are short-lived). */
export const PENDING_TTL_MS = 6 * 60 * 60 * 1000;

// Preferred storage bucket first; legacy name kept as fallback so inbound
// WhatsApp documents land in the same bucket as online orders.
const BUCKETS = ['print-files', 'print-uploads'];

/* ================================================================== */
/* 1. Webhook verification (GET)                                       */
/* ================================================================== */

/**
 * Meta's subscribe handshake: echo `hub.challenge` back only when
 * mode=subscribe AND the verify token matches. Anything else → reject.
 *
 * @param {URLSearchParams} params
 * @param {string} [expectedToken]
 * @returns {{ ok: true, challenge: string } | { ok: false, reason: string }}
 */
export function verifyWebhook(params, expectedToken = VERIFY_TOKEN) {
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');
  if (mode !== 'subscribe') return { ok: false, reason: 'bad-mode' };
  if (!token || token !== expectedToken) return { ok: false, reason: 'bad-token' };
  if (challenge == null || challenge === '') return { ok: false, reason: 'missing-challenge' };
  return { ok: true, challenge: String(challenge) };
}

/* ================================================================== */
/* 2. Payload parsing (POST)                                           */
/* ================================================================== */

/**
 * Flatten Meta's entry[].changes[].value envelope.
 * Returns null for non-WhatsApp payloads (delivery statuses, junk) so the
 * route can ack with 200 without doing work.
 *
 * @param {any} body raw JSON body
 * @returns {{ phone_number_id: string|null, messages: Array, contacts: Record<string,string> }|null}
 */
export function parseWebhookPayload(body) {
  if (!body || body.object !== 'whatsapp_business_account' || !Array.isArray(body.entry)) return null;

  const out = { phone_number_id: null, display_phone_number: null, messages: [], contacts: {} };

  for (const entry of body.entry) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      out.phone_number_id ||= value.metadata?.phone_number_id || null;
      out.display_phone_number ||= value.metadata?.display_phone_number || null;
      for (const contact of value.contacts || []) {
        if (contact?.wa_id) out.contacts[contact.wa_id] = contact.profile?.name || null;
      }
      for (const msg of value.messages || []) {
        if (!msg?.id || !msg?.from) continue;
        out.messages.push({
          id: msg.id,
          from: msg.from,
          type: msg.type || null,
          timestamp: msg.timestamp || null,
          text: msg.text?.body ?? null,
          document: msg.document
            ? {
                id: msg.document.id || null,
                mime_type: msg.document.mime_type || '',
                filename: msg.document.filename || 'document.pdf',
                caption: msg.document.caption || '',
              }
            : null,
        });
      }
    }
  }

  return out;
}

/** Local 10-digit form of a WhatsApp wa_id ('919876543210' → '9876543210'). */
export function normalizePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/** Payment-confirmation keywords a customer may reply with. */
const PAY_CONFIRM = [
  /\bpaid\b/i,
  /payment\s*(done|complete\w*|success\w*|confirmed)/i,
  /^done$/i,
  /upi[\s-]?(ref|txn|id|no)/i,
  /भुगतान/i,
];

/**
 * Does an inbound text look like "I have paid"?
 * The route still requires a matching pending document before creating an
 * order — this only gates the fast path.
 */
export function isPaymentConfirmation(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 120) return false;
  return PAY_CONFIRM.some((re) => re.test(t));
}

/**
 * Caption hints: colour mode + copies.
 *   "2 color copies" → { mode: 'color', copies: 2 }
 */
export function parseOrderHints(caption) {
  const c = String(caption || '');
  const mode = /colou?r/i.test(c) ? 'color' : 'bw';
  // "2 copies" / "copies: 3" / "2 color copies" — the number can sit on
  // either side of (or away from) the copies word.
  const hit =
    c.match(/(\d+)\s*cop(?:y|ies)/i) ||
    c.match(/cop(?:y|ies)\s*[:x]?\s*(\d+)/i) ||
    (/cop(?:y|ies)/i.test(c) ? c.match(/\b(\d{1,2})\b/) : null);
  const copies = Math.min(99, Math.max(1, parseInt(hit?.[1], 10) || 1));
  return { mode, copies };
}

/* ================================================================== */
/* 3. Rates → amount → UPI link                                        */
/* ================================================================== */

/**
 * Per-page rates from a shops row. This deployment carries BOTH column
 * spellings (bw_rate/rate_bw) — accept either, default 2 / 10.
 */
export function shopRates(shop = {}) {
  const bw = Number(shop.bw_rate ?? shop.rate_bw);
  const color = Number(shop.color_rate ?? shop.rate_color);
  return {
    bwRate: Number.isFinite(bw) && bw >= 0 ? bw : 2,
    colorRate: Number.isFinite(color) && color >= 0 ? color : 10,
  };
}

/** Total = pages × rate(mode). Integer rupees (UPI-friendly). */
export function quoteAmount({ pages, mode = 'bw', shop }) {
  const { bwRate, colorRate } = shopRates(shop);
  const n = Math.max(0, Number(pages) || 0);
  return Math.round(n * (mode === 'color' ? colorRate : bwRate));
}

/**
 * UPI deep link for the shop. Returns null when the shop has no UPI id —
 * the message builder then falls back to counter payment wording.
 */
export function buildUpiLink(shop, amount, note = 'PrintX print order') {
  const pa = String(shop?.upi_id || '').trim();
  if (!pa) return null;
  const params = new URLSearchParams({
    pa,
    pn: String(shop?.name || 'PrintX Shop'),
    am: Number(amount).toFixed(2),
    cu: 'INR',
    tn: note,
  });
  return `upi://pay?${params.toString()}`;
}

/** Count PDF pages with pdf-parse v2. Returns 0 on unreadable input. */
export async function countPdfPages(buffer) {
  try {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    if (typeof parser.destroy === 'function') await parser.destroy();
    return Number(result?.total) || 0;
  } catch (err) {
    console.warn('[wa-webhook] pdf-parse failed:', err?.message || err);
    return 0;
  }
}

/* ================================================================== */
/* 4. Spec-exact customer replies                                      */
/* ================================================================== */

/**
 * "📄 Document Received! Total Pages: X | Amount: ₹Y.
 *  Pay via Print Pass / UPI Link: [UPI_URL]"
 * + the PAID-reply instruction the payment flow depends on.
 */
export function buildDocumentReceivedMessage({ pages, amount, upiLink }) {
  return [
    `📄 Document Received! Total Pages: ${pages} | Amount: ₹${amount}.`,
    upiLink
      ? `Pay via Print Pass / UPI Link: ${upiLink}`
      : `Pay via Print Pass or at the counter.`,
    ``,
    `Reply *PAID* once payment is done to start printing.`,
  ].join('\n');
}

/** "✅ Payment Confirmed! Your Document is printing now. Pick up at Counter." */
export function buildPaymentConfirmedMessage({ tokenNumber } = {}) {
  const core = '✅ Payment Confirmed! Your Document is printing now. Pick up at Counter.';
  return tokenNumber ? `${core}\n🎫 Token: *${tokenNumber}*` : core;
}

/** Polite failure replies (media unreadable / no pending doc / non-PDF). */
export const REPLY_MEDIA_UNAVAILABLE =
  '😕 Could not download your document from WhatsApp. Please re-send the PDF (under 16 MB).';
export const REPLY_NOT_PDF = '😕 Only PDF documents can be printed. Please send a .pdf file.';
export const REPLY_NO_PAGES = '😕 We could not read any pages in that PDF. Please re-export and re-send it.';
export const REPLY_NO_PENDING =
  '❓ No pending print job found for your number. Send your PDF first, then reply PAID after payment.';

/* ================================================================== */
/* 5. Pending-document store (system_settings KV, 6h TTL)              */
/* ================================================================== */

/** Drop expired entries (and anything malformed). */
export function filterPending(list, now = Date.now()) {
  if (!Array.isArray(list)) return [];
  return list.filter(
    (e) =>
      e &&
      e.shop_id &&
      e.file_url &&
      Number.isFinite(Number(e.created_at)) &&
      now - Number(e.created_at) < PENDING_TTL_MS
  );
}

/** Newest pending doc for this phone + shop (phone compared on last 10 digits). */
export function findPending(list, phone, shopId) {
  const target = normalizePhone(phone);
  const matches = list.filter((e) => e.shop_id === shopId && normalizePhone(e.phone) === target);
  if (!matches.length) return null;
  return matches.reduce((a, b) => (Number(b.created_at) >= Number(a.created_at) ? b : a));
}

/** Read + TTL-clean the pending list. */
export async function loadPending(supabase, now = Date.now()) {
  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', PENDING_KEY)
      .maybeSingle();
    if (error) throw error;
    const cleaned = filterPending(data?.value, now);
    return { list: cleaned, dirty: cleaned.length !== (data?.value?.length ?? 0) };
  } catch (err) {
    console.warn('[wa-webhook] pending load failed:', err?.message || err);
    return { list: [], dirty: false };
  }
}

/** Persist the pending list (upsert on key). */
export async function savePending(supabase, list) {
  try {
    const { error } = await supabase
      .from('system_settings')
      .upsert(
        { key: PENDING_KEY, value: list, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[wa-webhook] pending save failed:', err?.message || err);
    return false;
  }
}

/**
 * Which shop owns this WhatsApp number?
 *   1. system_settings `whatsapp_bindings` — { phone_number_id: slug }
 *   2. env WHATSAPP_SHOP_SLUG
 *   3. lib/shop.js DEFAULT_SHOP_SLUG
 * Returns the full shops row (select * — schema-drift tolerant) or null.
 */
export async function resolveShopForWebhook(supabase, { phone_number_id = null } = {}) {
  const slugs = [];
  if (phone_number_id) {
    try {
      const { data } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', BINDINGS_KEY)
        .maybeSingle();
      const bound = data?.value?.[phone_number_id];
      if (bound) slugs.push(bound);
    } catch (err) {
      console.warn('[wa-webhook] bindings lookup failed:', err?.message || err);
    }
  }
  if (process.env.WHATSAPP_SHOP_SLUG) slugs.push(process.env.WHATSAPP_SHOP_SLUG);
  slugs.push('sharma_xerox'); // DEFAULT_SHOP_SLUG

  for (const slug of slugs) {
    try {
      const { data, error } = await supabase
        .from('shops')
        .select('*')
        .eq('slug', slug)
        .maybeSingle();
      if (!error && data) return data;
    } catch {
      /* try next candidate */
    }
  }
  // Last resort: any active shop so the first message still gets a quote.
  try {
    const { data } = await supabase
      .from('shops')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1);
    return data?.[0] || null;
  } catch {
    return null;
  }
}

/* ================================================================== */
/* 6. The two flows (injectable deps)                                  */
/* ================================================================== */

/**
 * Incoming PDF → count pages → quote → store file → save pending → reply.
 *
 * deps:
 *   supabase        — server client (storage + KV)
 *   fetchMediaBuffer(mediaId) → Buffer|null (Graph API download)
 *   send(message)   — fire-and-forget WhatsApp reply to this message's sender
 *
 * Always resolves (never throws) so the route can ack Meta with 200.
 */
export async function processDocumentMessage({ message, shop, supabase, fetchMediaBuffer, send }) {
  try {
    if (!message?.document?.id) return { ok: false, reason: 'no-media-id' };
    if (message.document.mime_type && !/pdf/i.test(message.document.mime_type)) {
      send(REPLY_NOT_PDF);
      return { ok: false, reason: 'not-pdf' };
    }

    /* ---- 1. Download media from WhatsApp's CDN (URL is not in the payload
     *         for inbound docs — Cloud API resolves id → URL → bytes). ---- */
    const buffer = await fetchMediaBuffer(message.document.id);
    if (!buffer || !buffer.length) {
      send(REPLY_MEDIA_UNAVAILABLE);
      return { ok: false, reason: 'media-unavailable' };
    }

    /* ---- 2. Auto page count (pdf-parse v2) ---- */
    const pages = await countPdfPages(buffer);
    if (!pages) {
      send(REPLY_NO_PAGES);
      return { ok: false, reason: 'unreadable-pdf' };
    }

    /* ---- 3. Shop rates → amount (+ caption hints) ---- */
    const { mode, copies } = parseOrderHints(message.document.caption);
    const amount = quoteAmount({ pages: pages * copies, mode, shop });
    const upiLink = buildUpiLink(shop, amount, `PrintX ${pages}pg ${mode === 'color' ? 'Color' : 'BW'}`);

    /* ---- 4. Persist file to Supabase Storage (WhatsApp URLs expire) ---- */
    const safeName = (message.document.filename || 'whatsapp-doc.pdf').replace(/[^\w.\-() ]/g, '_').slice(-100);
    const storagePath = `whatsapp/${shop.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
    let storedBucket = null;
    let upErr = null;
    for (const bucket of BUCKETS) {
      const res = await supabase.storage
        .from(bucket)
        .upload(storagePath, buffer, { contentType: 'application/pdf', upsert: false });
      if (!res.error) { storedBucket = bucket; break; }
      upErr = res.error;
      // Missing bucket → create it (public) and retry this upload once.
      if (/bucket not found|nosuchbucket/i.test(upErr.message || '')) {
        const { error: createErr } = await supabase.storage.createBucket(bucket, { public: true });
        if (!createErr || /already exists|duplicate/i.test(createErr.message || '')) {
          const retry = await supabase.storage
            .from(bucket)
            .upload(storagePath, buffer, { contentType: 'application/pdf', upsert: false });
          if (!retry.error) { storedBucket = bucket; upErr = null; break; }
        }
      }
    }
    if (upErr || !storedBucket) throw new Error(`storage upload: ${upErr?.message || 'no storage bucket available'}`);
    const publicUrl = supabase.storage.from(storedBucket).getPublicUrl(storagePath).data?.publicUrl;
    if (!publicUrl) throw new Error('no public url for uploaded document');

    /* ---- 5. Save pending entry (awaiting payment confirmation) ---- */
    const { list } = await loadPending(supabase);
    list.push({
      phone: normalizePhone(message.from),
      customer_name: null,
      shop_id: shop.id,
      media_id: message.document.id,
      message_id: message.id,
      file_url: publicUrl,
      file_name: message.document.filename || safeName,
      pages,
      copies,
      mode,
      amount,
      created_at: Date.now(),
    });
    const saved = await savePending(supabase, list);
    if (!saved) return { ok: false, reason: 'pending-save-failed' };

    /* ---- 6. Auto-reply: pages + amount + UPI link ---- */
    send(buildDocumentReceivedMessage({ pages: pages * copies, amount, upiLink }));
    return { ok: true, pages: pages * copies, amount, upiLink, file_url: publicUrl };
  } catch (err) {
    console.error('[wa-webhook] document flow failed:', err?.message || err);
    send(REPLY_MEDIA_UNAVAILABLE);
    return { ok: false, reason: 'error', error: err?.message };
  }
}

/**
 * Payment confirmed → create the print job + orders row → confirm on WhatsApp.
 *
 * deps:
 *   supabase  — server client (KV + inserts)
 *   nextDailyToken — daily #n generator (lib/dailyToken)
 *   send(message)   — fire-and-forget reply
 */
export async function processPaymentConfirmation({ message, shop, supabase, nextDailyToken, send }) {
  try {
    const { list } = await loadPending(supabase);
    const entry = findPending(list, message.from, shop.id);
    if (!entry) {
      send(REPLY_NO_PENDING);
      return { ok: false, reason: 'no-pending' };
    }

    /* ---- Daily token — same counter as uploads + walk-ins ---- */
    const dailyTokenNo = await nextDailyToken(supabase, shop.id);
    const tokenNumber = dailyTokenNo != null ? `#${dailyTokenNo}` : `#${Date.now().toString().slice(-4)}`;

    /* ---- print_jobs row (schema-proven payload — mirrors manual-entry) ---- */
    const insertPayload = {
      shop_id: shop.id,
      token_number: tokenNumber,
      customer_name: 'WhatsApp Customer',
      customer_phone: entry.phone || null,
      file_url: entry.file_url,
      file_name: entry.file_name,
      pages: entry.pages,
      copies: entry.copies || 1,
      status: 'PENDING', // Auto-Print Mode picks up fresh PENDING inserts
    };
    const { data: job, error: insertErr } = await supabase
      .from('print_jobs')
      .insert(insertPayload)
      .select('id')
      .single();
    if (insertErr || !job) throw new Error(`print_jobs insert: ${insertErr?.message || 'no row'}`);

    /* ---- orders sidecar — payment_method='whatsapp' per spec ---- */
    const sidecarPayload = {
      id: job.id,
      shop_id: shop.id,
      customer_phone: entry.phone || null,
      file_name: entry.file_name,
      file_url: entry.file_url,
      pages: entry.pages,
      copies: entry.copies || 1,
      ...(entry.mode === 'color'
        ? { bw_pages: 0, color_pages: entry.pages }
        : { bw_pages: entry.pages, color_pages: 0 }),
      total_amount: entry.amount,
      payment_method: 'whatsapp',
      binding_type: 'none',
      binding_cost: 0,
      paper_size: 'A4',
      status: 'PENDING',
      ...(dailyTokenNo != null ? { token_no: dailyTokenNo } : {}),
    };
    let { error: sidecarErr } = await supabase.from('orders').insert(sidecarPayload);
    // Schema-drift safety: drop up to 3 unknown columns and retry.
    for (let attempt = 0; sidecarErr && attempt < 3; attempt++) {
      const col = ((sidecarErr.message || '').match(/'([\w]+)'\s+column/) ||
        (sidecarErr.message || '').match(/column\s+"(\w+)"/) ||
        [])[1];
      if (!col || !(col in sidecarPayload)) break;
      console.warn(`[wa-webhook] orders sidecar: dropping missing column "${col}"`);
      delete sidecarPayload[col];
      const retry = await supabase.from('orders').insert(sidecarPayload);
      sidecarErr = retry.error || null;
    }
    if (sidecarErr) {
      // Non-fatal: the job exists; token/binding badge degrades. Loud, not silent.
      console.error('[wa-webhook] orders sidecar insert failed:', sidecarErr.message);
    }

    /* ---- Clear this pending doc so a re-sent PAID can't double-order ---- */
    await savePending(supabase, list.filter((e) => e !== entry));

    /* ---- Confirmation ---- */
    send(buildPaymentConfirmedMessage({ tokenNumber }));
    return { ok: true, tokenNumber, jobId: job.id, amount: entry.amount };
  } catch (err) {
    console.error('[wa-webhook] payment flow failed:', err?.message || err);
    send('😕 We could not create your print job yet. Please try replying PAID again.');
    return { ok: false, reason: 'error', error: err?.message };
  }
}
