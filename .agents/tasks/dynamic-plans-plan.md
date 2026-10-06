# Implementation Plan — Dynamic Plans + Subscription Upgrade Fix

## Codebase Findings Summary

### File types in lib/
All files in `printx-frontend/lib/` are `.js` (no `.ts`). New helpers must be `.js`.

### Existing tables (confirmed from SQL files + code)
| Table | Key columns used |
|---|---|
| `shops` | `id`, `subscription_plan` (TEXT, default 'free'), `subscription_expires_at` (TIMESTAMPTZ), `is_lifetime` (optional, progressive-drop), `status`, `is_active` |
| `subscriptions` | `shop_id`, `plan_id`, `billing_cycle`, `amount_rupees`, `payment_id`, `order_id`, `invoice_number`, `status`, `start_date`, `end_date` |
| `wallet_transactions` | `id`, `amount`, `type`, `description` (idempotency carrier), `shop_id` (optional), `reference_id` (optional), `status` (optional) — progressive-drop pattern already in place |
| `plans` | `code` (primary key), `name`, `original_price`, `offer_price`, `billing_cycle`, `badge_tag`, `features`, `is_active`, `created_at` — **no `id` column, no `active` column** |
| `print_jobs` | `shop_id`, `pages`, `copies`, `status`, `created_at` — uses progressive-drop for extended cols |
| `printers` | `shop_id`, `id` — no plan-gating exists yet |

### Static plan catalog (`lib/plans.js`) — actual values
```
free:     monthly=0,    yearly=0,     lifetime=null  features=[4 items]
basic:    monthly=349,  yearly=3499,  lifetime=null  features=[4 items]
pro:      monthly=1299, yearly=9999,  lifetime=null  features=[5 items]
advance:  monthly=2499, yearly=19999, lifetime=null  features=[5 items]
lifetime: monthly=null, yearly=null,  lifetime=1999  features=[4 items]
```

### Current state of the two user requests

**Request 1 (subscription upgrade bug):**
`subscriptionService.js` already has `computeExpiryFromBase()` which correctly extends from `current_expiry` when it is in the future. The core fix is already implemented. However:
- `is_lifetime` column may be absent — progressive-drop exists but the `shops` update sets `subscription_expires_at = null` for lifetime, not `2099-12-31`, which works but may need `is_lifetime = true` flag.
- The idempotency guard queries `wallet_transactions.description LIKE *paymentId*` — reliable but the `subscriptions` table also has a `payment_id` column that IS checked. Both guards exist.
- **No `subscription_history` / `billing_transactions` table** — the `subscriptions` table is the audit log. `start_date` and `end_date` columns are written with progressive-drop. This is already functional.

**Request 2 (dynamic plans):**
The `plans` table **exists** and is read by `plansStore.js`/`fetchPlans()`. The billing UI already fetches and renders dynamic plan data (prices, badges, features). What is MISSING:
1. The `plans` table lacks quota columns (`max_printers`, `max_orders_monthly`, `has_whatsapp_bot`, `has_analytics`, `has_custom_poster`) needed for feature gating.
2. No `getShopActivePlan(shopId)` server-side helper exists in `lib/`.
3. No quota enforcement in `/api/upload` or `/api/jobs/manual-entry` (order limit guard).
4. No printer-count enforcement in `/vendor/dashboard/printers/page.jsx`.
5. The analytics page and VendorShell sidebar have no `has_analytics` / `has_whatsapp_bot` UI gating.
6. The `plans` table seed data is incomplete — it has `code`, `name`, `original_price`, `offer_price`, `billing_cycle`, `badge_tag`, `features`, `is_active` but needs the new quota columns added via migration.

---

## Implementation Plan

