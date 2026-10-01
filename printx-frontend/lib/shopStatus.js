import { PLANS } from './plans';

/**
 * Shared shop subscription-status logic — single source of truth used by the
 * admin panel, the vendor dashboard expiry banner, the customer upload guard,
 * and the upload API enforcement.
 *
 * Status derivation:
 *   suspended  — shops.status === 'suspended' (manual admin action)
 *   expired    — subscription_expires_at is in the past (auto-deactivated)
 *   active     — everything else (includes Free/Lifetime with no expiry)
 */

export const SHOP_STATUSES = ['active', 'suspended'];

/** Plan ids treated as paid tiers (purple badges in the admin table). */
export const PAID_PLAN_IDS = ['basic', 'pro', 'advance', 'lifetime'];

/**
 * Is a shop's subscription past its expiry date?
 * Null/absent expiry (Free / Lifetime plans) never expires.
 */
export function isSubscriptionExpired(shop) {
  const raw = shop?.subscription_expires_at;
  if (!raw) return false;
  const t = new Date(raw).getTime();
  if (Number.isNaN(t)) return false;
  return t < Date.now();
}

/** Manual admin suspension flag (tolerates `is_active === false`). */
export function isManuallySuspended(shop) {
  if (shop?.status === 'suspended') return true;
  if (shop?.is_active === false) return true;
  return false;
}

/**
 * Canonical derived status for a shop row:
 *   'suspended' | 'expired' | 'active'
 */
export function deriveShopStatus(shop) {
  if (isManuallySuspended(shop)) return 'suspended';
  if (isSubscriptionExpired(shop)) return 'expired';
  return 'active';
}

/** Human label for a plan id (falls back to the raw id, Title Case). */
export function planLabel(planId) {
  return PLANS?.[planId]?.name ||
    (planId ? planId.charAt(0).toUpperCase() + planId.slice(1) : 'Free');
}

/**
 * Estimated monthly recurring revenue contribution of one shop (₹/mo):
 * monthly price, or yearly/12, or lifetime/12 (amortized). Free → 0.
 */
export function planMonthlyValue(planId) {
  const plan = PLANS?.[planId];
  if (!plan) return 0;
  if (typeof plan.monthly === 'number' && plan.monthly > 0) return plan.monthly;
  if (typeof plan.yearly === 'number' && plan.yearly > 0) return Math.round(plan.yearly / 12);
  if (typeof plan.lifetime === 'number' && plan.lifetime > 0) return Math.round(plan.lifetime / 12);
  return 0;
}

/** true when a shop may accept customer orders (used by upload API + UI guards). */
export function isShopOperational(shop) {
  return deriveShopStatus(shop) === 'active';
}
