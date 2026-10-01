-- Direct UPI app deep-link checkout (2026-09-28)
--
-- The checkout launches phonepe:// / gpay:// / upi:// deep links with
-- tr={order id}; when the customer returns, /api/payment/confirm-direct-upi
-- marks the order 'PENDING_VERIFICATION' (no UTR captured) or 'PAID'
-- (UTR/bank verified later). Until this migration runs the API writes the
-- same state into the system_settings KV (key `upi_intent_tx::{orderId}`)
-- and the write to `payment_status` is dropped gracefully by its
-- progressive-column-drop loop — run this in the Supabase SQL Editor to
-- persist it on the order row itself (no code change needed after).

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_status text;

COMMENT ON COLUMN public.orders.payment_status IS
  'Payment verification state: UNPAID | PAID | PENDING_VERIFICATION (direct UPI deep-link checkout).';

-- Backfill: anything already settled online/cash gets a definite state.
UPDATE public.orders
SET payment_status = CASE
  WHEN payment_method IN ('razorpay', 'wallet') THEN 'PAID'
  WHEN payment_method = 'cash' THEN 'UNPAID'
  ELSE payment_status
END
WHERE payment_status IS NULL;

CREATE INDEX IF NOT EXISTS orders_payment_status_idx
  ON public.orders (payment_status)
  WHERE payment_status IS NOT NULL;
