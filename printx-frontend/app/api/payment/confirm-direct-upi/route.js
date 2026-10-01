import { NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseAdminConfigured } from '../../../../lib/supabaseAdmin';
import { nextDailyToken } from '../../../../lib/dailyToken';

export const dynamic = 'force-dynamic';

/**
 * POST /api/payment/confirm-direct-upi
 *
 * Called by the checkout when the customer RETURNS from a UPI app (window
 * focus / visibilitychange) after a direct deep-link payment — no manual
 * UTR entry required.
 *
 * Body: { orderId, utr?, paid? }
 *   orderId — the draft order created when the UPI button was tapped
 *             (orders.id === print_jobs.id, see /api/upload sidecar)
 *   utr     — optional bank reference; when supplied (or paid=true) the
 *             order is marked PAID, otherwise PENDING_VERIFICATION so the
 *             shop verifies at the counter while the customer already has
 *             their token.
 *
 * Does, in order:
 *   1. load the draft order (404 when unknown, 409 when not a UPI order)
 *   2. mark orders.payment_status = 'PAID' | 'PENDING_VERIFICATION'
 *      (progressive column drop — the column ships in
 *       supabase/migrations/20260928_orders_payment_status.sql; until then
 *       the state is mirrored into the system_settings KV so it persists)
 *   3. allocate/ensure the daily sequential token (orders.token_no) via the
 *      shared nextDailyToken counter
 *   4. notify the vendor dashboard Realtime channel:
 *        · orders UPDATE → the existing postgres_changes listener in
 *          LiveQueueTable refires immediately
 *        · broadcast `PAYMENT_CONFIRMED` on `print-jobs-{shopId}` → toast
 *      Response: { success, payment_status, tokenNo, tokenNumber }
 */

const KV_PREFIX = 'upi_intent_tx::'; // fallback audit key when the column is absent

const isMissingColumn = (err) =>
  Boolean(err) &&
  (err.code === 'PGRST204' || err.code === '42703' || /column/i.test(err.message || ''));

const isMissingTable = (err) =>
  Boolean(err) &&
  (err.code === 'PGRST205' || /Could not find the table/i.test(err.message || ''));

