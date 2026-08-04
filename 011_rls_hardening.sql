-- 011: RLS Hardening
-- Run 010 first and review the results before running this.
-- This ensures anonymous site visitors (using just the public/anon key,
-- visible to anyone via browser DevTools) can ONLY read product listings —
-- never edit prices, stock, promo codes, or see other customers' data.
-- All real writes (orders, stock changes, promo usage) already happen
-- through your /api/*.js backend files using the SERVICE ROLE key, which
-- bypasses RLS entirely and is never exposed to the browser — so tightening
-- these policies won't break your checkout flow.

-- Enable RLS on every relevant table (safe to re-run if already enabled)
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_countries ENABLE ROW LEVEL SECURITY;

-- ── PRODUCTS: anyone can view, nobody can write via the public key ──
DROP POLICY IF EXISTS "Public can view products" ON products;
CREATE POLICY "Public can view products" ON products
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Public can view variants" ON product_variants;
CREATE POLICY "Public can view variants" ON product_variants
  FOR SELECT TO anon, authenticated USING (true);

-- ── DELIVERY COUNTRIES: anyone can view (checkout needs to check this) ──
DROP POLICY IF EXISTS "Public can view delivery countries" ON delivery_countries;
CREATE POLICY "Public can view delivery countries" ON delivery_countries
  FOR SELECT TO anon, authenticated USING (true);

-- ── PROMO CODES: nobody can read the full list or edit via the public key ──
-- (Your /api/create-order.js already validates codes using the service role key,
-- which bypasses RLS — so promo codes still work at checkout.)
DROP POLICY IF EXISTS "No public access to promo codes" ON promo_codes;
-- Intentionally NO policy for anon/authenticated = no access at all by default.

-- ── CUSTOMERS: nobody can read or write via the public key ──
-- (Your backend uses the service role key to create/update customer records.)
DROP POLICY IF EXISTS "No public access to customers" ON customers;
-- Intentionally NO policy for anon = no access by default.

-- ── ORDERS: signed-in users can only see their OWN orders (from earlier) ──
-- This policy already exists from 008, but re-asserting it here for completeness.
DROP POLICY IF EXISTS "Users can view own orders" ON orders;
CREATE POLICY "Users can view own orders" ON orders
  FOR SELECT TO authenticated
  USING (email = auth.jwt() ->> 'email');

DROP POLICY IF EXISTS "Users can view own order items" ON order_items;
CREATE POLICY "Users can view own order items" ON order_items
  FOR SELECT TO authenticated
  USING (order_id IN (SELECT id FROM orders WHERE email = auth.jwt() ->> 'email'));

-- Note: anonymous (not-signed-in) visitors get NO read/write access to
-- orders, order_items, customers, or promo_codes at all — as it should be.