- [ ] 1. **SQL migration: add quota columns to `plans` table and upsert seed rows**

  Create `printx-frontend/supabase/migrations/20261010_plans_quota_columns.sql`.

  Add columns to the existing `plans` table:
  ```sql
  ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS max_printers INTEGER DEFAULT -1;
  ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS max_orders_monthly INTEGER DEFAULT -1;
  ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS has_whatsapp_bot BOOLEAN DEFAULT false;
  ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS has_analytics BOOLEAN DEFAULT false;
  ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS has_custom_poster BOOLEAN DEFAULT false;
  ```

  Then upsert seed rows for all five plan codes matching the static catalog in `lib/plans.js` (prices must match exactly):

  ```sql
  INSERT INTO public.plans (code, name, original_price, offer_price, billing_cycle, features, is_active,
      max_printers, max_orders_monthly, has_whatsapp_bot, has_analytics, has_custom_poster)
  VALUES
    ('free',     'Free',     0,     null,  'monthly', '["1 Printer Connection","Max 50 Orders/month","Manual Token Queue","Community Support"]',            true, 1,  50,   false, false, false),
    ('basic',    'Basic',    349,   null,  'monthly', '["2 Printer Fleet Connections","Max 500 Live Orders/month","Basic Daily Revenue Analytics","Email Support"]', true, 2,  500,  false, true,  false),
    ('pro',      'Pro',      1299,  null,  'monthly', '["Up to 4 Printer Connections","Unlimited Orders & Live Queue","Live Efficiency Meter & Analytics","Priority WhatsApp Support","Custom Branding on Receipts"]', true, 4,  -1,   true,  true,  true),
    ('advance',  'Advance',  2499,  null,  'monthly', '["Unlimited Printer Connections","Multi-Branch Support","Automated WhatsApp Customer Alerts","API Access & Custom Billing ERP","24/7 Phone Support"]', true, -1, -1,   true,  true,  true),
    ('lifetime', 'Lifetime', 1999,  null,  'lifetime','["Everything in Advance, forever","Unlimited Printers & Orders","All future features included","Zero renewals — ever"]', true, -1, -1,   true,  true,  true)
  ON CONFLICT (code) DO UPDATE SET
    max_printers           = EXCLUDED.max_printers,
    max_orders_monthly     = EXCLUDED.max_orders_monthly,
    has_whatsapp_bot       = EXCLUDED.has_whatsapp_bot,
    has_analytics          = EXCLUDED.has_analytics,
    has_custom_poster      = EXCLUDED.has_custom_poster;
  ```

  **Progressive-column-drop pattern**: Any app code reading these columns must handle them being absent (`null` / `undefined`) by falling back to `-1` (unlimited) for integers and `true` for boolean feature flags. The migration uses `ADD COLUMN IF NOT EXISTS` so it is safe to re-run.

  Files: `printx-frontend/supabase/migrations/20261010_plans_quota_columns.sql`

  Verify: Run the SQL file in Supabase SQL Editor. Then run:
  ```sql
  SELECT code, max_printers, max_orders_monthly, has_whatsapp_bot, has_analytics FROM public.plans ORDER BY created_at;
  ```
  Expect 5 rows with correct quota values. Then run `npm run build` from `printx-frontend/` — must produce zero errors.

---

