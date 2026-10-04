-- PrintX — Bug fix: vendor phone numbers were never persisted.
--
-- Root cause: the `shops` table never received a `phone` column, so every
-- write path (signup insert, admin create-vendor, Settings save) had its
-- `phone` field silently dropped by the schema-drift retry logic
-- (PGRST204 / "Could not find the 'phone' column of 'shops'").
--
-- Run in the Supabase SQL editor (or `supabase db push`). Safe to re-run.

ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS phone text;

COMMENT ON COLUMN public.shops.phone IS
  'Vendor contact number captured at signup / editable in Dashboard → Settings.';

-- Quick verification (should return your shops with the new column):
-- SELECT id, slug, name, phone FROM public.shops LIMIT 10;
