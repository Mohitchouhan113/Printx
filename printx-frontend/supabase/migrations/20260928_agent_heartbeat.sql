-- Print agent heartbeat — Vendor Dashboard "Printer Status: 🟢 Online"
--
-- Run in the Supabase SQL Editor. Until then the agent's heartbeat
-- degrades gracefully: it logs this hint once, re-probes every 5 minutes,
-- and resumes automatically as soon as the column exists.
--
-- The agent writes shops.last_active_at = now() every 30s for SHOP_ID;
-- the dashboard treats a timestamp newer than ~90s as 🟢 Online.

ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS last_active_at timestamptz;

-- Agent heartbeats run with the anon/service key via PostgREST UPDATE;
-- nothing else needs granting beyond existing RLS on shops.