- [ ] 2. **Create `lib/getShopActivePlan.js` — server-side plan helper**

  Create `printx-frontend/lib/getShopActivePlan.js`. This is a server-only helper (uses `supabaseAdmin`) used by API routes.

  **Signature and logic:**
  ```js
  // lib/getShopActivePlan.js
  import { supabaseAdmin, isSupabaseAdminConfigured } from './supabaseAdmin';

  /**
   * Fetch the active plan row from `plans` for a given shopId.
   * - Reads shops.subscription_plan and shops.subscription_expires_at.
   * - If subscription_expires_at is past NOW (and plan !== 'lifetime'), falls
   *   back to 'free'.
   * - Joins the plans table by code to return quota/feature columns.
   * - Returns a merged object or a hardcoded free-plan fallback when the
   *   `plans` table doesn't have the new quota columns yet.
   *
   * @param {string} shopId - UUID from shops.id
   * @returns {Promise<{
   *   planId: string,
   *   max_printers: number,      // -1 = unlimited
   *   max_orders_monthly: number, // -1 = unlimited
   *   has_whatsapp_bot: boolean,
   *   has_analytics: boolean,
   *   has_custom_poster: boolean,
   *   is_lifetime: boolean,
   *   expires_at: string|null
   * }>}
   */
  export async function getShopActivePlan(shopId) { ... }
  ```

  **Implementation details:**
  - Query `shops` for `subscription_plan, subscription_expires_at, is_lifetime` (progressive-drop `is_lifetime` if absent).
  - Determine `effectivePlanId`: if `subscription_expires_at` is non-null AND in the past AND `subscription_plan !== 'lifetime'`, use `'free'`; else use `subscription_plan || 'free'`.
  - Query `plans` for `code = effectivePlanId`, selecting `max_printers, max_orders_monthly, has_whatsapp_bot, has_analytics, has_custom_poster`.
  - If the `plans` row is missing quota columns (PostgREST 400 / PGRST204), fall back to conservative defaults: `{ max_printers: -1, max_orders_monthly: -1, has_whatsapp_bot: false, has_analytics: false, has_custom_poster: false }`.
  - If Supabase is not configured, return the free plan defaults (unlimited for orderly demo mode).
  - Export a `FREE_PLAN_DEFAULTS` constant for use in tests and fallback paths.

  Files: `printx-frontend/lib/getShopActivePlan.js`

  Verify: `npm run build` — zero build errors. (Unit tests can be added in step 8 if a test runner is wired up; at build time the import chain is verified.)

---

- [ ] 3. **Fix `subscriptionService.js` — `is_lifetime` column and lifetime `subscription_expires_at`**

  The `computeExpiryFromBase()` function already correctly extends from `current_expiry` (this is the core bug fix and it is already present). However, per the task requirements, lifetime upgrades should set `subscription_expires_at` to `null` (already the case) AND the `is_lifetime` flag should be handled robustly.

  In `applySubscriptionUpgrade()`:
  - The `shopPayload` for lifetime already sets `subscription_expires_at: null` and conditionally adds `is_lifetime: true`. Confirm the progressive-drop loop for `SHOPS_MISSING_COLUMNS` covers `is_lifetime` — it does. **No change needed here.**
  - Add a brief inline comment in `computeExpiryFromBase()` confirming the extension logic is intentional (for auditability).
  - Add a JSDoc `@since` note and a one-line comment above the `computeExpiryFromBase` call inside `applySubscriptionUpgrade` explaining: "Extends from current_expiry if future — preserves remaining paid days."

  Files: `printx-frontend/lib/subscriptionService.js`

  Verify: `npm run build` — zero errors. The comment-only change is low-risk.

---

- [ ] 4. **Update `lib/plans.js` — add quota metadata as a static fallback**

  Add quota fields to each plan in the `PLANS` constant so API routes can fall back to static limits when the `plans` table query fails (network error or table not yet migrated). These must match the seed data from step 1 exactly.

  ```js
  // Add to each plan object:
  free:     { ..., max_printers: 1,  max_orders_monthly: 50,  has_analytics: false, has_whatsapp_bot: false, has_custom_poster: false }
  basic:    { ..., max_printers: 2,  max_orders_monthly: 500, has_analytics: true,  has_whatsapp_bot: false, has_custom_poster: false }
  pro:      { ..., max_printers: 4,  max_orders_monthly: -1,  has_analytics: true,  has_whatsapp_bot: true,  has_custom_poster: true  }
  advance:  { ..., max_printers: -1, max_orders_monthly: -1,  has_analytics: true,  has_whatsapp_bot: true,  has_custom_poster: true  }
  lifetime: { ..., max_printers: -1, max_orders_monthly: -1,  has_analytics: true,  has_whatsapp_bot: true,  has_custom_poster: true  }
  ```

  The `module.exports` at the bottom stays the same. `lib/plans.js` uses CommonJS (`module.exports`) — do not convert to ESM.

  Files: `printx-frontend/lib/plans.js`

  Verify: `npm run build` — zero errors. Confirm the new fields are present via a quick Node REPL check: `node -e "const {PLANS}=require('./lib/plans'); console.log(PLANS.free.max_printers)"` should print `1`.

