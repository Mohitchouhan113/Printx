const fs = require('fs');
const babel = require('@babel/core');

const shopPath = 'components/settings/ShopSettings.jsx';
const pagePath = 'app/s/[slug]/page.jsx';
const S = fs.readFileSync(shopPath, 'utf8');
const P = fs.readFileSync(pagePath, 'utf8');

// Babel just parses — we don't rely on it for the presence checks.
function parseOk(src, label) {
  try {
    babel.parseSync(src, { sourceType: 'module', plugins: ['@babel/plugin-syntax-jsx'] });
    console.log('PARSE OK:', label);
    return true;
  } catch (e) {
    console.log('PARSE FAIL:', label, e.message);
    return false;
  }
}

let allOk = parseOk(S, shopPath) && parseOk(P, pagePath);

function check(label, cond) {
  const ok = !!cond;
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + label);
  if (!ok) allOk = false;
}

// ---------------------------------------------------------------------------
// ShopSettings: locate BulkPricingCouponsSection only, then assert against it.
// ---------------------------------------------------------------------------
const sectionStart = S.indexOf('function BulkPricingCouponsSection');
const nextTopDecl = S.indexOf('\nfunction ', sectionStart + 10);
const sectionBody = nextTopDecl > 0 ? S.slice(sectionStart, nextTopDecl) : S.slice(sectionStart);

check('BulkPricingCouponsSection declared', () => sectionStart >= 0);
if (sectionStart >= 0) {
  check('section loads promo_codes by shop_id on mount', () =>
    /\buseEffect\b/.test(sectionBody) &&
    /\bpromo_codes\b/.test(sectionBody) &&
    /\bsupabase\.from\s*\(/.test(sectionBody));
  check('create path uses .toUpperCase() before insert', () =>
    sectionBody.includes('.toUpperCase()') &&
    sectionBody.includes("supabase.from('promo_codes').insert"));
  check('toggle path reads currentStatus and updates is_active by id', () =>
    /\bcurrentStatus\b/.test(sectionBody) &&
    /\b!currentStatus\b/.test(sectionBody) &&
    sectionBody.includes("eq('id', codeId)") &&
    sectionBody.includes("is_active:"));
  check('delete path filters/deletes from promo_codes', () =>
    (sectionBody.includes('.filter(') || sectionBody.includes('.delete(')) &&
    /\bpromo_codes\b/.test(sectionBody));
}

// ---------------------------------------------------------------------------
// Checkout page: apply + isolation + insert payload.
// ---------------------------------------------------------------------------
function has(label, s) { return s.includes(label); }
function hasRe(label, s) { return new RegExp(label).test(s); }

check('checkout has appliedCoupon React state', () => has('appliedCoupon', P));
check('checkout payload includes applied_coupon + discount_amount', () =>
  has('applied_coupon', P) && has('discount_amount', P));
check('checkout invalid/inactive message exists', () =>
  has('"Invalid or expired promo code"', P) ||
  has("'Invalid or expired promo code'", P) ||
  has('`Invalid or expired promo code`', P));
check('checkout promo query filters shop_id + code + is_active true', () =>
  has('eq(\'shop_id\'', P) && has('eq(\'code\'', P) && has("eq('is_active', true)", P));
check('checkout has coupon-isolation reset point', () =>
  has('resetAppliedCoupon', P) || hasRe('appliedCoupon\\s*=\\s*null', P));
check('checkout applies promo by direct Supabase query (not only offline DEMO_COUPONS)', () =>
  has("supabase.from('promo_codes')", P) || has("supabase\\.from(\"promo_codes\")", P));

console.log('');
console.log('SUMMARY: ' + (allOk ? 'ALL PASS' : 'SOME FAILED'));
process.exit(allOk ? 0 : 1);
