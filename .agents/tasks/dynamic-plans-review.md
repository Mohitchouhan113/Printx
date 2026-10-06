# Dynamic subscription plans and upgrade-fix rollout

This change replaces the static plan configuration with a database-driven `plans` table and fixes the subscription overwrite bug that was causing vendors to lose remaining paid days on upgrade. The backend now extends expiry from `current_expiry` when a subscription is still active, the billing page renders plan cards from DB rows with the static catalog as a fallback, and quota limits (printer count, monthly orders) are enforced server-side with 403 responses. Build verified at commit `adf05c9` with exit code 0.

**Watch for:** (confirmed) `has_analytics` is enforced client-side only — there is no server-side API guard blocking analytics data queries for free-plan vendors. (confirmed) The `subscription_expires_at = NULL` backdoor grants permanent paid access to any shop with a null expiry, deliberately, but this is documented only in a code comment with no admin-facing controls or audit trail. (possible) The idempotency check in `subscriptionService.js` queries `wallet_transactions.description LIKE *paymentId*` as its primary replay guard, which is a text substring scan rather than an indexed equality match, and degrades to "apply anyway" on any error — a Supabase availability blip during the duplicate check lets a replayed callback re-extend the expiry.

**Verdict**: NEEDS_CHANGES

---

## High-level view

`getShopActivePlan` fetches the shop's `subscription_expires_at` and `subscription_plan`, computes expiry correctly (null expiry = indefinite admin grant, expired timestamp = free, future timestamp = paid plan), then pulls quota columns from the `plans` table with progressive column-drop to the static `lib/plans.js` catalog. The free-plan fallback when the DB is unreachable hard-codes `max_printers: 1` and `max_orders_monthly: 50` rather than `-1` (unlimited), which is a deliberate conservative default — correct behaviour.

The subscription upgrade path flows exclusively through `/api/billing/verify-payment`, which gates on a server-signed `intentId`, an HMAC-SHA256 signature check, and a live Razorpay order status fetch. `applySubscriptionUpgrade` in `subscriptionService.js` reads the current `subscription_expires_at` before computing the new expiry, so a future timestamp extends forward from that base. The expiry arithmetic is correct.

The billing page uses `dynamicPlans` (the active DB rows) as the primary source for card order and prices, falling back to `PLAN_ORDER` only when the DB hasn't responded. The `PLANS` constant is still imported for display metadata (icons, taglines, CTA labels) and as the price fallback when a plan's DB row is missing — it is no longer the source of plan IDs or prices for the rendered card grid.

`has_analytics` is evaluated client-side in the analytics page, which skips the data fetch and shows a lock screen when the flag is false. There is no server-side API route that checks `has_analytics` before returning analytics data. If someone calls the Supabase client directly with a valid session token, the lock is bypassed. The same pattern applies to `has_whatsapp_bot` and `has_custom_poster` — they control sidebar lock state via the static `PLANS` catalog in `VendorShell`, not a server-side check.

The idempotency guard uses a `wallet_transactions.description LIKE *paymentId*` substring scan as its first check, then falls back to `subscriptions.payment_id` equality. Both checks degrade to "proceed" on any DB error, meaning a transient Supabase failure during the duplicate check window lets a replayed Razorpay callback re-apply an upgrade.

<details>
<summary>Issues (4)</summary>

1. **Analytics API has no server-side gate** — `has_analytics` is enforced only in the client component. Add a server-side check in any API route that returns analytics data, or enforce it via Supabase RLS, so free-plan vendors cannot access analytics data by calling the DB directly.

2. **NULL-expiry backdoor has no audit trail** — `subscription_expires_at = NULL` on a paid plan grants permanent access. This is deliberate but undocumented outside the source code. Add an admin UI note or an `is_admin_granted` flag to distinguish manual grants from billing-system-issued null expiries, so support staff can identify and audit which shops have permanent access.

