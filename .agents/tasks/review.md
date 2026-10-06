# Subscription upgrade: expiry extension and billing hardening

The change fixes a critical bug where purchasing a new plan while an active subscription exists would overwrite the expiry date from `NOW()` instead of extending it from the current expiry. The fix is delivered as a shared `subscriptionService.js` module that centralizes all subscription-write logic, called by both `/api/billing/verify-payment` and the Razorpay webhook — so both paths behave identically. The billing UI surfaces remaining days, and the active-plan notice tells vendors their days won't be lost on purchase. Additionally, `/api/razorpay/verify` — a former security hole that let callers self-grant a free upgrade by posting a forged `order_demo_*` id — is now a hard refusal.

Watch for: The duplicate-guard paths call `computeExpiryFromBase(planId, billingCycle, currentShop?.subscription_expires_at)`, but the shop fetch uses `maybeSingle()` which silently returns `data: null` on a DB error (not just "not found") — the code ignores the `error` field. When that happens, the receipt modal shows `NOW + plan_duration` instead of the real future expiry. No data corruption — the shop row is untouched on a duplicate — but the display is wrong. (confirmed)

**Verdict**: APPROVED

---

## High-level view

`computeExpiryFromBase` reads `subscription_expires_at` from the shop row and uses it as the base only when strictly greater than `Date.now()`; otherwise falls back to now. Spot-checked across all four cases (future expiry, past expiry, null, lifetime) — all correct.

The duplicate-payment guard works correctly after the shop fetch was moved above both early-return paths. Both the wallet_transactions path and the subscriptions-table path can now pass the real future expiry to `computeExpiryFromBase`. The gap is that the shop fetch error is silently swallowed, making a DB-error-on-fetch indistinguishable from "first purchase" — the receipt modal then shows the wrong date for a replayed payment.

`/api/billing/verify-payment` is now the only path that may activate a subscription. Plan, billing cycle, shop, and amount come from a server-signed `intentId` token rather than the request body, followed by HMAC verification, a live Razorpay order fetch confirming `PAID`, and an amount match against both the intent and the plan catalog. The old `/api/razorpay/verify` demo-bypass exploit is closed by making that route a hard 400 after HMAC validation.

The lifetime path sets `subscription_expires_at = null` and writes `is_lifetime = true` with a progressive-column-drop retry so a missing column never blocks the activation. The UI keys off `planId === 'lifetime'`, not the column, so a schema gap doesn't affect display.

The "Extend Plan" label appears when `currentPlan !== 'free'` and `daysLeft > 0`, and is suppressed for the lifetime card. The active-plan notice uses the same guard, so it is absent for free, expired, and loading states.

---

<details>
<summary>Issues (1)</summary>

1. **Null shop on duplicate replay** — `maybeSingle()` shop fetch ignores the `error` field; a DB error returns `data: null`, indistinguishable from "no row". Both duplicate-guard early-return paths then call `computeExpiryFromBase(planId, billingCycle, null)` = `NOW + plan_duration`, and the receipt modal shows the wrong renewal date. Fix: destructure `error` from the shop fetch and log a warning when it is non-null; the `NOW + plan_duration` fallback is acceptable but should be an explicit logged decision.

</details>

---

<details>
<summary>Details</summary>

### Idempotency gap: shop fetch error ignored

```js
const { data: currentShop } = await supabaseAdmin
  .from('shops')
  .select('subscription_expires_at, subscription_plan')
  .eq('id', shopId)
  .maybeSingle();
```

`maybeSingle()` returns `{ data: null, error: PostgresError }` on a query failure, not just when the row is absent. Because the error is not destructured, a transient DB error here makes `currentShop` null. On a normal activation this propagates harmlessly — `computeExpiryFromBase` falls back to now and the upgrade proceeds from the correct base. On a duplicate replay (either early-return path) the returned `expiresAt` is `NOW + plan_duration` rather than the shop's real future expiry. The shop row is never written on a duplicate, so there is no corruption, but the receipt modal shows a misleading date.

### Security: intent-bound verification and exploit closure

The plan identity flowing from a server-signed intent (not the POST body) is the key improvement. Prior to this change, `/api/razorpay/verify` accepted `order_demo_*` / `pay_demo_*` with any signature and granted the requested plan — confirmed in the comments. Now that route validates the HMAC and then unconditionally returns HTTP 400 with a pointer to `/api/billing/verify-payment`. The new endpoint adds a live Razorpay fetch (`rzp.orders.fetch`) so the payment status is confirmed server-side before `applySubscriptionUpgrade` is called.

### Lifetime column resilience

The progressive-column-drop pattern for `is_lifetime` retries the `shops` update up to 3 times, dropping any column that produces `PGRST204`/`42703`. After the first discovery the column is stored in `SHOPS_MISSING_COLUMNS` (module-scoped Set), so subsequent activations skip the missing column without a round-trip. The same pattern is applied to `subscriptions` and `wallet_transactions`, keeping a DB schema mismatch from ever rolling back a paid activation.

</details>

---

<details>
<summary>File map</summary>

- `lib/subscriptionService.js` — New shared module: `applySubscriptionUpgrade` (DB writes, idempotency), `computeExpiryFromBase` (expiry calculation from current subscription state).
- `app/api/billing/verify-payment/route.js` — Authorized upgrade endpoint: server-signed intent, HMAC check, Razorpay order confirmation, amount match, then `applySubscriptionUpgrade`.
- `app/api/razorpay/verify/route.js` — Old verify route, now a hard refusal after HMAC check; closes the free-upgrade exploit.
- `app/api/razorpay/webhook/route.js` — Webhook handler, calls `applySubscriptionUpgrade` (same service, same idempotency).
- `components/billing/BillingContent.jsx` — Billing UI: `daysLeft` meter, "Extend Plan" / plan CTA label, active-plan notice with remaining days, real invoice history from `subscriptions` table.

Full diff: run `git diff main` in `printx-frontend/`.

</details>
