# Implementation Plan — Subscription Upgrade Bug Fix

## Context (grounded in code read during exploration)

### Root cause (confirmed in `lib/subscriptionService.js`)

`computeExpiry(planId, billingCycle)` on line 173 **always** uses `Date.now()` as the
base timestamp. It has no knowledge of the shop's existing `subscription_expires_at`.
`applySubscriptionUpgrade()` calls `computeExpiry()` on its very first line — **before**
any Supabase read — so the shop's current expiry is never consulted. Both activation
paths call this function:

- `/api/billing/verify-payment/route.js` → `applySubscriptionUpgrade()`
- `/api/razorpay/webhook/route.js` → `applySubscriptionUpgrade()`

Fixing `subscriptionService.js` alone covers both paths.

### `subscriptions` table decision

The `subscriptions` table is already the invoice/audit log. It currently records:
`shop_id`, `plan_id`, `billing_cycle`, `amount_rupees`, `payment_id`, `order_id`,
`invoice_number`, `status`, `created_at`. The idempotency guard already queries it.
**No new `subscription_history` table is needed.** Add `start_date` and `end_date`
columns to the `subscriptions` insert so the record is complete — these can be
added as insert-time fields with no migration required (Supabase ignores extra
fields only if RLS isn't strict; we will add them as explicit columns and handle
insert failure gracefully, matching the existing progressive-column-drop pattern).

### Migration SQL decision

The `supabase/` directory does **not** exist in the repo root. The project adds
columns progressively at runtime (see `LEDGER_MISSING_COLUMNS` pattern in
`subscriptionService.js`). For `subscriptions.start_date` / `subscriptions.end_date`,
the same progressive-insert pattern will be used: if the insert fails with PGRST204
on those columns, they are dropped and the insert retried — **no migration file is
needed for the billing fix itself**.

If an admin wants to add these columns formally, the migration file should live at
`printx-frontend/supabase/migrations/<timestamp>_add_subscription_dates.sql` (the
`supabase/` directory would need to be created first). This is out of scope for the
bug fix.

### `PlanButton` CTA decision

When a vendor has an active (non-expired) paid plan, the CTA label should change
to "Extend Plan" regardless of whether the plan is the same or a different tier.
The `PLAN_UI[planId].cta` strings ("Upgrade to Basic", etc.) remain for vendors
with no active plan. The `BillingContent` component already has `currentPlan`,
`currentExpiry`, and `daysLeft` in state, so the active-plan flag is derivable
there without a new prop.

---

## Plan Items