3. **Replay guard degrades to allow on DB error** — Both idempotency checks (`wallet_transactions` description LIKE scan and `subscriptions.payment_id` lookup) catch their errors and proceed. A transient failure lets a replayed callback re-extend a subscription. The `wallet_transactions` check also uses a substring scan rather than an indexed column, so at scale it will be slow. Consider making the `subscriptions.payment_id` check the authoritative guard (it uses an equality match) and only proceeding if that check itself errors, not if it returns no result.

4. **`has_whatsapp_bot` / `has_custom_poster` are UI-only gates** — Like analytics, these feature flags only suppress UI elements in `VendorShell` (via the static PLANS catalog, not the DB) and do not block any server-side functionality. If the WhatsApp bot or custom poster endpoints exist, they should check `getShopActivePlan` and return 403 when the flag is false.

</details>

<details>
<summary>Details</summary>

### `has_analytics` and `has_whatsapp_bot` are UI-only gates

The analytics page (`app/vendor/dashboard/analytics/page.jsx`) checks `hasAnalytics` before calling `fetchJobs` and renders a lock screen when false. The flag is sourced from the DB `plans` row with a static fallback. The data query itself goes directly from the browser to Supabase via the anon client — there is no API route in the chain and no server-side `getShopActivePlan` call. A free-plan vendor who queries the Supabase client directly with their session token reads `print_jobs` without restriction.

`VendorShell` computes `planFeatureFlags` from the static `PLANS` catalog synchronously, so admin changes to `has_analytics` in the `plans` table have no effect on the sidebar lock until the catalog is redeployed. The analytics page makes a live DB fetch for its own gate so it can reflect DB changes, but the sidebar cannot.

The same gap applies to `has_whatsapp_bot` and `has_custom_poster`: they control UI visibility but there is no evidence that any WhatsApp or poster API route calls `getShopActivePlan` before serving requests.

### Idempotency replay window

`subscriptionService.js` uses a `wallet_transactions.description LIKE *paymentId*` substring scan as its primary duplicate check, then `subscriptions.payment_id` equality as a secondary. Both degrade to "proceed" on any DB error — a transient Supabase failure during the duplicate check window lets a replayed callback re-extend a subscription. The wallet_transactions scan has no indexed column to match against, so it is a full-table scan at scale. The `subscriptions.payment_id` equality check is the stronger guard but it is sequenced second.

</details>

---

<details>
<summary>File map</summary>

| File | Change |
|---|---|
| `lib/getShopActivePlan.js` | New server-side helper: resolves active plan with quota fields, progressive column-drop, fail-open |
| `lib/subscriptionService.js` | `applySubscriptionUpgrade`: extends expiry from current_expiry when active; progressive column-drop on shops/subscriptions/wallet_transactions |
| `lib/plansStore.js` | `fetchPlans` preferred select now includes `has_analytics`, `has_whatsapp_bot`, `has_custom_poster`, `max_printers`, `max_orders_monthly` |
| `lib/plans.js` | Static catalog extended with quota fields as fallback values |
| `app/api/billing/verify-payment/route.js` | Primary upgrade path: intent token + HMAC check + live Razorpay order fetch before calling `applySubscriptionUpgrade` |
| `app/api/razorpay/verify/route.js` | Old verify route now refuses to activate; redirects callers to `verify-payment` |
| `app/api/printers/add/route.js` | New route: server-side printer insert with `max_printers` quota enforcement via `getShopActivePlan` |
| `app/api/upload/route.js` | Added `max_orders_monthly` quota check via `getShopActivePlan` before insert |
| `components/billing/BillingContent.jsx` | Plan cards driven by DB rows (`dynamicPlans`); `PLAN_ORDER` is static fallback only; extension notice shown when active paid plan exists |
| `app/vendor/dashboard/analytics/page.jsx` | `has_analytics` client-side check gates data fetch and renders lock screen |
| `components/layout/VendorShell.jsx` | Sidebar nav items locked based on feature flags from static `PLANS` catalog |

Full diff: `git diff main` from `printx-frontend/`

</details>
