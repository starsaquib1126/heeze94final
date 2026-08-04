-- 013: Order tracking + automatic status-change emails
-- Adds tracking info to orders, and sets up the pieces needed so that
-- changing an order's status in Supabase automatically emails the customer.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_url text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS courier_name text DEFAULT 'DTDC';

-- HOW TO SHIP AN ORDER (once your courier has picked it up):
-- 1. Go to the `orders` table in Supabase
-- 2. Find the order, and fill in:
--    - tracking_number: the DTDC consignment/AWB number
--    - tracking_url: if DTDC gave you a direct tracking link for this
--      shipment, paste it here. If not, leave this blank — the customer
--      will be sent to DTDC's general tracking page instead, where they
--      paste in the tracking number themselves.
-- 3. Change `status` to 'shipped'
-- 4. Save the row
--
-- The moment you save, a webhook (set up separately in the Supabase
-- dashboard — see the setup guide provided alongside this file) calls
-- the website's backend, which automatically emails the customer their
-- tracking number and a "Track Your Package" link.