- [ ] 1. **Add `computeExpiryFromBase()` and fix `applySubscriptionUpgrade()` in `lib/subscriptionService.js`**

  **What**: Replace the single `computeExpiry(planId, billingCycle)` helper with
  `computeExpiryFromBase(planId, billingCycle, currentExpiryIso)` that accepts an
  optional current expiry. When `currentExpiryIso` is a future date, it uses that
  as the base; otherwise it falls back to `Date.now()`.

  Then update `applySubscriptionUpgrade()` to:
  1. **Fetch** the shop's current `subscription_expires_at` and `subscription_plan`
     from `shops` **before** computing the new expiry. Use `supabaseAdmin.from('shops').select('subscription_expires_at, subscription_plan').eq('id', shopId).maybeSingle()`.
  2. Call `computeExpiryFromBase(planId, billingCycle, shopRow?.subscription_expires_at)`.
  3. Handle the lifetime case: if `planId === 'lifetime'` or `billingCycle === 'lifetime'`,
     set `subscription_expires_at` to `null` and `is_lifetime` to `true` in the shops
     update (add `is_lifetime` to the update payload; Supabase ignores columns that
     don't exist yet — or add it to `shops` if already present).
  4. Update the `subscriptions` insert to also write `start_date` (the base date used —
     either current expiry or now) and `end_date` (the new expiry), using the same
     progressive-column-drop pattern already in place for `wallet_transactions`.

  **The exact logic for `computeExpiryFromBase`:**
  ```js
  function computeExpiryFromBase(planId, billingCycle, currentExpiryIso) {
    if (planId === 'lifetime' || billingCycle === 'lifetime') return null;
    const ms = billingCycle === 'yearly' ? YEAR_MS : MONTH_MS;
    const now = Date.now();
    const currentMs = currentExpiryIso ? new Date(currentExpiryIso).getTime() : NaN;
    // Extend from current expiry only if it is genuinely in the future.
    const base = Number.isFinite(currentMs) && currentMs > now ? currentMs : now;
    return new Date(base + ms).toISOString();
  }
  ```

  **Files**: `printx-frontend/lib/subscriptionService.js`

  **Verify**: Run `npm run build` from `printx-frontend/` — the build must succeed
  with zero errors. Manually verify by calling the function with a future
  `currentExpiryIso` and confirming the result is `currentExpiry + duration`,
  not `now + duration`.

---

- [ ] 2. **Update the `subscriptions` insert to record `start_date` and `end_date`** (depends on item 1)

  **What**: In `applySubscriptionUpgrade()`, the `subscriptions` insert block
  (currently around line 125 of `subscriptionService.js`) should include two
  additional fields:
  - `start_date`: the base timestamp used for calculation (the future `currentExpiry`
    if extended, otherwise `new Date().toISOString()`).
  - `end_date`: the computed `expiresAt` (null for lifetime).

  Wrap the insert in the same progressive-column-drop retry loop already used for
  `wallet_transactions`, tracking missing columns in a module-level
  `SUBSCRIPTIONS_MISSING_COLUMNS` Set. This way, if the columns don't exist in the
  live DB yet, the insert falls back gracefully and the activation still succeeds.

  **Files**: `printx-frontend/lib/subscriptionService.js`

  **Verify**: `npm run build` from `printx-frontend/` — zero errors. The
  `subscriptions` insert logic is in the same file; no separate build step needed.

---

- [ ] 3. **Update `PlanButton` CTA text in `BillingContent.jsx` to show "Extend Plan" when vendor has an active paid plan** (independent of items 1–2)

  **What**: In `BillingContent.jsx`, the `PlanButton` sub-component currently
  receives `cta={ui.cta}` and renders it unconditionally for non-current, non-busy
  plans. Add a `hasActivePlan` prop to `PlanButton` derived from the parent's state:
  - `hasActivePlan` is `true` when `currentPlan !== 'free'` AND `daysLeft > 0`
    (i.e., there is a paid plan that has not yet expired).

  When `hasActivePlan` is true, render "Extend Plan" instead of the static `cta`
  string from `PLAN_UI`.

  The call site in the plan card loop passes `hasActivePlan` as:
  ```jsx
  hasActivePlan={currentPlan && currentPlan !== 'free' && daysLeft != null && daysLeft > 0}
  ```

  Inside `PlanButton`, change the label line to:
  ```jsx
  {hasActivePlan ? 'Extend Plan' : cta}
  ```

  **Files**: `printx-frontend/components/billing/BillingContent.jsx`

  **Verify**: `npm run build` from `printx-frontend/` — zero errors.

---

- [ ] 4. **Add an "extension notice" banner in `CurrentPlanBanner` when vendor has an active plan** (depends on item 3 for context; independent of items 1–2)

  **What**: In `BillingContent.jsx`, inside the `CurrentPlanBanner` component,
  add a notice block that renders **only** when the vendor has an active paid plan
  (i.e., `!isFree && !isLifetime && daysLeft != null && daysLeft > 0`).

  The notice should appear just below the existing expiry/usage row in the banner,
  styled as a subtle info strip (amber or cyan tint matching the existing design
  system). It must state:

  > "You have an active plan. Any new purchase will extend your subscription from
  > **[formatted currentExpiry date]**, not today — you won't lose any remaining days."

  Use the existing `formatDate(currentExpiry)` helper already defined in the file.
  The notice uses icons already imported: `Calendar` and `ArrowUpRight` (both
  already in the import list).

  Implementation detail: `CurrentPlanBanner` receives `currentExpiry` and `daysLeft`
  as props already — no new props needed.

  Example JSX structure to add inside `CurrentPlanBanner`, after the usage meters
  grid and before the closing tag of the outer motion.div:

  ```jsx
  {!isFree && !isLifetime && daysLeft != null && daysLeft > 0 && (
    <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/8 px-3 py-2.5 text-xs text-amber-300">
      <Calendar className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-amber-400" />
      <span>
        You have an active plan. Any new purchase will extend your subscription from{' '}
        <strong className="text-amber-200">{formatDate(currentExpiry)}</strong>, not
        today — you won&apos;t lose any remaining {daysLeft} day{daysLeft === 1 ? '' : 's'}.
      </span>
    </div>
  )}
  ```

  Note: `formatDate` is defined at the bottom of the file (outside the component).
  Since `CurrentPlanBanner` is also in the same file, it can call `formatDate`
  directly — this already works for `expiryText` in the existing code.

  **Files**: `printx-frontend/components/billing/BillingContent.jsx`

  **Verify**: `npm run build` from `printx-frontend/` — zero errors.

---

- [ ] 5. **Build verification — final check** (depends on items 1–4)

  **What**: After all four items above are applied, run a clean build to confirm
  the entire Next.js application compiles without errors or warnings that would
  block a production deployment.

  ```
  cd c:\Users\mohit\OneDrive\Desktop\PrintX\printx-frontend
  npm run build
  ```

  Expected: build exits with code 0; no TypeScript/ESLint errors; all pages
  compile. The `.next/` directory is populated.

  **Files**: none (verification only)

  **Verify**: Exit code 0 from `npm run build`.

---

## Summary of decisions

| Decision | Choice | Rationale |
|---|---|---|
| New `subscription_history` table? | No — reuse `subscriptions` | `subscriptions` already stores all needed fields and is the active invoice/audit log; adding `start_date`/`end_date` to the existing insert is sufficient. |
| Migration SQL file? | Not required for the bug fix | The `supabase/` dir doesn't exist; the project uses progressive-column-drop at runtime. A formal migration is optional post-fix. |
| Fix location for both activation paths? | `subscriptionService.js` only | Both `/api/billing/verify-payment` and `/api/razorpay/webhook` delegate to `applySubscriptionUpgrade()` — one fix covers both. |
| Lifetime plan `is_lifetime` field | Include in shops update payload | Matches task requirement; Supabase ignores extra columns that don't exist yet, so this is safe even if the column is absent. |
| `PlanButton` CTA when active plan exists | "Extend Plan" for all plans | Matches task requirement; avoids having to distinguish same-tier vs upgrade which is unnecessary at this UI layer. |
| Base for expiry computation when plan is active | `currentExpiry` (future only) | `currentMs > now` guard prevents a stale/past expiry from being used as a base and losing time vs today. |
