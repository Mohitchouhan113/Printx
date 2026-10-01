-- Core production features (2026-09-28)
--
-- Run in the Supabase SQL Editor. Until then every writer in the app uses
-- the progressive-column-drop pattern: the write retries without any column
-- this deployment doesn't have, so nothing breaks and no code change is
-- needed after running this migration.
--
--   · pricing_tiers         — tiered bulk discount ranges applied at checkout
--   · is_accepting_orders   — vendor header toggle; customer page blocks
--                             orders when false ("not accepting online orders")
--   · trial_ends_at         — SaaS trial window for the vendor subscription
--   · subscription_status   — 'active' | 'trial' | 'expired' (drives the
--                             locked dashboard overlay when expired)

ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS pricing_tiers jsonb;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS is_accepting_orders boolean DEFAULT true;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS subscription_status text DEFAULT 'active';
-- Spec-listed column; present on most deployments, IF NOT EXISTS is a no-op.
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS subscription_plan text;

-- Backfill: every existing shop keeps accepting orders (mirrors is_open) and
-- is treated as an active subscriber until the admin explicitly changes it.
UPDATE public.shops SET is_accepting_orders = COALESCE(is_open, true)
  WHERE is_accepting_orders IS NULL;
UPDATE public.shops SET subscription_status = 'active'
  WHERE subscription_status IS NULL;
UPDATE public.shops
   SET subscription_plan = COALESCE(NULLIF(subscription_plan, ''), plan_type, 'free')
 WHERE subscription_plan IS NULL;

COMMENT ON COLUMN public.shops.pricing_tiers IS
  'Tiered bulk discounts: [{"min":1,"max":20,"price":2},{"min":21,"max":50,"price":1.8},{"min":51,"max":null,"price":1.5}] — price is ₹/page; wins over volume_rates at checkout.';
COMMENT ON COLUMN public.shops.is_accepting_orders IS
  'Vendor header toggle — false blocks new customer orders with the "not accepting online orders" banner.';
COMMENT ON COLUMN public.shops.subscription_status IS
  'SaaS subscription state: active | trial | expired. expired locks the vendor dashboard behind the renew banner.';
