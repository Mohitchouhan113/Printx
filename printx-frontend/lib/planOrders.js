/**
 * Plan intents — the server's own signed record of what a Razorpay order was
 * created FOR.
 *
 * WHY THIS EXISTS (security):
 *   The original flow trusted the CLIENT for `planId` at verification time,
 *   which let anyone upgrade to any plan with a forged or garbage signature.
 *   Now the plan, billing cycle, shop and amount are fixed SERVER-SIDE at
 *   order-creation time, sealed into a signed token. The verify route resolves
 *   the plan from that token and never from the request body. A client can ask
 *   to buy a plan, but it can never decide which plan it ends up on — forging
 *   a token requires the server secret.
 *
 * WHY IT IS A SIGNED TOKEN AND NOT A DATABASE/MEMORY LOOKUP:
 *   An earlier version kept intents in an in-memory Map. That does not work on
 *   serverless: /api/billing/create-plan-order and /api/billing/verify-payment
 *   are separate functions with separate module instances and cold starts, so
 *   the intent was never found and EVERY real upgrade failed with
 *   "This payment session is no longer valid". A signed token is stateless, so
 *   it validates identically in any process, on any instance, with no shared
 *   store to keep warm.
 *
 *   Expiry is carried inside the payload and is covered by the signature, so
 *   it cannot be extended by the client.
 */

import crypto from 'crypto';

const INTENT_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours — Razorpay checkout sessions are short

function secret() {
  return process.env.PLAN_INTENT_SECRET || process.env.RAZORPAY_KEY_SECRET || '';
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');

/**
 * Mint a signed intent token.
 * @returns {{ intentId: string, expiresAt: number }}
 */
export function createPlanIntent({ shopId, shopName, planId, billingCycle, amountPaise }) {
  const key = secret();
  if (!key) throw new Error('No signing secret configured for plan intents');

  const expiresAt = Date.now() + INTENT_TTL_MS;
  const payload = {
    s: String(shopId || ''),
    n: shopName || null,
    p: String(planId || ''),
    c: String(billingCycle || 'monthly'),
    a: Number(amountPaise || 0),
    x: expiresAt,
    r: crypto.randomBytes(8).toString('hex'),
  };

  const body = b64u(JSON.stringify(payload));
  const sig = b64u(crypto.createHmac('sha256', key).update(body).digest());
  return { intentId: `${body}.${sig}`, expiresAt };
}

/**
 * Verify + decode an intent token.
 * @returns {{ shopId, shopName, planId, billingCycle, amountPaise, expiresAt }|null}
 *          null when malformed, wrongly signed, or expired.
 */
export function readPlanIntent(intentId) {
  const key = secret();
  const raw = String(intentId || '');
  if (!key || !raw) return null;

  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);

  const expected = b64u(crypto.createHmac('sha256', key).update(body).digest());

  // Constant-time compare over equal-length buffers; unequal lengths short-circuit.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!payload || typeof payload !== 'object') return null;
  if (!payload.s || !payload.p) return null;
  if (!Number.isFinite(payload.x) || payload.x < Date.now()) return null; // expired

  return {
    shopId: payload.s,
    shopName: payload.n || null,
    planId: payload.p,
    billingCycle: payload.c || 'monthly',
    amountPaise: Number(payload.a || 0),
    expiresAt: payload.x,
  };
}
