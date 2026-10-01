/**
 * Pricing engine — volume tiers + coupon discounts for PrintX.
 *
 * Volume tiers shape (shops.volume_rates JSONB):
 *   [{ minPages: 50, bwRate: 1.5, colorRate: 8 }, { minPages: 100, bwRate: 1.2, colorRate: 6 }]
 *
 * Coupons shape (coupons table row):
 *   { code: 'EXAM10', discount_type: 'percentage'|'flat', discount_value: 10, active: true }
 */

/* ------------------------------------------------------------------ */
/* Volume tier resolution                                              */
/* ------------------------------------------------------------------ */

/**
 * Find the best matching volume tier for a total page count.
 * Tiers are matched by highest minPages <= totalPages.
 *
 * @param {number} totalPages — total pages across all files (before copies)
 * @param {Array<{minPages:number, bwRate:number, colorRate:number}>} volumeRates
 * @param {{bw:number, color:number}} baseRates — shop's base per-page rates
 * @returns {{ tier: object|null, bwRate: number, colorRate: number, applied: boolean }}
 */
export function resolveVolumeTier(totalPages, volumeRates, baseRates) {
  const base = { bwRate: baseRates.bw, colorRate: baseRates.color, applied: false, tier: null };

  if (!Array.isArray(volumeRates) || volumeRates.length === 0 || !totalPages) {
    return { ...base, bwRate: baseRates.bw, colorRate: baseRates.color };
  }

  // Sort descending by minPages, first match wins
  const sorted = [...volumeRates].sort((a, b) => b.minPages - a.minPages);
  const tier = sorted.find((t) => totalPages >= t.minPages);

  if (!tier) {
    return { ...base, bwRate: baseRates.bw, colorRate: baseRates.color };
  }

  return {
    tier,
    bwRate: Number(tier.bwRate) || baseRates.bw,
    colorRate: Number(tier.colorRate) || baseRates.color,
    applied: true,
  };
}

/* ------------------------------------------------------------------ */
/* Coupon calculation                                                  */
/* ------------------------------------------------------------------ */

/**
 * Compute the discount amount a coupon applies to a subtotal.
 *
 * @param {{discount_type:string, discount_value:number}} coupon
 * @param {number} subtotal
 * @returns {{ discount: number, label: string }}
 */
export function calcCouponDiscount(coupon, subtotal) {
  if (!coupon || !subtotal) return { discount: 0, label: '' };

  if (coupon.discount_type === 'percentage') {
    const pct = Number(coupon.discount_value) || 0;
    const discount = Math.round(subtotal * (pct / 100) * 100) / 100;
    return { discount, label: `${coupon.code} (${pct}% off)` };
  }

  // flat
  const flat = Number(coupon.discount_value) || 0;
  const discount = Math.min(flat, subtotal); // never negative
  return { discount, label: `${coupon.code} (₹${flat} off)` };
}

/* ------------------------------------------------------------------ */
/* Full bill computation                                               */
/* ------------------------------------------------------------------ */

/**
 * Compute the complete bill: base → volume discount → coupon → final.
 *
 * @param {Object} params
 * @param {number} params.totalPages       — sum of file page counts (pre-copies)
 * @param {number} params.totalBwPages     — B&W pages after copies
 * @param {number} params.totalColorPages  — Color pages after copies
 * @param {number} params.copies           — global copies multiplier (already applied if per-file)
 * @param {{bw:number, color:number}} params.baseRates
 * @param {Array} params.volumeRates       — shops.volume_rates
 * @param {Object|null} params.coupon      — active coupon row
 * @returns {{
 *   basePrice, volumeDiscount, volumeTierApplied, bwRate, colorRate,
 *   couponDiscount, couponLabel, finalPrice
 * }}
 */
