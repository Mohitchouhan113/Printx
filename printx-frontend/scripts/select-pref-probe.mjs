// Replays every `selectStrict` PREFERRED column list in the app against the
// live schema and reports which ones 400 (each 400 is a console error the
// vendor/customer actually sees on first paint).
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

async function test(table, cols) {
  const r = await fetch(`${SB}/rest/v1/${table}?select=${encodeURIComponent(cols)}&limit=1`, {
    headers: H,
  });
  if (r.status === 200) return { ok: true };
  let body = await r.text();
  try {
    body = JSON.parse(body);
  } catch {
    /* keep text */
  }
  return { ok: false, status: r.status, msg: String(body?.message || body).slice(0, 160) };
}

const CASES = [
  [
    'print_jobs:queue (PREF)',
    'print_jobs',
    'id, shop_id, token_number, customer_name, customer_phone, file_name, file_url, pages, page_count, copies, color_option, config, binding_type, binding_cost, paper_size, token_no, is_deleted_from_storage, print_type, files_metadata, auto_printed, status, created_at',
  ],
  [
    'print_jobs:queue (SAFE)',
    'print_jobs',
    'id, shop_id, token_number, customer_name, customer_phone, file_name, file_url, pages, copies, color_option, status, created_at',
  ],
  [
    'print_jobs:analytics (PREF)',
    'print_jobs',
    'id, shop_id, token_number, customer_name, customer_phone, file_name, file_url, pages, page_count, copies, color_option, color_mode, mode, color, config, status, created_at, completed_at, updated_at, total_price, final_price',
  ],
  [
    'shops:by-owner (PREF)',
    'shops',
    'id, owner_id, name, slug, phone, upi_id, status, is_active, is_approved, is_open, is_accepting_orders, subscription_plan, subscription_expires_at, plan_status, payment_status, bw_rate, color_rate, double_sided_rate, rate_bw, rate_color, rate_double, supported_paper_sizes, enable_binding, staple_rate, spiral_rate, softcover_rate, hardcover_rate, whatsapp_notifications_enabled, a4_paper_stock, low_stock_threshold, open_time, close_time, is_verified, created_at',
  ],
  [
    'plans:all (PREF)',
    'plans',
    'id, code, name, original_price, offer_price, billing_cycle, badge_tag, features, is_active, created_at',
  ],
  [
    'shops:settings (PREF)',
    'shops',
    'name, slug, phone, upi_id, bw_rate, color_rate, double_sided_rate, rate_bw, rate_color, rate_double, whatsapp_notifications_enabled, supported_paper_sizes, staple_rate, spiral_rate, softcover_rate, hardcover_rate, enable_binding',
  ],
  [
    'orders:reprint',
    'orders',
    'id, bw_pages, color_pages, paper_size, binding_type, binding_cost, total_amount, pages',
  ],
  [
    'print_jobs:reprint',
    'print_jobs',
    'id, file_name, file_url, created_at, pages, copies',
  ],
];

let bad = 0;
for (const [name, table, cols] of CASES) {
  const res = await test(table, cols);
  if (res.ok) console.log(`OK    ${name}`);
  else {
    bad += 1;
    console.log(`HTTP ${res.status}  ${name}\n        ${res.msg}`);
  }
}
console.log(`\n${bad} of ${CASES.length} preferred lists 400.`);
process.exit(0);
