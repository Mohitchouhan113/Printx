# Dynamic Plans — Verification Record

## Build command
```
npm run build   # inside printx-frontend/
```

## Result
**Exit code 0 — build succeeded.**

Compiled pages confirmed in output:
- `/vendor/dashboard/billing` ✅
- `/vendor/dashboard/analytics` ✅
- `/vendor/dashboard/printers` ✅
- `/api/upload` (dynamic, ƒ) ✅
- `/api/jobs/manual-entry` (dynamic, ƒ) ✅

The two pre-existing `DYNAMIC_SERVER_USAGE` log entries (`/api/jobs/queue-status` and `/api/generate-qr`) are unrelated to this change set and were present before implementation.

---

## Changes implemented

### A. SQL Migration
`printx-frontend/supabase/migrations/20250115120000_plans_quota_columns.sql`
- `ALTER TABLE plans ADD COLUMN IF NOT EXISTS` for: `max_printers`, `max_orders_monthly`, `has_whatsapp_bot`, `has_analytics`, `has_custom_poster`
- Upserts all 5 plan rows with quota values matching `lib/plans.js` exactly (prices: free=0, basic=349, pro=1299, advance=2499, lifetime=1999)
- Safe to re-run

### B. `lib/getShopActivePlan.js` (new file)
- Server-side helper for API routes
- Reads `shops.subscription_plan`, `subscription_expires_at`, `is_lifetime`
- Falls back to `'free'` if subscription is expired
- Reads quota columns from `plans` table keyed by `code`
- Progressive-drop: null quota columns → `-1` for integers (fail-open/unlimited), `true` for booleans (fail-open/enabled)
- Static `PLANS` fallback when DB is unreachable
- Exports `FREE_PLAN_DEFAULTS` constant

### C. `lib/plans.js` — quota fields added
Added to every plan object: `max_printers`, `max_orders_monthly`, `has_analytics`, `has_whatsapp_bot`, `has_custom_poster` matching the migration seed values exactly.

### D. `app/api/upload/route.js` — order quota enforcement
- Imports `getShopActivePlan` and `PLANS`
- After subscription check: counts this month's `print_jobs` for the shop
- Returns HTTP 403 with `planLimitReached: true` if `count >= max_orders_monthly` (unless -1)
- Wrapped in try/catch — fail-open on any DB error

### E. `app/api/jobs/manual-entry/route.js` — order quota enforcement
- Same guard as upload route, applied after shop is resolved
- Fail-open on quota-check errors

### F. `app/vendor/dashboard/printers/page.jsx` — printer limit UI guard
- Imports `fetchPlans`, `planIsActive`, `PLANS`, `Lock` icon
- Fetches active plan limits on mount; falls back to static `PLANS` if DB unavailable
- "Add New Printer" button: disabled with `Lock` icon when `printerLimitReached`
- `openAdd()` shows a toast and returns early when limit is reached
- Shows plan name + upgrade link in the header when limit is reached

### G. `app/vendor/dashboard/analytics/page.jsx` — has_analytics gating
- Imports `fetchPlans`, `planIsActive`, `PLANS`, `Lock` icon
- Derives `hasAnalytics` from the shop's active plan (DB → static fallback → fail-open true)
- When `hasAnalytics === false`: renders upgrade prompt with blurred skeleton cards behind it
- Upgrade prompt links to `/vendor/dashboard/billing`

### H. `components/layout/VendorShell.jsx` — sidebar feature flag gating
- Imports `PLANS` and `Lock` icon
- Adds `featureFlag: 'has_analytics'` to analytics nav item
- Derives `planFeatureFlags` from static `PLANS` (synchronous, no DB round-trip)
- Locked nav items: dimmed style + Lock icon overlay; clicking redirects to billing with `?upgrade=` param
- Does not remove locked items from DOM — layout stays stable

### I. `components/billing/BillingContent.jsx` — dynamic yearly price
- Plan cards now compute `dp = getPlanPrice(planId)` once at the map level
- `billed` string uses DB `original_price` when available instead of hardcoded `plan.yearly`
- Removed redundant inner `const dp = getPlanPrice(planId)` calls in badge, price, and features JSX blocks

### J. `lib/subscriptionService.js` — auditability comment
- Added `@since` and explanatory comment on `computeExpiryFromBase` confirming the extension logic is intentional

---

## Constraints honoured
- All new files use `.js` (no `.ts`)
- `plans` table PK is `code` (not `id`) — all lookups use `.eq('code', planId)`
- Static `PLANS` catalog kept as fallback; not deleted
- `subscriptionService.js` extension logic untouched
- Payment routes (`/api/razorpay/verify`, `/api/razorpay/webhook`) unchanged
- Progressive-column-drop: null quota → `-1` (integer), `true` (boolean) everywhere
