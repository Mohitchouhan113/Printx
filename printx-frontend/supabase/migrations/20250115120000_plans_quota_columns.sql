-- Migration: Add quota/feature-gate columns to the existing `plans` table
-- and upsert seed rows matching the static catalog in lib/plans.js.
--
-- Safe to re-run (ADD COLUMN IF NOT EXISTS + ON CONFLICT DO UPDATE).
-- The app code already uses progressive-drop so missing columns degrade
-- gracefully until this migration is applied to the live DB.

ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS max_printers         INTEGER NOT NULL DEFAULT -1;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS max_orders_monthly   INTEGER NOT NULL DEFAULT -1;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS has_whatsapp_bot     BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS has_analytics        BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS has_custom_poster    BOOLEAN NOT NULL DEFAULT false;

-- Upsert seed rows (prices match lib/plans.js exactly)
INSERT INTO public.plans (
  code, name, original_price, offer_price, billing_cycle, features, is_active,
  max_printers, max_orders_monthly, has_whatsapp_bot, has_analytics, has_custom_poster
) VALUES
  (
    'free', 'Free', 0, NULL, 'monthly',
    '["1 Printer Connection","Max 50 Orders/month","Manual Token Queue","Community Support"]',
    true, 1, 50, false, false, false
  ),
  (
    'basic', 'Basic', 349, NULL, 'monthly',
    '["2 Printer Fleet Connections","Max 500 Live Orders/month","Basic Daily Revenue Analytics","Email Support"]',
    true, 2, 500, false, true, false
  ),
  (
    'pro', 'Pro', 1299, NULL, 'monthly',
    '["Up to 4 Printer Connections","Unlimited Orders & Live Queue","Live Efficiency Meter & Analytics","Priority WhatsApp Support","Custom Branding on Receipts"]',
    true, 4, -1, true, true, true
  ),
  (
    'advance', 'Advance', 2499, NULL, 'monthly',
    '["Unlimited Printer Connections","Multi-Branch Support","Automated WhatsApp Customer Alerts","API Access & Custom Billing ERP","24/7 Phone Support"]',
    true, -1, -1, true, true, true
  ),
  (
    'lifetime', 'Lifetime', 1999, NULL, 'lifetime',
    '["Everything in Advance, forever","Unlimited Printers & Orders","All future features included","Zero renewals — ever"]',
    true, -1, -1, true, true, true
  )
ON CONFLICT (code) DO UPDATE SET
  max_printers         = EXCLUDED.max_printers,
  max_orders_monthly   = EXCLUDED.max_orders_monthly,
  has_whatsapp_bot     = EXCLUDED.has_whatsapp_bot,
  has_analytics        = EXCLUDED.has_analytics,
  has_custom_poster    = EXCLUDED.has_custom_poster;

-- Verify: SELECT code, max_printers, max_orders_monthly, has_whatsapp_bot, has_analytics FROM public.plans ORDER BY created_at;
