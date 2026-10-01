# PrintX Offline Spooler — Desktop Print Agent

Silent, unattended PDF printing for a shop's Windows PC. The agent watches
Supabase `orders` in realtime, downloads each printable order's file, spools
it straight to the Windows Print Spooler (no dialogs), flips the order to
`printed`, and pings a heartbeat so the Vendor Dashboard can show
**Printer Status: 🟢 Online**.

## 1. Prerequisites

- Windows 10/11 shop PC with Node.js ≥ 18
- A printer set as the Windows default (or named via `PRINTER`)
- The shop's `SHOP_ID` (UUID from `shops.id`)
- Supabase project URL + service-role key (anon key also works if RLS allows)

## 2. Install

```bat
cd agent
copy .env.example .env
npm install
```

Edit `.env`:

```ini
SHOP_ID=036fd916-a25f-41bd-91bb-d95ced5da574   ← your shop UUID
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_KEY=YOUR_SERVICE_ROLE_KEY
# PRINTER=HP LaserJet Pro M404                   ← optional; default = OS default
```

## 3. One-time database migration (heartbeat)

The heartbeat writes `shops.last_active_at`, which does not exist until the
migration is run **once** in the Supabase SQL Editor:

```
printx-frontend/supabase/migrations/20260928_agent_heartbeat.sql
```

Until then the agent degrades gracefully: it logs the hint below once,
pauses heartbeat writes, and re-probes every 5 minutes (resumes by itself
once the column exists) — everything else keeps printing normally.

```
WARN shops.last_active_at column missing — heartbeat paused.
  → run supabase/migrations/20260928_agent_heartbeat.sql (re-probes every 5 min).
```

Dashboard rule: treat an order shop as 🟢 Online when
`now() - shops.last_active_at < 90s` (agent pings every 30s).

## 4. Run

```bat
npm start              ← daemon (realtime + catch-up poll + heartbeat)
npm run once           ← single catch-up cycle, then exit
npm run dry            ← log instead of spooling (no paper used)
node print_agent.js --help
```

Expected startup log:

```
[print-agent] PrintX print agent starting { shop: '…', printer: 'OS default', … }
[print-agent] default printer: HP LaserJet Pro M404
[print-agent] 🔴 realtime subscribed — watching orders (INSERT+UPDATE) for this shop
[print-agent] 🌐 network ONLINE (catch-up) — flushing pending syncs
```

Per-order log sequence:

```
📥 realtime:insert order 6d06e59e status='PENDING' file=doc.pdf → queued
💾 downloaded 13264 bytes → temp/order_<id>.pdf (doc.pdf) [attempt 1/3]
🖨️  printed order 6d06e59e — setting status='printed'
```

## 5. How it behaves

| Situation | Behaviour |
|---|---|
| New/updated order (`payment_status='PAID'` **or** `status='pending'`, case-insensitive) | 🔔 beep → download → silent spool → `orders.status='printed'` → temp file deleted |
| Order already `printed`/`failed`/`printing`/`ready`/`completed`/`cancelled` | Ignored — never reprints (also covers vendor status flips) |
| Network down (download/print) | Deferred, **never** marked failed; catch-up poll retries when back online |
| Hard error (404 file, no `file_url`, spooler refusing) | Retries `MAX_ATTEMPTS` times with backoff → `orders.status='failed'` |
| Realtime socket drops | supabase-js auto-reconnects; catch-up poll (10s) covers the gap |
| Print succeeded but status write failed offline | Queued and flushed on every tick — the order is never printed twice |
| Restart after crash / orders missed while off | Catch-up poll re-scans `LOOKBACK_HOURS` (default 24h) of shop orders |

## 6. Configuration reference

| Variable | Default | Purpose |
|---|---|---|
| `SHOP_ID` | — (required) | Shop UUID to follow |
| `SUPABASE_URL` | — (required) | Project URL |
| `SUPABASE_SERVICE_KEY` | — (required) | Service-role key (anon accepted as fallback) |
| `PRINTER` | OS default | Windows printer name |
| `POLL_INTERVAL_MS` | `10000` | Offline catch-up poll interval |
| `HEARTBEAT_MS` | `30000` | `last_active_at` ping interval |
| `LOOKBACK_HOURS` | `24` | Catch-up window for orders missed while offline |
| `MAX_ATTEMPTS` | `3` | Hard-failure retries before `status='failed'` |
| `ALERT` | `1` | Audio alert (`0` = silent) |
| `DRY_RUN` | `0` | `1` = log instead of spooling |
| `BUCKET` | `print-uploads` | Storage bucket for relative `file_url`s |

## 7. Run at Windows startup (optional)

```bat
shell:startup
```

Drop a shortcut whose target is:

```
cmd /c "cd /d C:\path\to\PrintX\agent && npm start >> agent.log 2>&1"
```

(Or register a scheduled task set to "At log on".)

## 8. Troubleshooting

- **No orders arrive** → check the `🔴 realtime subscribed` line; confirm
  `SHOP_ID` matches `shops.id`; `npm run once` to force a catch-up scan.
- **Beep but no print** → run `npm run dry` and read the log; verify the
  default printer in Windows Settings → Printers & scanners.
- **`status` stuck at `pending`** → the agent never saw it as printable or
  downloads keep failing offline; check the log for `deferred` / `404`.
- **Heartbeat warning** → run the migration in §3 (everything else works
  without it).
- **Writes rejected by RLS** → switch `SUPABASE_SERVICE_KEY` to the
  service-role key.
