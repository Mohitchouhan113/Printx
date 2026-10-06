# Dynamic Plans — Iteration 3 Verification

## What was fixed (iteration 3, review findings)

### Finding 1: Printer quota bypass
**File:** `printx-frontend/app/vendor/dashboard/printers/page.jsx`

`handleSave` for new printers now calls `fetch('/api/printers/add', { method: 'POST', ... })` instead of writing directly via the Supabase browser client. The server-side route (`/api/printers/add`) enforces `max_printers` quota via `getShopActivePlan`, counts existing printers server-side, and returns 403 + `planLimitReached: true` when the limit is reached. The client surfaces the error (with count/max info) via `showToast`. The UI-level guard in `openAdd` is preserved as a fast-path UX check before the API call.

### Finding 2: `has_analytics` column missing from `fetchPlans` select
**File:** `printx-frontend/lib/plansStore.js`

`fetchPlans` now selects `has_analytics, has_whatsapp_bot, has_custom_poster, max_printers, max_orders_monthly` in the preferred column list. The fallback column list (used when the DB hasn't been migrated yet) still omits these so legacy schemas still return rows gracefully. PostgREST will now include these fields in the response when the migration has run, making the analytics page DB-path (`planRow.has_analytics !== undefined`) and the printers page DB-path (`planRow.max_printers`) actually work from the DB instead of always falling through to the static `lib/plans.js` fallback.

### Finding 3: Billing page plan cards driven by hardcoded PLAN_ORDER
**File:** `printx-frontend/components/billing/BillingContent.jsx`

The plan card grid is now driven by `dynamicPlans` (DB rows) when available. `PLAN_ORDER` is used only as a static fallback when the DB hasn't responded. The grid's column count adapts dynamically to the number of plans rendered. For plans in the DB that are not in the static `PLANS` catalog (i.e. admin-created custom plans), a generic card is rendered with the DB name, price, and features. For the standard five plans, the full rich card with icon, tagline, badge, and CTA is rendered as before.

## Build verification

**Command:** `npm run build` from `printx-frontend/`
**Result:** Exit code 0 — build succeeded

Key routes confirmed in build output:
- `/api/printers/add` ✓ (Dynamic, server-rendered)
- `/vendor/dashboard/printers` ✓ (Static, 12.6 kB)
- `/vendor/dashboard/billing` ✓ (Static, 4.3 kB)
- `/vendor/dashboard/analytics` ✓ (Static, 2.2 kB)
- `/api/jobs/manual-entry` ✓ (Dynamic)
- `/api/upload` ✓ (Dynamic)
- `/api/billing/verify-payment` ✓ (Dynamic)

**Pre-existing warnings** (not caused by this iteration):
- `DYNAMIC_SERVER_USAGE` in `/api/jobs/queue-status` and `/api/generate-qr` — these routes use `request.url` at the top level; pre-existing issue unrelated to this change.

## Commit

`fix: wire printer insert through server route, add quota columns to fetchPlans, drive billing cards from DB rows`
SHA: `adf05c9`

## Files changed

| File | Change |
|---|---|
| `lib/plansStore.js` | Added quota columns to `fetchPlans` preferred select string |
| `app/vendor/dashboard/printers/page.jsx` | Replaced direct Supabase `insert` with `fetch('/api/printers/add', ...)` |
| `components/billing/BillingContent.jsx` | Plan card grid now driven by DB row array; `PLAN_ORDER` is static fallback only |
