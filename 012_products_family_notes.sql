-- 012: Add family (category subtitle) and notes (Top/Heart/Base) to products
-- This makes Supabase the FULL source of truth for a product's existence and
-- display — after this, adding a brand new product only requires adding rows
-- here (products + product_variants), with zero website code changes needed.

ALTER TABLE products ADD COLUMN IF NOT EXISTS family text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS notes jsonb;

-- Backfill the 3 existing attars with their current family tag + fragrance notes
UPDATE products SET
  family = 'Oud · Intense',
  notes = '{"Top":"Smoked agarwood","Heart":"Dark resin, leather accord","Base":"Deep woods, warm musk"}'::jsonb
WHERE slug = 'black-oud';

UPDATE products SET
  family = 'Oud · Amber',
  notes = '{"Top":"Saffron, golden honey","Heart":"Radiant oud","Base":"Golden amber, soft woods"}'::jsonb
WHERE slug = 'golden-oud';

UPDATE products SET
  family = 'Floral · Musk',
  notes = '{"Top":"Fresh rose petals","Heart":"Velvet damask rose","Base":"Soft white musk"}'::jsonb
WHERE slug = 'rose-musk';

-- HOW TO ADD A BRAND NEW PRODUCT FROM NOW ON (e.g. launching a Parfum):
-- 1. Insert a row into `products`:
--    INSERT INTO products (slug, name, category, family, description, status, image_url, notes)
--    VALUES ('arabian-knights', 'Arabian Knights', 'parfum', 'Woody · Spiced',
--            'A description of the fragrance.', 'active', 'assets/Parfum/arabian-nights.jpg',
--            '{"Top":"...","Heart":"...","Base":"..."}'::jsonb);
-- 2. Insert its sizes/prices into `product_variants` (one row per size), using the
--    new product's id (copy it from the row you just inserted).
-- That's it — no website files, no re-upload, no redeploy. It appears live immediately.
