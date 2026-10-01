-- ============================================================================
-- PrintX — Supabase Auth: shops.owner_id + vendor-scoped RLS
-- Run once in Supabase Dashboard → SQL Editor (after supabase-admin-setup.sql).
--
-- What it does:
--   1. Adds shops.owner_id (uuid → auth.users.id, nullable for legacy rows).
--   2. Enables RLS on shops with vendor-scoped policies:
--        • vendors can SELECT/UPDATE the shop(s) they own
--        • anonymous users can SELECT basic shop info (needed by the public
--          customer upload page /s/[slug] to resolve shop name/rates/UPI)
--        • INSERT restricted to the authenticated owner (signup flow)
--      NOTE: the admin panel + upload API use the SERVICE-ROLE key which
--      bypasses RLS, so super-admin and server-side flows keep working.
--   3. Auto-updates updated_at if that column exists (no-op otherwise).
-- Idempotent — safe to run repeatedly.
-- ============================================================================

ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- Helpful index for owner-scoped lookups
CREATE INDEX IF NOT EXISTS shops_owner_id_idx ON public.shops (owner_id);

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;

-- Public/anonymous: read shops (customer pages resolve shop by slug)
DROP POLICY IF EXISTS "shops_public_read" ON public.shops;
CREATE POLICY "shops_public_read" ON public.shops
  FOR SELECT TO anon
  USING (true);

-- Vendors: read + update their own shop
DROP POLICY IF EXISTS "shops_owner_read" ON public.shops;
CREATE POLICY "shops_owner_read" ON public.shops
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "shops_owner_update" ON public.shops;
CREATE POLICY "shops_owner_update" ON public.shops
  FOR UPDATE TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Signup flow: an authenticated user can create a shop owned by themselves
DROP POLICY IF EXISTS "shops_owner_insert" ON public.shops;
CREATE POLICY "shops_owner_insert" ON public.shops
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

-- ----------------------------------------------------------------------------
-- Verify (should list the four policies):
-- SELECT policyname, cmd FROM pg_policies WHERE tablename = 'shops';
-- ----------------------------------------------------------------------------
