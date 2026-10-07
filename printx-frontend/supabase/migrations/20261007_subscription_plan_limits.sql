-- Migration: subscription plan feature-limit enforcement
--
-- 1. plans.max_pages — monthly sheet cap per plan (mirrors lib/plans.js).
-- 2. subscriptions feature-limit columns — the entitlement snapshot written
--    when a payment is verified (/api/billing/verify-payment,
--    /api/razorpay/webhook) or a plan is assigned (/api/admin/shops), and
--    read back by lib/getShopActivePlan for every quota/feature gate
--    (printers, pages, WhatsApp engine, analytics).
--
-- Safe to re-run: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS +
-- UPDATE keyed by plan code (never inserts bare rows, never clobbers
-- admin-edited prices/flags/is_active).
--
-- Until this migration is applied the app still works: writers use
-- progressive column-drop (lib/subscriptionService.writeSubscriptionRow)
-- and readers fall back plans-catalog → static lib/plans.js.

/* ------------------------------------------------------------------ */
/* 1. plans.max_pages                                                  */
/* ------------------------------------------------------------------ */
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS max_pages INTEGER NOT NULL DEFAULT -1;

-- Backfill/refresh the page cap for existing plan rows only (UPDATE never
-- creates a half-filled row for a missing code). Lifetime mirrors the
-- subscription-row entitlement: 9999 printers / 999999 pages.
UPDATE public.plans SET max_pages = v.max_pages
FROM (VALUES
        ('free',     500),
        ('basic',    5000),
        ('pro',      50000),
        ('advance',  -1),
        ('lifetime', 999999)
     ) AS v(code, max_pages)
WHERE public.plans.code = v.code;

UPDATE public.plans SET max_printers = 9999
WHERE code = 'lifetime';

/* ------------------------------------------------------------------ */
/* 2. subscriptions — entitlement + feature-limit snapshot             */
/* ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id            UUID,
  plan_id            TEXT,
  billing_cycle      TEXT,
  amount_rupees      NUMERIC,
  payment_id         TEXT,
  order_id           TEXT,
  invoice_number     TEXT,
  status             TEXT,
  start_date         TIMESTAMPTZ,
  end_date           TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Feature-limit snapshot (nullable: pre-migration rows inherit from the
  -- plans catalog per-column — NULL never zeroes out other columns).
  max_printers       INTEGER,
  max_pages          INTEGER,
  max_orders_monthly INTEGER,
  has_whatsapp_bot   BOOLEAN,
  has_analytics      BOOLEAN,
  has_custom_poster  BOOLEAN
);

-- Pre-existing subscriptions tables get the limit columns added one by one.
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS shop_id            UUID;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS plan_id            TEXT;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS billing_cycle      TEXT;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS amount_rupees      NUMERIC;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS payment_id         TEXT;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS order_id           TEXT;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS invoice_number     TEXT;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS status             TEXT;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS start_date         TIMESTAMPTZ;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS end_date           TIMESTAMPTZ;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS max_printers       INTEGER;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS max_pages          INTEGER;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS max_orders_monthly INTEGER;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS has_whatsapp_bot   BOOLEAN;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS has_analytics      BOOLEAN;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS has_custom_poster  BOOLEAN;

CREATE INDEX IF NOT EXISTS idx_subscriptions_shop_id ON public.subscriptions (shop_id);

/* ------------------------------------------------------------------ */
/* 3. Row Level Security                                               */
/* ------------------------------------------------------------------ */
-- Server paths write with the service role (bypasses RLS). The browser
-- reads only its OWN shop's rows: the billing page (invoices) and the
-- feature gates (lib/activeSubscription). The policy is guarded so that a
-- deployment without shops.owner_id still applies the table changes above.
DO $$
BEGIN
  ALTER TABLE public.subscriptions ENABLE ROW SECURITY;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'shops' AND column_name = 'owner_id'
  ) THEN
    DROP POLICY IF EXISTS "owners read own subscriptions" ON public.subscriptions;
    CREATE POLICY "owners read own subscriptions" ON public.subscriptions
      FOR SELECT USING (
        shop_id IN (SELECT id FROM public.shops WHERE owner_id = auth.uid())
      );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'subscriptions RLS setup skipped: %', SQLERRM;
END $$;

-- Verify:
--   SELECT code, max_printers, max_pages, has_whatsapp_bot, has_analytics FROM public.plans;
--   SELECT shop_id, plan_id, max_printers, max_pages, has_analytics FROM public.subscriptions;