export function computeBill({
  totalPages,
  totalBwPages,
  totalColorPages,
  baseRates = { bw: 2, color: 10 },
  volumeRates = [],
  pricingTiers = null, // bounded ₹/page ranges from shops.pricing_tiers
  coupon = null,
}) {
  // 1. Resolve tier from raw page count (pre-copies is standard for tiers)
  let { tier, bwRate, colorRate, applied } = resolveVolumeTier(totalPages, volumeRates, baseRates);

  // 1b. Shop pricing_tiers (e.g. 1-20 → ₹2, 21-50 → ₹1.8, 51+ → ₹1.5) are
  // bounded ranges and WIN over the floor-style volume tiers when they match.
  const ptier = findPricingTier(totalPages, pricingTiers);
  if (ptier) {
    bwRate = ptier.price;
    colorRate = Number.isFinite(Number(ptier.colorRate)) ? Number(ptier.colorRate) : baseRates.color;
    applied = true;
    tier = { minPages: ptier.min, maxPages: ptier.max ?? null, bwRate, colorRate, source: 'pricing_tiers' };
  }

  // 2. Base price at tier rates
  const basePrice = totalBwPages * bwRate + totalColorPages * colorRate;

  // 3. Volume discount = what it would have cost at base rates − tier price
  const baseAtOriginal = totalBwPages * baseRates.bw + totalColorPages * baseRates.color;
  const volumeDiscount = applied ? Math.round((baseAtOriginal - basePrice) * 100) / 100 : 0;

  // 4. Coupon applies to post-volume subtotal
  const { discount: couponDiscount, label: couponLabel } = calcCouponDiscount(coupon, basePrice);

  // 5. Final
  const finalPrice = Math.max(0, Math.round((basePrice - couponDiscount) * 100) / 100);

  return {
    basePrice: Math.round(baseAtOriginal * 100) / 100,
    volumeDiscount,
    volumeTierApplied: applied,
    volumeTier: tier,
    bwRate,
    colorRate,
    couponDiscount: Math.round(couponDiscount * 100) / 100,
    couponLabel,
    finalPrice,
  };
}

/* ------------------------------------------------------------------ */
/* Binding & finishing options (shared: customer page + vendor queue)  */
/* ------------------------------------------------------------------ */

export const BINDING_OPTIONS = [
  { id: 'none', label: 'No Binding', desc: 'Loose pages', cost: 0, icon: '📄', badge: null },
  { id: 'staple', label: 'Corner Staple', desc: 'Quick top-left staple', cost: 2, icon: '📌', badge: '📌 Corner Staple' },
  { id: 'spiral', label: 'Spiral Binding', desc: 'Coil-bound report', cost: 30, icon: '🌀', badge: '🌀 Spiral Binding Required' },
  { id: 'softcover', label: 'Soft Cover Book', desc: 'Printed cover pages', cost: 60, icon: '📗', badge: '📗 Soft Cover Book Binding' },
  { id: 'hardcover', label: 'Hardcover Thesis', desc: 'Rigid board cover', cost: 150, icon: '📘', badge: '📘 Hardcover Thesis' },
];

/** Resolve a binding option by id — unknown ids fall back to 'none'. */
export function getBinding(id) {
  return BINDING_OPTIONS.find((b) => b.id === id) || BINDING_OPTIONS[0];
}

/**
 * Overlay the vendor's per-binding rates from the shops row onto the
 * shared catalog (staple_rate / spiral_rate / softcover_rate /
 * hardcover_rate). Missing values fall back to the spec defaults.
 */
export function getShopBindingOptions(shop) {
  const rateFor = (id, fallback) => {
    const raw = shop?.[`${id}_rate`];
    const n = Number(raw);
    return Number.isFinite(n) && raw !== null && raw !== '' ? n : fallback;
  };
  const costs = {
    none: 0,
    staple: rateFor('staple', 2),
    spiral: rateFor('spiral', 30),
    softcover: rateFor('softcover', 60),
    hardcover: rateFor('hardcover', 150),
  };
  return BINDING_OPTIONS.map((b) => ({ ...b, cost: costs[b.id] ?? b.cost }));
}

/* ------------------------------------------------------------------ */
/* Paper sizes (shared: settings ⇄ customer page ⇄ vendor queue)       */
/* ------------------------------------------------------------------ */

/** Default catalog — mirrors shops.supported_paper_sizes JSONB shape. */
export const DEFAULT_PAPER_SIZES = [
  { id: 'A4', name: 'A4 Standard (210x297mm)', bw_rate: 2, color_rate: 10, enabled: true },
  { id: 'A3', name: 'A3 Poster Size (297x420mm)', bw_rate: 5, color_rate: 25, enabled: false },
  { id: 'Legal', name: 'Legal / Govt Stamp Size', bw_rate: 3, color_rate: 12, enabled: false },
  { id: 'Glossy', name: '180 GSM Glossy Photo Paper', bw_rate: 15, color_rate: 30, enabled: false },
];

