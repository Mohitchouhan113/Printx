-- ============================================================================
-- PrintX — announcements (Super Admin global broadcast feed)
--
-- WHY: the Super Admin Broadcast panel and the student/vendor
-- `BroadcastBanner` both talk to `public.announcements` with the browser
-- anon key. If the table exists but has RLS enabled with no policy, every
-- INSERT / UPDATE / DELETE fails with:
--
--     new row violates row-level security policy for table "announcements"
--     (Postgres 42501)
--
-- …which is exactly the "Super Admin cannot broadcast / toggle status" bug.
-- This migration creates the table if absent and adds the permissive policy
-- that matches the rest of the admin surface (`admin_settings`,
-- `system_settings`), which also write from the browser with the anon key.
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → New query → paste this file → Run.
--   Idempotent — safe to run repeatedly.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.announcements (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title      TEXT        NOT NULL,
  message    TEXT        NOT NULL DEFAULT '',
  -- 'system' | 'info' | 'warning' — no CHECK constraint so older rows with
  -- custom values keep loading (the UI falls back to the info style).
  type       TEXT        NOT NULL DEFAULT 'info',
  is_active  BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vendor/student banner reads: active rows newest-first.
CREATE INDEX IF NOT EXISTS announcements_active_created_idx
  ON public.announcements (is_active, created_at DESC);

-- Keep updated_at honest even when a client forgets to send it.
CREATE OR REPLACE FUNCTION public.touch_announcements()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_announcements_touch ON public.announcements;
CREATE TRIGGER trg_announcements_touch
  BEFORE UPDATE ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.touch_announcements();

-- ---------------------------------------------------------------------------
-- RLS — the admin panel writes from the browser with the anon key, exactly
-- like `admin_settings` / `system_settings`. Without a policy here, every
-- admin INSERT/UPDATE/DELETE is rejected with 42501.
-- Common read is intentional: the banner is public platform-wide notice.
-- Tighten to an `admin` claim in production if admin auth moves server-side.
-- ---------------------------------------------------------------------------
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

-- Drop any previous/partial policy with the same name so re-running is clean.
DROP POLICY IF EXISTS "anon_full_access_announcements" ON public.announcements;
CREATE POLICY "anon_full_access_announcements"
  ON public.announcements
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- Explicit grants: harmless if already present, and required on projects
-- where the table was created outside the Supabase dashboard defaults.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.announcements TO anon, authenticated;
