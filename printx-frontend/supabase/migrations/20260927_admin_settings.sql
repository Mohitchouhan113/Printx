-- ============================================================================
-- PrintX — admin_settings (Super Admin platform settings KV store)
--
-- WHY: the Super Admin panel stores its Phone Number, Offer banner and Plan
-- flags in one place so a page refresh always reloads the exact saved values.
-- Shape mirrors `system_settings` (key/value/updated_at) so the app code can
-- transparently fall back to `system_settings` until this migration runs.
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New query → paste this file → Run.
--   Idempotent — safe to run repeatedly.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.admin_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Keep updated_at honest even when a client forgets to send it.
CREATE OR REPLACE FUNCTION public.touch_admin_settings()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_admin_settings_touch ON public.admin_settings;
CREATE TRIGGER trg_admin_settings_touch
  BEFORE UPDATE ON public.admin_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_admin_settings();

-- ---------------------------------------------------------------------------
-- RLS — the admin panel writes from the browser with the anon key, exactly
-- like `system_settings` / `announcements`. Tighten to an `admin` claim in
-- production if you move admin auth server-side.
-- ---------------------------------------------------------------------------
ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_full_access_admin_settings" ON public.admin_settings;
CREATE POLICY "anon_full_access_admin_settings"
  ON public.admin_settings
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Seed rows (only if absent) so first load never renders empty state.
-- ---------------------------------------------------------------------------
INSERT INTO public.admin_settings (key, value) VALUES
  ('platform_phone',  '{"phone": ""}'::jsonb),
  ('platform_offers', '{"enabled": false, "headline": "", "code": "", "note": ""}'::jsonb),
  ('platform_plans',  '{"enabled": []}'::jsonb)
ON CONFLICT (key) DO NOTHING;
