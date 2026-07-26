-- 008: Allow signed-in users to view their own orders
-- Run this in Supabase SQL Editor AFTER the earlier schema files.

-- Policy: authenticated users can SELECT their own orders (matched by email)
CREATE POLICY IF NOT EXISTS "Users can view own orders"
  ON orders
  FOR SELECT
  TO authenticated
  USING (email = auth.jwt() ->> 'email');

-- Policy: authenticated users can SELECT their own order items
CREATE POLICY IF NOT EXISTS "Users can view own order items"
  ON order_items
  FOR SELECT
  TO authenticated
  USING (
    order_id IN (
      SELECT id FROM orders WHERE email = auth.jwt() ->> 'email'
    )
  );
