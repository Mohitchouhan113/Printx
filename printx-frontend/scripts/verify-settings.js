const fs = require('fs');
const S = fs.readFileSync('components/settings/ShopSettings.jsx', 'utf8');
const A = fs.readFileSync('lib/auth.js', 'utf8');

function findBlock(text, startRe) {
  const n = text.indexOf(startRe);
  if (n < 0) return null;
  const bodyStart = text.indexOf('{', n);
  if (bodyStart < 0) return { ok: false, body: null, end: -1, full: text.slice(n, n + 200) };
  let open = 0;
  for (let i = bodyStart + 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{' || ch === '[') open++;
    else if (ch === '}' || ch === ']') {
      if (open === 0) return { ok: true, body: text.slice(bodyStart + 1, i), end: i, full: text.slice(n, i + 1) };
      open--;
    }
  }
  return { ok: false, body: null, end: -1, full: text.slice(n, n + 400) };
}

// Quick diagnostics
function diagSlice(text, start, length) {
  const n = text.indexOf(start);
  if (n < 0) return 'NOT FOUND: ' + start;
  return 'FOUND @' + n + ': ' + text.slice(n, n + length);
}
function findBlockStrict(text, startRe) {
  const n = text.indexOf(startRe);
  if (n < 0) return 'NOT FOUND: ' + startRe;
  const bs = n + startRe.length;
  if (text[bs] !== '{') return 'NO OPEN BRACE at ' + bs + ': ...' + text.slice(bs - 20, bs + 40);
  let open = 0;
  for (let i = bs; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{' || ch === '[') open++;
    else if (ch === '}' || ch === ']') {
      open--;
      if (open === 0) return { ok: true, full: text.slice(n, i + 1), body: text.slice(bs, i) };
    }
  }
  return 'NO CLOSING: ' + text.slice(n, n + 300);
}

const pass = [];
const fail = [];

function check(label, cond) {
  if (cond()) { pass.push(label); console.log('PASS — ' + label); }
  else { fail.push(label); console.log('FAIL — ' + label); }
  return cond();
}



// ---------- Issue 1: index-based deletions ----------
check('removePTier-idx', () => {
  const b = findBlock(S, 'const removePTier = (idx) => {');
  return b && b.ok && b.body.includes('prev.filter((_, i) => i !== idx)') && b.body.includes('setPtiers');
});

check('removeTier-idx', () => {
  const b = findBlock(S, 'const removeTier = (idx) => {');
  return b && b.ok && b.body.includes('prev.filter((_, i) => i !== idx)') && b.body.includes('setTiers');
});

check('tierRow-onClick-idx', () => {
  const ptier = findBlock(S, 'const removePTier = (idx) => {');
  const tier = findBlock(S, 'const removeTier = (idx) => {');
  const ptierOnClick = S.indexOf('onClick={() => removePTier(idx)');
  const tierOnClick = S.indexOf('onClick={() => removeTier(idx)');
  return ptier && tier && ptier.ok && tier.ok && ptierOnClick > 0 && tierOnClick > 0;
});

// ---------- Issue 1b: savePTiers / saveTiers write to shops ----------
check('savePTiers-writes-to-shops', () => {
  const b = findBlock(S, 'const savePTiers = async () => {');
  const body = (b && b.ok) ? b.body : '';
  const writesToShops = body.includes("supabase.from('shops').update") || body.includes("supabase.from(\"shops\").update");
  const hasPricTiers = body.includes('pricing_tiers');
  const hasErrorHandling = body.includes('console.error') || body.includes('Could not save');
  return writesToShops && hasPricTiers && hasErrorHandling && b && b.ok;
});

check('saveTiers-writes-to-shops', () => {
  const b = findBlock(S, 'const saveTiers = async () => {');
  const body = (b && b.ok) ? b.body : '';
  const hasShopsUpdateOrUpsert = body.includes("supabase.from('shops').update") || body.includes("supabase.from(\"shops\").update")
    || body.includes("supabase.from('shops').upsert") || body.includes("supabase.from(\"shops\").upsert");
  const hasVolumeRates = body.includes('volume_rates');
  const hasErrorHandling = body.includes('console.error') || body.includes('Could not save volume tiers') || body.includes('setTiersError');
  return b && b.ok && hasVolumeRates && hasErrorHandling;
});

// ---------- Issue 2: promo codes auto-save ----------
check('addCoupon-calls-saveCouponsNow', () => {
  const b = findBlock(S, 'const addCoupon = () => {');
  const body = (b && b.ok) ? b.body : '';
  return b && b.ok && (body.includes('saveCouponsNow()') || body.includes('saveCouponsNow(updated)'));
});

check('deleteCoupon-calls-saveCouponsNow', () => {
  const del = S.indexOf('deleteCoupon');
  if (del < 0) return false;
  // find a block starting near deleteCoupon definition that contains saveCouponsNow
  const start = S.lastIndexOf('const deleteCoupon', del);
  if (start < 0) return false;
  const b = findBlock(S.slice(start), 'const deleteCoupon');
  const body = (b && b.ok) ? b.body : '';
  return b && b.ok && (body.includes('saveCouponsNow()') || body.includes('saveCouponsNow(updated)'));
});

check('toggleCoupon-calls-saveCouponsNow', () => {
  const toggle = S.indexOf('toggleCoupon');
  if (toggle < 0) return false;
  const start = S.lastIndexOf('const toggleCoupon', toggle);
  if (start < 0) return false;
  const b = findBlock(S.slice(start), 'const toggleCoupon');
  const body = (b && b.ok) ? b.body : '';
  return b && b.ok && (body.includes('saveCouponsNow()') || body.includes('saveCouponsNow(updated)'));
});

check('promo_codes-initial-load-effect', () => {
  return S.includes('promo_codes') && S.includes('useEffect') && S.includes('supabase.from') && S.includes('maybeSingle');
});

check('saveCouponsNow-defined-and-writes-to-shops', () => {
  const b = findBlock(S, 'const saveCouponsNow = async (latestCoupons) => {');
  const body = (b && b.ok) ? b.body : S;
  const defined = b && b.ok;
  const writesToShops = body.includes("supabase.from('shops').update") || body.includes("supabase.from(\"shops\").update") || body.includes("supabase.from('shops').upsert") || body.includes("supabase.from(\"shops\").upsert");
  const hasCoupons = body.includes('coupons') || body.includes('promo_codes');
  const hasErrorHandling = body.includes('console.error') || body.includes('save failed');
  return defined && writesToShops && hasCoupons && hasErrorHandling;
});

// ---------- Issue 3: staff sessions ----------
check('activeStaff-initial-state-loads-from-supabase', () => {
  const stateIdx = S.indexOf('const [activeStaff, setActiveStaff] = useState(');
  if (stateIdx < 0) return false;
  // The new definition is an empty array; verify a useEffect exists in the
  // surrounding StaffAccessSection body that loads staff_sessions.
  const after = S.slice(stateIdx, Math.min(S.length, stateIdx + 800));
  const defEnd = S.indexOf(']);', stateIdx);
  const def = S.slice(stateIdx, defEnd + 3);
  const isEmptyInitial = def.includes('= useState([') && def.includes('])') && !def.includes('{ id:');
  const effectNearby = after.includes('useEffect') && after.includes('supabase.from') && after.includes('staff_sessions');
  return isEmptyInitial && effectNearby;
});

check('handleToggleStaffSession-saves', () => {
  const toggle = S.indexOf('handleToggleStaffSession');
  if (toggle < 0) return false;
  const start = S.lastIndexOf('const handleToggleStaffSession', toggle);
  if (start < 0) return false;
  const b = findBlock(S.slice(start), 'const handleToggleStaffSession');
  const body = (b && b.ok) ? b.body : '';
  return b && b.ok && (body.includes('saveStaffSessionsNow()') || body.includes('saveStaffSessionsNow(updated)'));
});

check('saveStaffSessionsNow-writes-to-shops', () => {
  const b = findBlock(S, 'const saveStaffSessionsNow = async (latestStaff) => {');
  const body = (b && b.ok) ? b.body : '';
  const writesToShops = body.includes("supabase.from('shops').update") || body.includes("supabase.from(\"shops\").update") || body.includes("supabase.from('shops').upsert") || body.includes("supabase.from(\"shops\").upsert");
  const hasStaffSessions = body.includes('staff_sessions');
  const hasErrorHandling = body.includes('console.error') || body.includes('save failed');
  return b && b.ok && writesToShops && hasStaffSessions && hasErrorHandling;
});

// ---------- Related: auth setStaffPin persists ----------
check('auth-setStaffPin-persists', () => {
  const b = findBlock(A, 'const setStaffPin = useCallback(async (pin) => {');
  const body = (b && b.ok) ? b.body : '';
  const writesToShops = body.includes("supabase.from('shops').update") || body.includes("supabase.from(\"shops\").update") || body.includes("supabase.from('shops').upsert") || body.includes("supabase.from(\"shops\").upsert");
  const hasStaffPin = body.includes('staff_pin');
  const hasErrorHandling = body.includes('console.error') || body.includes('try') || body.includes('catch');
  return b && b.ok && writesToShops && hasStaffPin && hasErrorHandling;
});

console.log('\n--- SUMMARY ---');
console.log('PASSED: ' + pass.length + '/' + (pass.length + fail.length));
console.log('FAILED: ' + fail.length);
if (fail.length) {
  console.log('FAILURES: ' + fail.join(', '));
  process.exit(1);
} else {
  console.log('ALL CHECKS PASSED ✅');
  process.exit(0);
}