/** Mirror into system_settings KV — only used when orders lacks payment_status. */
async function mirrorToKv(orderId, order, paymentStatus) {
  try {
    await supabaseAdmin.from('system_settings').upsert(
      {
        key: `${KV_PREFIX}${orderId}`,
        value: {
          order_id: orderId,
          shop_id: order.shop_id,
          payment_status: paymentStatus,
          amount: order.total_amount ?? null,
          updated_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    );
  } catch (err) {
    console.warn('[confirm-direct-upi] KV mirror failed (non-fatal):', err?.message);
  }
}

/** Fire-and-forget vendor realtime notify (orders UPDATE already fired above). */
async function notifyVendor(shopId, payload) {
  if (!shopId) return;
  try {
    const channel = supabaseAdmin.channel(`print-jobs-${shopId}`);
    const res = await channel.send({
      type: 'broadcast',
      event: 'PAYMENT_CONFIRMED',
      payload,
    });
    // 'ok' | 'error' | 'timed out' (REST fallback on hosted realtime)
    if (res !== 'ok') throw new Error(`realtime send: ${res}`);
    setTimeout(() => {
      try { supabaseAdmin.removeChannel(channel); } catch { /* noop */ }
    }, 2000);
  } catch (err) {
    console.warn('[confirm-direct-upi] vendor broadcast failed (non-fatal):', err?.message);
  }
}

export async function POST(request) {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    return NextResponse.json(
      { success: false, error: 'Supabase is not configured.' },
      { status: 501 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const orderId = String(body?.orderId || '').trim();
  const utr = String(body?.utr || '').trim();
  const paidFlag = body?.paid === true;

  if (!orderId) {
    return NextResponse.json(
      { success: false, error: 'orderId is required.', field: 'orderId' },
      { status: 400 }
    );
  }

  /* ---------- 1. Load the draft order ---------- */
  const { data: order, error: loadErr } = await supabaseAdmin
    .from('orders')
    .select('id, shop_id, token_no, payment_method, total_amount, status, created_at')
    .eq('id', orderId)
    .maybeSingle();

  if (loadErr) {
    console.error('[confirm-direct-upi] order load failed:', loadErr);
    return NextResponse.json(
      { success: false, error: loadErr.message || 'Could not load the order.' },
      { status: 500 }
    );
  }
  if (!order) {
    return NextResponse.json(
      { success: false, error: `Order ${orderId} not found — it may have been removed.` },
      { status: 404 }
    );
  }

  const method = String(order.payment_method || '').toLowerCase();
  if (method && method !== 'upi_intent') {
    return NextResponse.json(
      {
        success: false,
        error: `Order ${orderId} was placed via ${order.payment_method}, not the UPI app flow.`,
      },
      { status: 409 }
    );
  }

  /* ---------- 2. Mark payment status ---------- */
  const paymentStatus = utr || paidFlag ? 'PAID' : 'PENDING_VERIFICATION';

  const payload = { payment_status: paymentStatus, payment_method: 'upi_intent' };
  let columnDropped = false;
  let lastErr = null;
  let attempt = { ...payload };

  for (let i = 0; i < 3 && Object.keys(attempt).length > 0; i++) {
    const { error } = await supabaseAdmin.from('orders').update(attempt).eq('id', orderId);
    if (!error) {
      lastErr = null;
      break;
    }
    lastErr = error;
    if (isMissingColumn(error) && attempt.payment_status !== undefined) {
      // orders.payment_status not migrated yet — keep the rest of the update
      // (it is a REAL UPDATE, so the vendor's postgres_changes listener still
      // fires) and persist the state in the KV mirror instead.
      columnDropped = true;
      delete attempt.payment_status;
      continue;
    }
    break;
  }

  if (lastErr && !isMissingColumn(lastErr)) {
    console.error('[confirm-direct-upi] orders update failed:', lastErr);
    return NextResponse.json(
      { success: false, error: lastErr.message || 'Could not update the order.' },
      { status: 500 }
    );
  }

  if (columnDropped || lastErr) {
    await mirrorToKv(orderId, order, paymentStatus);
  }

  /* ---------- 3. Ensure the daily sequential token ---------- */
  let tokenNo = order.token_no;
  if (tokenNo == null) {
    const minted = await nextDailyToken(supabaseAdmin, order.shop_id);
    if (minted != null) {
      const { error: tokErr } = await supabaseAdmin
        .from('orders')
        .update({ token_no: minted })
        .eq('id', orderId);
      if (tokErr && !isMissingColumn(tokErr)) {
        console.warn('[confirm-direct-upi] token write failed:', tokErr.message);
      } else if (!tokErr) {
        tokenNo = minted;
        // Keep the legacy string column in sync (same contract as /api/upload).
        const sync = await supabaseAdmin
          .from('print_jobs')
          .update({ token_number: `#${minted}` })
          .eq('id', orderId);
        if (sync.error) {
          console.warn('[confirm-direct-upi] print_jobs token sync failed:', sync.error.message);
        }
      }
    }
  }

  const tokenNumber = tokenNo != null ? `#${tokenNo}` : null;

  /* ---------- 4. Notify the vendor dashboard ---------- */
  await notifyVendor(order.shop_id, {
    orderId,
    tokenNo,
    tokenNumber,
    payment_status: paymentStatus,
    amount: order.total_amount ?? null,
    utr: utr || null,
    at: Date.now(),
  });

  return NextResponse.json({
    success: true,
    payment_status: paymentStatus,
    tokenNo: tokenNo ?? null,
    tokenNumber,
    amount: order.total_amount ?? null,
    persisted: columnDropped ? 'kv' : 'column',
  });
}