---

- [ ] 5. **Add order-quota enforcement to `/api/upload/route.js`**

  After the shop is resolved (post the existing `suspended || expired` guard, before the token/insert block):

  1. Call `getShopActivePlan(shop.id)`.
  2. If `activePlan.max_orders_monthly !== -1`:
     - Count this month's completed+non-cancelled `print_jobs` for `shop.id` using `supabaseAdmin.from('print_jobs').select('id', { count: 'exact', head: true }).eq('shop_id', shop.id).gte('created_at', monthStart.toISOString())`.
     - If `count >= activePlan.max_orders_monthly`, return `NextResponse.json({ success: false, error: 'Monthly order limit reached for this shop's plan. Please upgrade.', planLimitReached: true }, { status: 403 })`.
  3. If the `plans` table query fails (network / missing columns), fall back to `PLANS[subscription_plan]?.max_orders_monthly ?? -1` from the static catalog — never block on a DB error.
  4. Place the quota check inside a try/catch so any error in `getShopActivePlan` degrades to "allow" (same fail-open principle as the existing schema-drift pattern).

  Files: `printx-frontend/app/api/upload/route.js`

  Verify: `npm run build` — zero errors.

---

- [ ] 6. **Add order-quota enforcement to `/api/jobs/manual-entry/route.js`**

  Apply the same guard as step 5, in the same location (after shop is resolved, before the `insertPayload` block). The guard logic is identical — extract it into the same pattern. Since this route creates manual walk-in orders for the vendor dashboard, the same monthly limit applies.

  Use the same fail-open / progressive-drop pattern: if `getShopActivePlan` throws, skip the check.

  Files: `printx-frontend/app/api/jobs/manual-entry/route.js`

  Verify: `npm run build` — zero errors.

---

- [ ] 7. **Add printer-count enforcement to `/vendor/dashboard/printers/page.jsx`**

  In the `PrintersPage` component:

  1. When the component mounts (after `fetchPrinters()` resolves), fetch the active plan from Supabase client-side:
     - Call `fetchPlans()` from `lib/plansStore.js` (already imported in BillingContent — add the import here).
     - Find the row matching `shop.subscription_plan` (from `useShop()`), reading `max_printers`.
     - Fall back to `PLANS[shop.subscription_plan]?.max_printers ?? -1` if the DB row is absent.
  2. Compute `printerLimitReached = maxPrinters !== -1 && printers.length >= maxPrinters`.
  3. In the "Add New Printer" button at the top and inside the modal's Save button:
     - When `printerLimitReached`, disable the button and show a tooltip/inline message: `"Your {PlanName} plan supports up to {maxPrinters} printer(s). Upgrade to add more."`.
  4. The `openAdd()` function should also guard: if `printerLimitReached`, call `showToast('error', '...')` and return early instead of opening the modal.

  **Note:** This is a client-side UI guard. The authoritative server-side guard (if needed in future) belongs in an `/api/printers/add` route — but that route does not currently exist. Per the task scope, the UI guard is sufficient since the printers table is only written from this component.

  Files: `printx-frontend/app/vendor/dashboard/printers/page.jsx`

  Verify: `npm run build` — zero errors.

---

- [ ] 8. **Add `has_analytics` gating to the analytics page**

  In `printx-frontend/app/vendor/dashboard/analytics/page.jsx`:

  1. Read `shop.subscription_plan` from `useShop()` (already present).
  2. Client-side: fetch the active plan row using `fetchPlans()` + filter by `shop.subscription_plan`, then read `has_analytics`.
  3. Fall back to `PLANS[shop.subscription_plan]?.has_analytics ?? true` — fail-open: if the DB is down, show analytics.
  4. When `has_analytics === false` (i.e. the shop is on 'free' plan):
     - Render an upgrade prompt overlay instead of the analytics content. Style it consistently with the existing "Shop Not Found" state in the same file: centered card with the plan icon, a message like "Analytics are available on Basic and above", and an "Upgrade Plan" link to `/vendor/dashboard/billing`.
     - Show a skeleton/placeholder of the stat cards behind the overlay so the page doesn't look empty.
  5. Store the `has_analytics` check result in a `hasPlanFeature` state variable set on mount.

  Files: `printx-frontend/app/vendor/dashboard/analytics/page.jsx`

  Verify: `npm run build` — zero errors.

