-- 014: Cancellations and Return Requests
--
-- POLICY (as confirmed):
-- - No returns for change of mind — only damaged/wrong/defective items qualify
-- - Orders can be cancelled for a full refund ONLY before dispatch (auto-processed,
--   no manual review needed, since nothing has shipped yet)
-- - Return requests (damage/wrong item) REQUIRE manual review before being approved
-- - Every status change (received / approved / rejected / refunded) emails the customer
-- - All refunds go back to the original payment method via Razorpay

-- New table: one row per return/damage claim
CREATE TABLE IF NOT EXISTS return_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) NOT NULL,
  email text NOT NULL,
  reason text NOT NULL,              -- 'damaged' | 'wrong_item' | 'defective' | 'other'
  description text,                  -- customer's own explanation
  status text NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected' | 'refunded'
  admin_notes text,                  -- optional — shown to the customer if rejected
  created_at timestamptz DEFAULT now(),
  reviewed_at timestamptz
);

ALTER TABLE return_requests ENABLE ROW LEVEL SECURITY;
-- No public policy — exactly like promo_codes and customers, only the backend
-- (using the service role key) can read or write this table.

-- Every order needs a Razorpay refund amount cap (in case of partial refunds later)
-- and to know how much has already been refunded, if anything.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refunded_amount numeric DEFAULT 0;

-- Releases stock back when an order is cancelled or a return is approved —
-- the mirror image of the existing decrement_stock() function used at checkout.
CREATE OR REPLACE FUNCTION increment_stock(variant_id uuid, qty integer)
RETURNS void AS $$
BEGIN
  UPDATE product_variants SET stock = stock + qty WHERE id = variant_id;
END;
$$ LANGUAGE plpgsql;

-- HOW YOU'LL ACTUALLY USE THIS:
--
-- CANCELLATIONS: fully automatic. A customer clicks "Cancel Order" (only shown
-- for orders that haven't shipped yet) — the refund and email happen instantly,
-- no action needed from you.
--
-- RETURN REQUESTS: appear as new rows in this table with status = 'pending'.
-- You'll get an email the moment one comes in. To review it:
--   1. Look at the order_id, reason, and description to judge the claim
--   2. In this table, change `status` to either 'approved' or 'rejected'
--      (optionally fill in `admin_notes` — the customer sees this if rejected)
--   3. Save the row
-- The moment you approve it, the refund is processed automatically via Razorpay
-- and the customer is emailed — same webhook pattern as order status updates.
