-- ============================================================================
-- PrintX — Supabase setup: shop row, storage bucket, RLS
-- Run this ONCE in the Supabase Dashboard → SQL Editor.
-- Fixes: "Shop not found" / "Shop setup needed" badge / "Bucket not found".
-- ============================================================================

-- 1. Default shop row (idempotent) -------------------------------------------
INSERT INTO shops (slug, name, upi_id, bw_rate, color_rate)
VALUES ('sharma_xerox', 'Sharma Xerox', 'sharma-xerox@upi', 2, 10)
ON CONFLICT (slug) DO NOTHING;

-- 2. Storage bucket for print uploads (public-read so vendor can print) ------
INSERT INTO storage.buckets (id, name, public)
VALUES ('print-uploads', 'print-uploads', true)
ON CONFLICT (id) DO NOTHING;

-- 3. RLS: allow the anon key to insert shops and read them --------------------
--    (Needed so client-side auto-provisioning and rate display work.)
ALTER TABLE shops ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read shops" ON shops;
CREATE POLICY "public read shops"
  ON shops FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "public insert shops" ON shops;
CREATE POLICY "public insert shops"
  ON shops FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- 4. print_jobs: anon can read (queue) + insert (customer orders) -------------
ALTER TABLE print_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read print_jobs" ON print_jobs;
CREATE POLICY "public read print_jobs"
  ON print_jobs FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "public insert print_jobs" ON print_jobs;
CREATE POLICY "public insert print_jobs"
  ON print_jobs FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "public update print_jobs" ON print_jobs;
CREATE POLICY "public update print_jobs"
  ON print_jobs FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- 5. Storage policies for the bucket ------------------------------------------
DROP POLICY IF EXISTS "public read print uploads" ON storage.objects;
CREATE POLICY "public read print uploads"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'print-uploads');

DROP POLICY IF EXISTS "public insert print uploads" ON storage.objects;
CREATE POLICY "public insert print uploads"
  ON storage.objects FOR INSERT
  TO anon, authenticated
  WITH CHECK (bucket_id = 'print-uploads');

-- 6. Realtime for print_jobs ---------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'print_jobs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE print_jobs;
  END IF;
END $$;

-- Done. The vendor dashboard badge should now show "● Realtime connected"
-- and customer orders will insert with the resolved sharma_xerox shop id.
