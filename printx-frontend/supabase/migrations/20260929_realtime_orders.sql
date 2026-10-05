-- ============================================================================
-- PrintX — Realtime: publish `print_jobs` and `orders` to Supabase Realtime
-- ============================================================================
--
-- WHY:
--   The vendor live queue subscribes to postgres_changes INSERT/UPDATE on
--   both tables. If a table is not a member of the `supabase_realtime`
--   publication, the channel SUBSCRIBES successfully but NO row events are
--   ever delivered — the dashboard then silently shows a stale/empty queue
--   while orders are in fact sitting in the database.
--
-- HOW TO RUN (Supabase Dashboard → SQL Editor, or `supabase db execute`):
--   1. Open SQL Editor in the Supabase dashboard.
--   2. Paste this whole file and click Run.
--   3. Confirm: the verification SELECT at the bottom lists print_jobs
--      and orders. Reload /vendor/dashboard afterwards.
--
-- Safe to run repeatedly — the DO block is idempotent.
-- ============================================================================

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['print_jobs', 'orders'] LOOP
    -- Add the table to the realtime publication only when it is missing,
    -- so re-running this migration never raises "already member of publication".
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables pt
      WHERE pt.pubname = 'supabase_realtime'
        AND pt.schemaname = 'public'
        AND pt.tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      RAISE NOTICE 'Added public.% to supabase_realtime', t;
    ELSE
      RAISE NOTICE 'public.% already in supabase_realtime', t;
    END IF;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- RLS: the vendor dashboard reads with the anon/authenticated key. Postgres
-- changes are only delivered to a subscriber when that role passes RLS on the
-- table. Grant SELECT to the roles the app authenticates with so realtime
-- events reach the dashboard.
--
-- NOTE: these policies are read-only (SELECT). INSERT/UPDATE still go through
-- the service-role route handlers (/api/upload, /api/jobs/*), which bypass RLS.
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'print_jobs' AND policyname = 'print_jobs_realtime_select'
  ) THEN
    EXECUTE $p$
      CREATE POLICY print_jobs_realtime_select ON public.print_jobs
        FOR SELECT TO anon, authenticated USING (true)
    $p$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'orders' AND policyname = 'orders_realtime_select'
  ) THEN
    EXECUTE $p$
      CREATE POLICY orders_realtime_select ON public.orders
        FOR SELECT TO anon, authenticated USING (true)
    $p$;
  END IF;
END $$;

-- ============================================================================
-- VERIFICATION — run this after applying; expect TWO rows (print_jobs, orders)
-- ============================================================================
-- SELECT pubname, schemaname, tablename
--   FROM pg_publication_tables
--  WHERE pubname = 'supabase_realtime'
--    AND tablename IN ('print_jobs', 'orders');