---

- [ ] 9. **Add `has_whatsapp_bot` gating to the VendorShell sidebar (future nav item)**

  In `printx-frontend/components/layout/VendorShell.jsx`:

  1. The `navItems` array is defined at module scope. WhatsApp is not currently a nav item, but there is a `whatsapp` section referenced in the codebase. Per the task requirement, the sidebar should hide or lock feature nav items based on `has_whatsapp_bot`.
  2. Add a `featureFlag` property to nav items that should be gated: e.g. `{ ..., featureFlag: 'has_whatsapp_bot' }`. Currently only `analytics` would be gated via `has_analytics`.
  3. In `VendorShellInner`, after the shop resolves from `useShop()`, derive the active plan features:
     - Read `shop.subscription_plan` and look it up in the static `PLANS` map for `has_analytics` and `has_whatsapp_bot` — use the static fallback (from step 4) as the primary source for the sidebar since it is synchronous and avoids a DB round-trip on every navigation render.
  4. Filter or mark nav items: items with a `featureFlag` that resolves to `false` should render with a `Lock` icon overlay and clicking them redirects to `/vendor/dashboard/billing` with a query param `?upgrade=<feature>`.
  5. The analytics nav item (`/vendor/dashboard/analytics`) already exists and should be gated by `has_analytics`.
  6. Do not remove nav items from the DOM — just lock them — so the UI layout stays stable and the upgrade path is discoverable.

  Files: `printx-frontend/components/layout/VendorShell.jsx`

  Verify: `npm run build` — zero errors.

---

- [ ] 10. **Update `BillingContent.jsx` — enforce dynamic plan data for plan cards**

  The billing page already fetches from `plansStore.fetchPlans()` and merges into `resolvedPlans`. The `PLAN_ORDER` array and `PLANS` import are still used as structural fallbacks. The task requires the plan cards to be fully driven by the DB when available.

  Changes needed:
  1. Extend `getPlanPrice()` to also return `max_printers`, `max_orders_monthly`, `has_whatsapp_bot`, `has_analytics` from the DB row (for display in the plan cards or tooltips — these are informational in the UI).
  2. In `CurrentPlanBanner`, the `daysLeft > 0` notice already shows the extension message ("Any new purchase will extend your subscription from {date}"). Verify this renders for all non-free, non-lifetime plans with a future expiry. No code change needed — it is already implemented correctly.
  3. **Remove the static `billed` calculation for plan cards** that hardcodes `plan.yearly` from `PLANS`:
     - Replace `const rate = planId === 'lifetime' ? plan.lifetime : isYearly ? Math.round(plan.yearly / 12) : plan.monthly` with the dynamic price from `resolvedPlans` when available, falling back to `PLANS[planId]`.
     - Replace `Billed ₹${plan.yearly.toLocaleString('en-IN')}/year` with the DB yearly price when available.
  4. The `invoices` query reads from `subscriptions` table — correct table, no change needed.
  5. Remove the dead comment `// Invoice history loaded from the `subscriptions` table (real Razorpay payments). Empty → clean "No billing history available" state.` if it references `billing_history` — it does not, so no change needed.

  Files: `printx-frontend/components/billing/BillingContent.jsx`

  Verify: `npm run build` — zero errors.

---