/**
 * Normalize shops.supported_paper_sizes into a usable array — tolerates
 * null, JSON strings, and partially-shaped entries so a bad row never
 * crashes the customer page.
 */
export function resolvePaperSizes(raw) {
  let list = raw;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { list = null; }
  }
  if (!Array.isArray(list) || list.length === 0) return DEFAULT_PAPER_SIZES;
  return list
    .filter((p) => p && (p.id || p.name))
    .map((p, i) => ({
      id: String(p.id || p.name || `paper-${i}`),
      name: String(p.name || p.id || 'Paper'),
      bw_rate: Number.isFinite(Number(p.bw_rate)) ? Number(p.bw_rate) : 2,
      color_rate: Number.isFinite(Number(p.color_rate)) ? Number(p.color_rate) : 10,
      enabled: p.enabled !== false,
    }));
}

/** Short tray label + emoji for queue badges — matches spec examples. */
const PAPER_META = {
  a4: { icon: '📄', label: 'A4' },
  a3: { icon: '📜', label: 'A3 Poster' },
  legal: { icon: '📄', label: 'Legal' },
  glossy: { icon: '🖼️', label: 'Glossy Photo' },
};

export function getPaperMeta(id) {
  if (!id) return null;
  return PAPER_META[String(id).toLowerCase()] || { icon: '📄', label: String(id) };
}

/* ------------------------------------------------------------------ */
/* Demo coupons (used when Supabase is not configured)                 */
/* ------------------------------------------------------------------ */
export const DEMO_COUPONS = {
  EXAM10: { code: 'EXAM10', discount_type: 'percentage', discount_value: 10, active: true },
  FIRST50: { code: 'FIRST50', discount_type: 'flat', discount_value: 50, active: true },
  WELCOME20: { code: 'WELCOME20', discount_type: 'percentage', discount_value: 20, active: true },
};

/** Default volume tiers shown in settings / used in demo mode */
export const DEFAULT_VOLUME_RATES = [
  { minPages: 50, bwRate: 1.5, colorRate: 8 },
  { minPages: 100, bwRate: 1.2, colorRate: 6 },
];

/* ------------------------------------------------------------------ */
/* Tiered bulk discounts (shops.pricing_tiers — bounded ₹/page ranges) */
/* ------------------------------------------------------------------ */

/**
 * Normalize shops.pricing_tiers into sorted, validated ranges.
 * Accepts arrays or JSON strings and both {min,max,price} and
 * {from,to,rate}/{minPages,bwRate} shapes; junk rows are dropped so a bad
 * column value can never break checkout.
 *
 *   [{"min":1,"max":20,"price":2},{"min":21,"max":50,"price":1.8},
 *    {"min":51,"max":null,"price":1.5}]
 */
export function normalizePricingTiers(raw) {
  if (!raw) return [];
  let list = raw;
  if (typeof raw === 'string') {
    try { list = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(list)) return [];
  return list
    .map((t) => {
      if (!t || typeof t !== 'object') return null;
      const min = Number(t.min ?? t.from ?? t.minPages);
      const maxRaw = t.max ?? t.to ?? t.maxPages ?? null;
      const max = maxRaw == null || maxRaw === '' ? null : Number(maxRaw);
      const price = Number(t.price ?? t.rate ?? t.bwRate);
      if (!Number.isFinite(min) || min < 1 || !Number.isFinite(price) || price <= 0) return null;
      if (max != null && (!Number.isFinite(max) || max < min)) return null;
      const colorRate = Number(t.colorRate);
      return { min, max, price, ...(Number.isFinite(colorRate) && colorRate > 0 ? { colorRate } : {}) };
    })
    .filter(Boolean)
    .sort((a, b) => a.min - b.min);
}

/** Pick the tier matching `totalPages` (max === null means “open-ended”). */
export function findPricingTier(totalPages, tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) return null;
  const pages = Number(totalPages) || 0;
  return tiers.find((t) => pages >= t.min && (t.max == null || pages <= t.max)) || null;
}
