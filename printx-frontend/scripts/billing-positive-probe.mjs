/**
 * POSITIVE-path probe: a genuinely PAID Razorpay order must upgrade the plan.
 *
 * The adversarial probe (scripts/billing-security-probe.mjs) only proves the
 * upgrade CANNOT happen without money. This proves it DOES happen when the
 * money is real, so the flow is not merely "secure" but functional.
 *
 * It creates a real (test-mode) card payment against the order, verifies it,
 * then restores the shop to its baseline plan and removes the ledger row it
 * created.
 *
 * Run: node scripts/billing-positive-probe.mjs
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const SB = process.env.PROBE_BASE || 'http://127.0.0.1:51528';
const SHOP_ID = '28030791-01e1-495c-a340-dc6ab8ee59ce';
const PLAN = 'advance';
const CYCLE = 'monthly';

const envTxt = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
const env = {};
for (const line of envTxt.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const RZP_KEY_ID = env.RAZORPAY_KEY_ID;
const RZP_SECRET = env.RAZORPAY_KEY_SECRET;
const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const auth = 'Basic ' + Buffer.from(`${RZP_KEY_ID}:${RZP_SECRET}`).toString('base64');
const sbAuth = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

const ok = (s) => console.log(`  PASS  ${s}`);
const bad = (s) => { console.log(`  FAIL  ${s}`); process.exitCode = 1; };

async function shop() {
  const r = await fetch(`${SB_URL}/rest/v1/shops?id=eq.${SHOP_ID}&select=subscription_plan,subscription_expires_at`, { headers: sbAuth });
  return (await r.json())[0];
}
async function post(p, body) {
  const r = await fetch(`${SB}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}

const BASE = await shop();
console.log(`baseline plan = ${BASE.subscription_plan} expires = ${BASE.subscription_expires_at}\n`);

let restore = true;
try {
  // ---- 1. create the plan order -----------------------------------------
  console.log('Step 1 — POST /api/billing/create-plan-order');
  const c = await post('/api/billing/create-plan-order', { planId: PLAN, billingCycle: CYCLE, shopId: SHOP_ID });
  if (c.status !== 200) throw new Error(`create-plan-order failed: ${c.status} ${JSON.stringify(c.body)}`);
  const { orderId, intentId, amount } = c.body;
  console.log(`  -> orderId=${orderId} amount=${amount} plan=${PLAN}/${CYCLE}`);

  // ---- 2. pay it for real, in Razorpay test mode -------------------------
  console.log('\nStep 2 — create a real test-mode card payment against that order');
  const payRes = await fetch('https://api.razorpay.com/v1/payments/create', {
    method: 'POST',
    headers: { Authorization: auth, 'content-type': 'application/json' },
    body: JSON.stringify({
      amount,
      currency: 'INR',
      order_id: orderId,
      method: 'card',
      card: { number: '4111111111111111', expiry_month: 12, expiry_year: 2030, cvv: '123', name: 'Probe' },
    }),
  });
  const payment = await payRes.json().catch(() => ({}));
  if (!payRes.ok || !payment.id) {
    throw new Error(`could not create a test payment (HTTP ${payRes.status}): ${JSON.stringify(payment).slice(0, 300)}`);
  }
  console.log(`  -> payment ${payment.id} status=${payment.status}`);

  // ---- 3. confirm Razorpay itself now considers the order PAID ----------
  console.log('\nStep 3 — Razorpay orders.fetch');
  const ordRes = await fetch(`https://api.razorpay.com/v1/orders/${orderId}`, { headers: { Authorization: auth } });
  const order = await ordRes.json();
  console.log(`  -> order.status=${order.status} amount_paid=${order.amount_paid}`);
  if (String(order.status).toUpperCase() !== 'PAID') throw new Error(`order not PAID: ${order.status}`);

  // ---- 4. verify exactly as the browser callback would -------------------
  console.log('\nStep 4 — POST /api/billing/verify-payment (real signature)');
  const sig = crypto.createHmac('sha256', RZP_SECRET).update(`${orderId}|${payment.id}`).digest('hex');
  const v = await post('/api/billing/verify-payment', {
    razorpay_order_id: orderId,
    razorpay_payment_id: payment.id,
    razorpay_signature: sig,
    intentId,
  });
  console.log(`  -> HTTP ${v.status} ${JSON.stringify(v.body)}`);
  if (v.status === 200 && v.body?.success) ok(`upgrade applied: plan=${v.body.planId} paymentId=${v.body.paymentId}`);
  else bad(`paid payment was NOT accepted: ${v.status} ${JSON.stringify(v.body)}`);

  // ---- 5. the DB really changed -----------------------------------------
  const after = await shop();
  console.log(`\nStep 5 — shops row now: plan=${after.subscription_plan} expires=${after.subscription_expires_at}`);
  if (after.subscription_plan === PLAN) ok(`shops.subscription_plan is now "${PLAN}" (was "${BASE.subscription_plan}")`);
  else bad(`shops.subscription_plan is "${after.subscription_plan}", expected "${PLAN}"`);
  if (after.subscription_expires_at && after.subscription_expires_at !== BASE.subscription_expires_at) ok('expiry advanced');
  else bad('expiry did not change');

  const led = await fetch(`${SB_URL}/rest/v1/wallet_transactions?shop_id=eq.${SHOP_ID}&reference_id=eq.${payment.id}&select=id,amount,description`, { headers: sbAuth });
  const ledRows = await led.json();
  if (ledRows.length > 0) ok(`ledger row recorded: ${JSON.stringify(ledRows[0])}`);
  else bad('no wallet_transactions ledger row was written');
  globalThis.__probePaymentId = payment.id;

  // ---- 6. replay must not re-apply --------------------------------------
  console.log('\nStep 6 — replay the same paid callback (must not re-apply)');
  const v2 = await post('/api/billing/verify-payment', {
    razorpay_order_id: orderId, razorpay_payment_id: payment.id, razorpay_signature: sig, intentId,
  });
  const after2 = await shop();
  console.log(`  -> HTTP ${v2.status} duplicate=${v2.body?.duplicate}`);
  if (v2.body?.duplicate) ok('replay detected as duplicate');
  else bad(`replay was not flagged duplicate: ${JSON.stringify(v2.body)}`);
  if (after2.subscription_expires_at === after.subscription_expires_at) ok('expiry unchanged by the replay');
  else bad(`replay moved expiry ${after.subscription_expires_at} -> ${after2.subscription_expires_at}`);
} catch (e) {
  bad(String(e.message || e));
  restore = true;
} finally {
  if (restore) {
    console.log('\nRestore — putting the shop back to its baseline plan');
    const p = await fetch(`${SB_URL}/rest/v1/shops?id=eq.${SHOP_ID}`, {
      method: 'PATCH',
      headers: { ...sbAuth, 'content-type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ subscription_plan: BASE.subscription_plan, subscription_expires_at: BASE.subscription_expires_at }),
    });
    console.log(`  PATCH shops -> HTTP ${p.status}`);
    if (globalThis.__probePaymentId) {
      const d = await fetch(`${SB_URL}/rest/v1/wallet_transactions?shop_id=eq.${SHOP_ID}&reference_id=eq.${globalThis.__probePaymentId}`, {
        method: 'DELETE', headers: sbAuth,
      });
      console.log(`  DELETE wallet_transactions -> HTTP ${d.status}`);
    }
    const now = await shop();
    console.log(`  final: plan=${now.subscription_plan} expires=${now.subscription_expires_at}`);
    if (now.subscription_plan === BASE.subscription_plan && now.subscription_expires_at === BASE.subscription_expires_at) {
      ok('shop restored to baseline');
    } else bad('SHOP NOT RESTORED — fix manually');
  }
}
console.log(process.exitCode ? '\nRESULT: FAILURES PRESENT' : '\nRESULT: POSITIVE PATH VERIFIED');
