-- ============================================================================
-- PrintX — Fix "Could not find the 'status' column of 'shops' in the schema
-- cache" — Super Admin & Subscription Enforcement columns.
--
-- HOW TO RUN:
--   Supabase Dashboard → your project → SQL Editor → New query →
--   paste this whole file → Run.
--
-- Adds:
--   shops.status                  TEXT  'active' | 'suspended' (admin toggle)
--   shops.is_active               BOOLEAN (legacy-friendly suspension flag)
--   shops.subscription_plan       TEXT  free | basic | pro | advance | lifetime
--   shops.subscription_expires_at TIMESTAMPTZ NULL (NULL = never expires)
--
-- NOTE: plan ids are stored lowercase ('free', 'pro', …) to match the
-- app's plan catalog (lib/plans.js); the UI displays them capitalized.
-- Backfills existing rows safely. Idempotent — safe to run repeatedly.
-- ============================================================================

ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS subscription_plan TEXT NOT NULL DEFAULT 'free';

ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ;

-- Existing rows: nothing to backfill — NOT NULL defaults apply retroactively
-- for status / is_active / subscription_plan; expiry stays NULL (= no expiry).

-- Keep legacy capitalized values consistent (case-insensitive reads are also
-- handled in app code, this just normalizes stored data).
UPDATE public.shops SET subscription_plan = LOWER(subscription_plan)
WHERE subscription_plan IS NOT NULL AND subscription_plan <> LOWER(subscription_plan);

-- Realtime so admin status changes push to dashboards instantly
ALTER TABLE public.shops REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'shops'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.shops;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL; -- already in publication
END $$;

-- Quick verification (should return your shops with the new columns):
-- SELECT id, name, status, is_active, subscription_plan, subscription_expires_at
-- FROM public.shops LIMIT 10;
