-- ============================================================================
-- PrintX — shops: subscription controls for the Super Admin "Edit Subscription" modal
--
-- WHY: the modal writes five columns to `shops`, but three of them only exist
-- after 20260928_core_features.sql — on a deployment that skipped it, PostgREST
-- rejects the WHOLE update with:
--
--   400 PGRST204 "Could not find the 'subscription_status' column of 'shops'
--                 in the schema cache"
--
-- so the save silently loses fields (and `updated_at` has never existed on
-- this table at all). Adding them makes every control in the modal persist:
--   · subscription_plan      (already exists — no-op here)
--   · subscription_expires_at(already exists — no-op here)
--   · payment_status         (already exists — no-op here)
--   · subscription_status    ← missing
--   · trial_ends_at          ← missing
--   · updated_at             ← missing
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New query → paste this file → Run.
--   Idempotent — safe to run repeatedly, and a subset of the broader
--   20260928_core_features.sql migration.
-- ============================================================================

ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS subscription_status text DEFAULT 'active';
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS updated_at timestamptz;

-- Backfill: every existing shop starts active with no trial clock. Explicit
-- UPDATE (not just the DEFAULT) so rows written before this migration get a
-- real value instead of NULL.
UPDATE public.shops SET subscription_status = 'active' WHERE subscription_status IS NULL;

COMMENT ON COLUMN public.shops.subscription_status IS
  'SaaS subscription state: active | trial | expired. expired locks the vendor dashboard behind the renew banner. Derived from expiry dates when NULL.';
COMMENT ON COLUMN public.shops.trial_ends_at IS
  'End of the vendor''s free-trial window. Past this date resolveSubscriptionState() reports expired.';
COMMENT ON COLUMN public.shops.updated_at IS
  'Last admin edit of this shop row.';
