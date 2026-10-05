/**
 * Security probe for the subscription-upgrade flow.
 *
 * Proves that a shop's plan can only change after a REAL Razorpay payment:
 *   A. the old `order_demo_*` exploit against /api/razorpay/verify
 *   B. a forged signature on /api/billing/verify-payment
 *   C. a VALID HMAC signature on an order Razorpay has not paid
 *   D. client-side price tampering on /api/billing/create-plan-order
 *
 * Run: node scripts/billing-security-probe.mjs
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const SB = process.env.PROBE_BASE || 'http://127.0.0.1:51528';
const SHOP_ID = '28030791-01e1-495c-a340-dc6ab8ee59ce';

// ---- env -------------------------------------------------------------------
const envTxt = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
const env = {};
for (const line of envTxt.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const RZP_SECRET = env.RAZORPAY_KEY_SECRET;
const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const SB_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL) { console.log('NEXT_PUBLIC_SUPABASE_URL missing from .env.local'); process.exit(2); }
if (!SB_KEY) { console.log('SUPABASE_SERVICE_ROLE_KEY missing from .env.local'); process.exit(2); }

// ---- helpers ---------------------------------------------------------------
const log = (s) => console.log(s);
const ok = (s) => console.log(`  PASS  ${s}`);
const bad = (s) => { console.log(`  FAIL  ${s}`); process.exitCode = 1; };

async function planNow() {
  const r = await fetch(`${SB_URL}/rest/v1/shops?id=eq.${SHOP_ID}&select=subscription_plan,subscription_expires_at`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  const j = await r.json();
  return j[0] || null;
}

async function ledgerCount() {
  const r = await fetch(`${SB_URL}/rest/v1/wallet_transactions?shop_id=eq.${SHOP_ID}&select=id`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: 'count=exact' },
  });
  return Number(r.headers.get('content-range')?.split('/')[1] || 0);
}

async function post(p, body) {
  const r = await fetch(`${SB}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  let j = null;
  try { j = await r.json(); } catch { /* empty body */ }
  return { status: r.status, body: j };
}

const BASELINE = await planNow();
const BASE_LEDGER = await ledgerCount();
log(`baseline plan = ${BASELINE?.subscription_plan}  expires = ${BASELINE?.subscription_expires_at}`);
log(`baseline ledger rows = ${BASE_LEDGER}\n`);

if (!RZP_SECRET) { log('RAZORPAY_KEY_SECRET missing — cannot run HMAC probes'); process.exit(2); }

// ---- Probe A: the original free-upgrade exploit ---------------------------
log('Probe A — replay of the original order_demo_* exploit (POST /api/razorpay/verify)');
{
  const r = await post('/api/razorpay/verify', {
    razorpay_order_id: 'order_demo_ATTACKER',
    razorpay_payment_id: 'pay_demo_ATTACKER',
    razorpay_signature: 'garbage',
    planId: 'lifetime',
    shopId: SHOP_ID,
  });
  log(`  -> HTTP ${r.status} ${JSON.stringify(r.body)}`);
  if (r.status === 200) bad('A: exploit still returns 200 — plan may have been upgraded');
  else ok(`A: blocked with HTTP ${r.status}`);
}

// ---- Probe B: forged signature on the real verification route -------------
log('\nProbe B — forged signature on /api/billing/verify-payment');
let created;
{
  const c = await post('/api/billing/create-plan-order', {
    planId: 'lifetime', billingCycle: 'lifetime', shopId: SHOP_ID,
  });
  created = c.body;
  log(`  create-plan-order -> HTTP ${c.status} orderId=${created?.orderId} intent=${created?.intentId?.slice(0, 12)}… amount=${created?.amount}`);

  const r = await post('/api/billing/verify-payment', {
    razorpay_order_id: created.orderId,
    razorpay_payment_id: 'pay_FORGED',
    razorpay_signature: 'deadbeef',
    intentId: created.intentId,
  });
  log(`  -> HTTP ${r.status} ${JSON.stringify(r.body)}`);
  if (r.status === 200) bad('B: forged signature accepted — plan may have been upgraded');
  else if (/signature verification failed/i.test(r.body?.error || '')) ok('B: intent validated, signature gate rejected the forgery');
  else bad(`B: rejected at the wrong gate: ${r.body?.error}`);
}

