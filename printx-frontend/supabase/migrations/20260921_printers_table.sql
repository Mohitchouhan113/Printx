-- ============================================================================
-- PrintX — Printers table for Fleet Management
-- ============================================================================
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query).

-- 1. Create the printers table
CREATE TABLE IF NOT EXISTS printers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name          TEXT NOT NULL DEFAULT 'Untitled Printer',
  connection_type TEXT NOT NULL DEFAULT 'LAN_IP',  -- 'LAN_IP' | 'USB_LOCAL'
  ip_address    TEXT,
  port          TEXT,                               -- e.g. 'LPT1', 'COM3', or custom
  is_color      BOOLEAN NOT NULL DEFAULT false,
  is_default    BOOLEAN NOT NULL DEFAULT false,
  status        TEXT NOT NULL DEFAULT 'online',     -- 'online' | 'offline' | 'idle' | 'error'
  model         TEXT,                               -- optional model/brand
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Index for fast shop-level lookups
CREATE INDEX IF NOT EXISTS idx_printers_shop_id ON printers(shop_id);

-- 3. Enable Row Level Security
ALTER TABLE printers ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies — owners see only their shop's printers
--    (adjust to match your existing auth pattern)
DO $$
BEGIN
  -- Drop existing policies if they exist (idempotent)
  DROP POLICY IF EXISTS "printers_select_own" ON printers;
  DROP POLICY IF EXISTS "printers_insert_own" ON printers;
  DROP POLICY IF EXISTS "printers_update_own" ON printers;
  DROP POLICY IF EXISTS "printers_delete_own" ON printers;

  -- Allow authenticated users to SELECT their own shop's printers
  CREATE POLICY "printers_select_own" ON printers
    FOR SELECT USING (
      shop_id IN (
        SELECT id FROM shops WHERE owner_id = auth.uid()
      )
    );

  -- Allow authenticated users to INSERT printers for their own shop
  CREATE POLICY "printers_insert_own" ON printers
    FOR INSERT WITH CHECK (
      shop_id IN (
        SELECT id FROM shops WHERE owner_id = auth.uid()
      )
    );

  -- Allow authenticated users to UPDATE their own shop's printers
  CREATE POLICY "printers_update_own" ON printers
    FOR UPDATE USING (
      shop_id IN (
        SELECT id FROM shops WHERE owner_id = auth.uid()
      )
    );

  -- Allow authenticated users to DELETE their own shop's printers
  CREATE POLICY "printers_delete_own" ON printers
    FOR DELETE USING (
      shop_id IN (
        SELECT id FROM shops WHERE owner_id = auth.uid()
      )
    );
END $$;

-- 5. Enable realtime (optional — for live status updates)
ALTER PUBLICATION supabase_realtime ADD TABLE printers;

-- 6. Seed: no default printers — owners add their own fleet
