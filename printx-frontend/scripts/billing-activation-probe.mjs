/**
 * Positive-path probe, part 2 — the activation itself.
 *
 * The adversarial probe proves the upgrade canNOT happen without money.
 * The browser probe proves clicking Upgrade opens Razorpay and that no plan
 * change occurs before payment. What is left is the function that actually
 * WRITES the plan, which /api/billing/verify-payment calls only after every
 * gate passes.
 *
 * Razorpay's checkout is a cross-origin iframe that cannot be driven headlessly,
 * and their API does not allow creating a test payment directly, so we cannot
 * produce a real capture here. Instead we invoke the exact activation function
 * with the arguments a genuinely-paid request would carry, and assert:
 *   1. the shops row really changes (plan + expiry advance)
 *   2. a wallet_transactions ledger row is written
 *   3. replaying the same payment id is a no-op (expiry does not move again)
 *
 * The shop is restored to its baseline plan in the finally block.
 *
 * Run: node scripts/billing-activation-probe.mjs
 */
import fs from 'fs';
import path from 'path';

// Load .env.local into process.env before importing the service.
const envTxt = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
for (const line of envTxt.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}

const SHOP_ID = '28030791-01e1-495c-a340-dc6ab8ee59ce';
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sbAuth = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

const ok = (s) => console.log(`  PASS  ${s}`);
const bad = (s) => { console.log(`  FAIL  ${s}`); process.exitCode = 1; };

const { applySubscriptionUpgrade } = await import('../lib/subscriptionService.js');

async function shop() {
  const r = await fetch(`${SB_URL}/rest/v1/shops?id=eq.${SHOP_ID}&select=subscription_plan,subscription_expires_at`, { headers: sbAuth });
  return (await r.json())[0];
}
async function ledger(paymentId) {
  // wallet_transactions has no shop_id / reference_id on this deployment, so
  // attribution lives in `description` (see ledgerDescription in subscriptionService).
  const r = await fetch(`${SB_URL}/rest/v1/wallet_transactions?description=like.*${paymentId}*&select=id,amount,type,description`, { headers: sbAuth });
  return r.json();
}

const BASE = await shop();
console.log(`baseline plan = ${BASE.subscription_plan} expires = ${BASE.subscription_expires_at}\n`);

// Stands in for the razorpay_payment_id a real capture would return.
const FAKE_PAYMENT_ID = 'pay_probe_activation_' + Date.now().toString(36);

try {
  console.log('Step 1 — activation for a paid payment (as /api/billing/verify-payment would call it)');
  const res = await applySubscriptionUpgrade({
    shopId: SHOP_ID,
    planId: 'advance',
    billingCycle: 'monthly',
    amountRupees: 2499,
    paymentId: FAKE_PAYMENT_ID,
    orderId: 'order_probe_activation',
  });
  console.log(`  -> ${JSON.stringify(res)}`);
  if (!res.ok) bad('activation returned not-ok');
  else ok(`activation returned ok, expiresAt=${res.expiresAt}`);

  const after = await shop();
  console.log(`\nStep 2 — shops row: plan=${after.subscription_plan} expires=${after.subscription_expires_at}`);
  if (after.subscription_plan === 'advance') ok('shops.subscription_plan upgraded to "advance"');
  else bad(`plan is "${after.subscription_plan}", expected "advance"`);
  if (after.subscription_expires_at !== BASE.subscription_expires_at && after.subscription_expires_at) ok('expiry advanced');
  else bad('expiry did not advance');

  console.log('\nStep 3 — ledger row');
  const rows = await ledger(FAKE_PAYMENT_ID);
  if (rows.length > 0) ok(`wallet_transactions recorded: ${JSON.stringify(rows[0])}`);
  else bad('no ledger row was written');
  if (rows.length > 0 && String(rows[0].description).includes(SHOP_ID)) ok('ledger row is attributable to the shop');
  else bad('ledger row does not record which shop paid');

  console.log('\nStep 4 — replay the same payment (must not move the plan/expiry again)');
  const replay = await applySubscriptionUpgrade({
    shopId: SHOP_ID, planId: 'advance', billingCycle: 'monthly',
    amountRupees: 2499, paymentId: FAKE_PAYMENT_ID, orderId: 'order_probe_activation',
  });
  const after2 = await shop();
  console.log(`  -> duplicate=${replay.duplicate} expires=${after2.subscription_expires_at}`);
  if (replay.duplicate) ok('replay flagged duplicate — idempotency guard works');
  else bad(`replay not flagged duplicate: ${JSON.stringify(replay)}`);
  if (after2.subscription_expires_at === after.subscription_expires_at) ok('expiry unchanged by replay');
  else bad(`replay moved expiry ${after.subscription_expires_at} -> ${after2.subscription_expires_at}`);

  const rows2 = await ledger(FAKE_PAYMENT_ID);
  if (rows2.length === rows.length) ok('no duplicate ledger row');
  else bad(`ledger grew ${rows.length} -> ${rows2.length}`);
} catch (e) {
  bad(String(e?.stack || e));
} finally {
  console.log('\nRestore — returning the shop to baseline');
  const p = await fetch(`${SB_URL}/rest/v1/shops?id=eq.${SHOP_ID}`, {
    method: 'PATCH',
    headers: { ...sbAuth, 'content-type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ subscription_plan: BASE.subscription_plan, subscription_expires_at: BASE.subscription_expires_at }),
  });
  const d = await fetch(`${SB_URL}/rest/v1/wallet_transactions?description=like.*${FAKE_PAYMENT_ID}*`, { method: 'DELETE', headers: sbAuth });
  console.log(`  PATCH shops -> ${p.status}   DELETE ledger -> ${d.status}`);
  const now = await shop();
  console.log(`  final: plan=${now.subscription_plan} expires=${now.subscription_expires_at}`);
  if (now.subscription_plan === BASE.subscription_plan && now.subscription_expires_at === BASE.subscription_expires_at) ok('shop restored to baseline');
  else bad('SHOP NOT RESTORED — fix manually');
}
console.log(process.exitCode ? '\nRESULT: FAILURES PRESENT' : '\nRESULT: ACTIVATION PATH VERIFIED');
