import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendWhatsAppFireAndForget } from '../../../../lib/whatsapp';
import { nextDailyToken } from '../../../../lib/dailyToken';
import {
  VERIFY_TOKEN,
  verifyWebhook,
  parseWebhookPayload,
  isPaymentConfirmation,
  resolveShopForWebhook,
  processDocumentMessage,
  processPaymentConfirmation,
} from '../../../../lib/whatsappWebhook';

/**
 * WhatsApp Cloud API webhook — PrintX auto-quote + payment-gated printing.
 *
 * GET  /api/whatsapp/webhook
 *   Meta's subscribe handshake: echo hub.challenge when hub.verify_token
 *   matches WHATSAPP_VERIFY_TOKEN (dev fallback: lib VERIFY_TOKEN constant).
 *
 * POST /api/whatsapp/webhook
 *   Inbound customer messages:
 *     • document (PDF) → download media → pdf-parse page count → shop rates
 *       → ₹ quote + UPI link reply → file to Storage → pending KV entry
 *     • text "PAID"/…  → pending doc → print_jobs + orders insert
 *       (payment_method='whatsapp', shared daily token) → confirmation reply
 *
 * Every parseable POST acks 200 — Meta treats non-2xx as retryable and a
 * poison message must not loop forever. Flows never throw; failures are
 * logged and answered to the customer with a polite retry prompt.
 *
 * Env (all optional in dev — sends fall back to demo console logging):
 *   WHATSAPP_VERIFY_TOKEN, WHATSAPP_API_KEY / WHATSAPP_ACCESS_TOKEN,
 *   WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_SHOP_SLUG
 */

export const runtime = 'nodejs'; // pdf-parse + Storage upload need Node APIs
export const dynamic = 'force-dynamic';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY) : null;

const GRAPH = 'https://graph.facebook.com/v18.0';
const graphToken =
  process.env.WHATSAPP_API_KEY || process.env.WHATSAPP_ACCESS_TOKEN || null;

/* ================================================================== */
/* GET — webhook verification                                          */
/* ================================================================== */

export async function GET(request) {
  const result = verifyWebhook(request.nextUrl.searchParams, VERIFY_TOKEN);
  if (!result.ok) {
    console.warn(`[wa-webhook] verification rejected (${result.reason})`);
    return new NextResponse('Forbidden', { status: 403 });
  }
  console.log('[wa-webhook] Meta verification handshake OK');
  // Meta expects the challenge echoed back as plain text.
  return new NextResponse(result.challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

/* ================================================================== */
/* Media download (Graph API: media id → CDN URL → bytes)             */
/* ================================================================== */

async function fetchMediaBuffer(mediaId) {
  if (!graphToken) {
    console.warn('[wa-webhook] WHATSAPP_API_KEY not set — cannot download media id', mediaId);
    return null;
  }
  try {
    const metaRes = await fetch(`${GRAPH}/${mediaId}`, {
      headers: { Authorization: `Bearer ${graphToken}` },
      cache: 'no-store',
    });
    if (!metaRes.ok) throw new Error(`media lookup HTTP ${metaRes.status}`);
    const meta = await metaRes.json();
    if (!meta?.url) throw new Error('media lookup returned no url');

    const fileRes = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${graphToken}` },
      cache: 'no-store',
    });
    if (!fileRes.ok) throw new Error(`media download HTTP ${fileRes.status}`);
    const bytes = await fileRes.arrayBuffer();
    return Buffer.from(bytes);
  } catch (err) {
    console.error('[wa-webhook] media download failed:', err?.message || err);
    return null;
  }
}

/* ================================================================== */
/* POST — inbound messages                                             */
/* ================================================================== */

export async function POST(request) {
  let body = null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const parsed = parseWebhookPayload(body);
  if (!parsed) {
    // Delivery-status callbacks / foreign pings — ack without work.
    return NextResponse.json({ ok: true, ignored: true });
  }
  if (!parsed.messages.length) {
    return NextResponse.json({ ok: true, ignored: true });
  }
  if (!supabaseAdmin) {
    console.error('[wa-webhook] Supabase not configured — dropping', parsed.messages.length, 'message(s)');
    return NextResponse.json({ ok: false, error: 'supabase not configured' }, { status: 500 });
  }

  const results = [];
  const shopCache = new Map(); // phone_number_id → shop row (one lookup per request)

  for (const message of parsed.messages) {
    try {
      if (!shopCache.has(parsed.phone_number_id)) {
        shopCache.set(
          parsed.phone_number_id,
          await resolveShopForWebhook(supabaseAdmin, { phone_number_id: parsed.phone_number_id })
        );
      }
      const shop = shopCache.get(parsed.phone_number_id);
      if (!shop) {
        console.warn('[wa-webhook] no shop resolvable for this WhatsApp number — skipping', message.id);
        results.push({ id: message.id, ok: false, reason: 'no-shop' });
        continue;
      }

      // Fire-and-forget reply bound to this message's sender.
      const send = (text) => sendWhatsAppFireAndForget({ to: message.from, message: text });

      if (message.type === 'document' && message.document) {
        results.push({
          id: message.id,
          flow: 'document',
          ...(await processDocumentMessage({
            message,
            shop,
            supabase: supabaseAdmin,
            fetchMediaBuffer,
            send,
          })),
        });
      } else if (message.type === 'text' && isPaymentConfirmation(message.text)) {
        results.push({
          id: message.id,
          flow: 'payment',
          ...(await processPaymentConfirmation({
            message,
            shop,
            supabase: supabaseAdmin,
            nextDailyToken,
            send,
          })),
        });
      } else {
        // Non-PDF, plain chatter, images… — ignore silently (still 200).
        results.push({ id: message.id, ok: true, ignored: true, type: message.type });
      }
    } catch (err) {
      // Per-message isolation: one bad message never blocks the batch.
      console.error('[wa-webhook] message handling failed:', err?.message || err);
      results.push({ id: message.id, ok: false, reason: 'error', error: err?.message });
    }
  }

  console.log('[wa-webhook] processed', JSON.stringify(results));
  return NextResponse.json({ ok: true, results });
}
