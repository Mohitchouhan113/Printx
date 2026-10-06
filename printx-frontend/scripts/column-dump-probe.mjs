// Dumps authoritative column lists for the tables the app selects from, then
// reports which columns of each hand-written PREFERRED list are missing.
import fs from 'node:fs';

const env = Object.fromEntries(
  fs
    .readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SB || !KEY) {
  console.log('missing Supabase env');
  process.exit(2);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function colsOf(table) {
  const r = await fetch(`${SB}/rest/v1/${table}?select=*&limit=1`, { headers: H });
  const body = await r.json().catch(() => null);
  if (r.status !== 200 || !Array.isArray(body)) {
    return { error: `${r.status} ${JSON.stringify(body).slice(0, 200)}` };
  }
  if (!body[0]) return { cols: [], note: 'table empty (no authoritative row)' };
  return { cols: Object.keys(body[0]).sort() };
}

const TABLES = ['print_jobs', 'orders', 'shops', 'plans', 'wallet_transactions'];
const dump = {};
for (const t of TABLES) {
  const res = await colsOf(t);
  dump[t] = res;
  console.log(`\n== ${t} ==`);
  console.log(res.error ? res.error : `${res.cols.join(', ')}${res.note ? `   [${res.note}]` : ''}`);
}

const LISTS = [
  [
    'print_jobs:queue PREF',
    'print_jobs',
    'id, shop_id, token_number, customer_name, customer_phone, file_name, file_url, pages, page_count, copies, color_option, config, binding_type, binding_cost, paper_size, token_no, is_deleted_from_storage, print_type, files_metadata, auto_printed, status, created_at',
  ],
  [
    'print_jobs:analytics PREF',
    'print_jobs',
    'id, shop_id, token_number, customer_name, customer_phone, file_name, file_url, pages, page_count, copies, color_option, color_mode, mode, color, config, status, created_at, completed_at, updated_at, total_price, final_price',
  ],
  [
    'shops:by-owner PREF',
    'shops',
    'id, owner_id, name, slug, phone, upi_id, status, is_active, is_approved, is_open, is_accepting_orders, subscription_plan, subscription_expires_at, plan_status, payment_status, bw_rate, color_rate, double_sided_rate, rate_bw, rate_color, rate_double, supported_paper_sizes, enable_binding, staple_rate, spiral_rate, softcover_rate, hardcover_rate, whatsapp_notifications_enabled, a4_paper_stock, low_stock_threshold, open_time, close_time, is_verified, created_at',
  ],
  [
    'plans:all PREF',
    'plans',
    'id, code, name, original_price, offer_price, billing_cycle, badge_tag, features, is_active, created_at',
  ],
  [
    'shops:settings PREF',
    'shops',
    'name, slug, phone, upi_id, bw_rate, color_rate, double_sided_rate, rate_bw, rate_color, rate_double, whatsapp_notifications_enabled, supported_paper_sizes, staple_rate, spiral_rate, softcover_rate, hardcover_rate, enable_binding',
  ],
];

console.log('\n=== per-column availability ===');
for (const [name, table, list] of LISTS) {
  const known = new Set(dump[table]?.cols || []);
  if (!known.size) {
    console.log(`\n${name}: table empty — cannot verify`);
    continue;
  }
  const missing = list.split(',').map((c) => c.trim()).filter((c) => !known.has(c));
  console.log(`\n${name}: ${missing.length ? `MISSING → ${missing.join(', ')}` : 'all present'}`);
}
