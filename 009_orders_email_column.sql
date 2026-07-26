-- 009: Add email column to orders table
-- This allows signed-in users to query their own orders directly,
-- and makes the order notification emails simpler.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS email text;

-- Backfill any existing orders with email from customers table
UPDATE orders SET email = c.email
FROM customers c
WHERE orders.customer_id = c.id AND orders.email IS NULL;

-- Index for fast lookup by email
CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(email);