// ---- Probe B2: tampered intent token --------------------------------------
log('\nProbe B2 — tamper with the signed intent (rewrite plan inside it)');
{
  const [body, sig] = String(created.intentId).split('.');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  payload.p = 'pro'; // attacker swaps Lifetime -> Pro, signature no longer covers it
  const forged = Buffer.from(JSON.stringify(payload)).toString('base64url') + '.' + sig;
  const r = await post('/api/billing/verify-payment', {
    razorpay_order_id: created.orderId,
    razorpay_payment_id: 'pay_FORGED2',
    razorpay_signature: 'deadbeef',
    intentId: forged,
  });
  log(`  -> HTTP ${r.status} ${JSON.stringify(r.body)}`);
  if (r.status === 200) bad('B2: tampered intent accepted — CRITICAL');
  else if (/no longer valid|invalid|forged|expired/i.test(r.body?.error || '')) ok('B2: token signature covers the plan — tampering rejected');
  else bad(`B2: unexpected error ${r.body?.error}`);
}

// ---- Probe C: VALID signature, order NOT paid ------------------------------
log('\nProbe C — cryptographically VALID signature on an unpaid order');
{
  const sig = crypto
    .createHmac('sha256', RZP_SECRET)
    .update(`${created.orderId}|pay_REALBUTUNPAID`)
    .digest('hex');
  const r = await post('/api/billing/verify-payment', {
    razorpay_order_id: created.orderId,
    razorpay_payment_id: 'pay_REALBUTUNPAID',
    razorpay_signature: sig,
    intentId: created.intentId,
  });
  log(`  -> HTTP ${r.status} ${JSON.stringify(r.body)}`);
  if (r.status === 200) bad('C: unpaid order upgraded the plan — CRITICAL');
  else if (/not completed/i.test(r.body?.error || '')) ok('C: signature gate PASSED, Razorpay payment-state gate blocked it');
  else bad(`C: rejected at the wrong gate: ${r.body?.error}`);
}

// ---- Probe D: client price tampering ---------------------------------------
log('\nProbe D — client sends amount:1 for a ₹1999 Lifetime plan');
{
  const c = await post('/api/billing/create-plan-order', {
    planId: 'lifetime', billingCycle: 'lifetime', shopId: SHOP_ID, amount: 1,
  });
  log(`  -> HTTP ${c.status} server amount=${c.body?.amount} (client sent 1)`);
  if (c.body?.amount === 199900) ok('D: server priced from its own catalog (199900 paise = ₹1999)');
  else bad(`D: unexpected amount ${c.body?.amount}`);
}

// ---- assertions ------------------------------------------------------------
log('\nFinal assertions');
const after = await planNow();
const afterLedger = await ledgerCount();
log(`  plan now = ${after?.subscription_plan} (was ${BASELINE?.subscription_plan})`);
log(`  ledger rows = ${afterLedger} (was ${BASE_LEDGER})`);

if (after?.subscription_plan === BASELINE?.subscription_plan &&
    after?.subscription_expires_at === BASELINE?.subscription_expires_at) {
  ok('Plan and expiry are byte-identical to baseline — no upgrade happened');
} else {
  bad('PLAN CHANGED — a bypass succeeded, restore required');
}
if (afterLedger === BASE_LEDGER) ok('No spurious wallet_transactions rows written');
else bad(`Ledger changed ${BASE_LEDGER} -> ${afterLedger}`);

log(process.exitCode ? '\nRESULT: FAILURES PRESENT' : '\nRESULT: ALL PROBES PASSED');
