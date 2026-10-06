// Probes the live print_jobs / orders schema and replays the exact SELECTs the
// vendor queue makes, so we can see which preferred column list triggers a 400.
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

async function get(path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: H });
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: r.status, body };
}

// Mirrors the fixed lists in hooks/useShopQueue.js — PREF must be 200 and
// both lists must carry config + files_metadata (the preview URL carriers).
const QUEUE_PREF_COLS =
  'id, shop_id, token_number, customer_name, customer_phone, file_name, file_url, pages, copies, color_option, config, binding_type, binding_cost, files_metadata, status, created_at';
const QUEUE_SAFE_COLS =
  'id, shop_id, token_number, customer_name, customer_phone, file_name, file_url, pages, copies, color_option, config, files_metadata, status, created_at';

// 1. Full row of print_jobs + orders → authoritative column lists.
for (const t of ['print_jobs', 'orders']) {
  const r = await get(`${t}?select=*&limit=1`);
  console.log(`\n== ${t} (HTTP ${r.status}) ==`);
  if (Array.isArray(r.body) && r.body[0]) {
    console.log(Object.keys(r.body[0]).sort().join(', '));
  } else {
    console.log(JSON.stringify(r.body).slice(0, 300));
  }
}

// 2. Replay the queue selects.
for (const [name, cols] of [['PREF', QUEUE_PREF_COLS], ['SAFE', QUEUE_SAFE_COLS]]) {
  const r = await get(
    `print_jobs?select=${encodeURIComponent(cols)}&order=created_at.desc&limit=50`
  );
  const msg = r.status === 200 ? `ok rows=${r.body.length}` : JSON.stringify(r.body).slice(0, 400);
  console.log(`\n[queue ${name}] HTTP ${r.status}: ${msg}`);
}

// 3. Which PREF columns are actually missing? Test one at a time.
const missing = [];
for (const col of QUEUE_PREF_COLS.split(',').map((c) => c.trim())) {
  const r = await get(`print_jobs?select=${encodeURIComponent(col)}&limit=1`);
  if (r.status !== 200) missing.push(col);
}
console.log(`\n[missing on print_jobs] ${missing.join(', ') || '(none)'}`);

// 4. Preview pipeline: newest row that still has a URL → HEAD it with an
//    Origin header (what the modal's preflight sends) and report status + CORS.
const r4 = await get('print_jobs?select=file_url,files_metadata&file_url=not.is.null&order=created_at.desc&limit=1');
const row = Array.isArray(r4.body) ? r4.body[0] : null;
const url = row?.file_url || row?.files_metadata?.[0]?.fileUrl || null;
if (url) {
  const h = await fetch(url, { method: 'HEAD', headers: { Origin: 'https://printx.app' } });
  console.log(`\n[preview HEAD] ${h.status} ${url}`);
  console.log(`[preview CORS] access-control-allow-origin: ${h.headers.get('access-control-allow-origin') ?? '(missing)'}`);
} else {
  console.log('\n[preview HEAD] no live URL found on print_jobs');
}