- [ ] 11. **Remove static plan data from files that should now use DB-driven data**

  Files to clean up:

  a. **`lib/plans.js`** — keep the `PLANS` constant as the authoritative static fallback (it is imported by 7+ files including API routes that cannot hit the DB on every request). Do NOT delete it. The quota fields added in step 4 complete it.

  b. **`components/billing/BillingContent.jsx`** — the `PLAN_UI` metadata object (icons, taglines, gradients) is UI-only and is keyed to plan ids, not DB rows. Keep it — it is not "plan configuration", it is display metadata. No removal needed.

  c. **`app/admin/dashboard/page.jsx` → `PlansModule`** — already reads from `plans` table via `fetchPlans()`. The hardcoded demo fallback rows use the correct `code` values (`'free'`, `'basic'`, etc.). No change needed.

  d. **`lib/shopStatus.js`** — `planLabel()` and `planMonthlyValue()` read from `PLANS`. These are utility functions used by the admin route for MRR calculation. Keep them as-is; they correctly fall back to the static catalog when the DB is not queried.

  e. **`app/api/razorpay/verify/route.js`** and **`app/api/razorpay/webhook/route.js`** — both import `PLANS` for validation. These are security-critical (amount verification). Keep using the static catalog. Do not replace with DB queries in payment verification paths.

  No files need deletion. The static catalog becomes the fallback layer; the DB becomes the primary source for the billing UI and quota enforcement.

  Files: No file deletions. This is a documentation/confirmation item.

  Verify: `npm run build` — zero errors. `grep -r "PLANS" printx-frontend/lib printx-frontend/app/api` should show only the expected imports (billing routes, admin routes, shopStatus).

---

- [ ] 12. **End-to-end build verification**

  After all steps are complete:

  1. Run `npm run build` from `printx-frontend/`:
     ```
     cd c:\Users\mohit\OneDrive\Desktop\PrintX\printx-frontend
     npm run build
     ```
  2. Confirm **zero TypeScript/ESLint errors** and **zero build failures**.
  3. Confirm the `.next/` output contains chunks for:
     - `app/vendor/dashboard/billing/page`
     - `app/vendor/dashboard/analytics/page`
     - `app/vendor/dashboard/printers/page`
     - `app/api/upload/route`
     - `app/api/jobs/manual-entry/route`

  Files: no code changes — verification only.

  Verify: `npm run build` exits with code 0.

---

## Static Config Removal Checklist

| File | Static to remove / replace | Action |
|---|---|---|
| `lib/plans.js` | `PLANS` object | **Keep** — extend with quota fields (step 4) |
| `components/billing/BillingContent.jsx` | `PLAN_ORDER`, `PLAN_UI` | **Keep** — display-only metadata, not pricing config |
| `components/billing/BillingContent.jsx` | Hardcoded `plan.yearly` in `billed` string | **Replace** with DB price (step 10) |
| `lib/shopStatus.js` | `planMonthlyValue()` using `PLANS` | **Keep** — admin MRR calc, static fallback is correct |
| `app/api/razorpay/verify/route.js` | `PLANS` import | **Keep** — security-critical amount check |

## Supabase Table Names Confirmed From Codebase

- `shops` — main vendor table
- `plans` — plan catalog (PK: `code`)
- `subscriptions` — invoice/audit log (PK: `id`)
- `wallet_transactions` — payment ledger
- `print_jobs` — customer order rows
- `printers` — printer fleet
- `orders` — sidecar order table (linked to print_jobs by `id`)

## Progressive-Column-Drop Pattern (for new columns)

Every new column added to `plans` (`max_printers`, `max_orders_monthly`, `has_whatsapp_bot`, `has_analytics`, `has_custom_poster`) may be absent on deployments that haven't run the migration. Reading code must:

1. Select the column with `IF NOT EXISTS`-safe SQL (the migration handles table-side).
2. In JS, treat `null`/`undefined` responses as the safe default:
   - Integer quota columns: `null ?? -1` → unlimited (fail-open)
   - Boolean feature flags: `null ?? true` → enabled (fail-open — never lock a vendor due to a missing column)
3. The static `PLANS` constant (updated in step 4) serves as the code-level fallback when the DB row is missing or the column is absent.

## File Extension Confirmation

All existing `lib/` files are `.js`. New file `lib/getShopActivePlan.js` must be `.js`. No `.ts` files exist in `lib/` or `app/api/`.
