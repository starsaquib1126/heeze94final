// GET /api/products
// Returns all visible products with their full display data (name, family,
// notes, description, image) and live sizes/prices/discounts — read entirely
// from Supabase. This is now the SINGLE SOURCE OF TRUTH for which products
// exist on the site: adding a row here means the product appears on the
// live site immediately, with no website code changes needed.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { data: products, error } = await supabase
    .from('products')
    .select(`
      id, slug, name, category, family, description, status, image_url, notes,
      product_variants ( id, size_ml, price, compare_at_price, stock )
    `)
    .neq('status', 'hidden')
    .order('created_at', { ascending: true });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // Reshape to match the format the site's frontend already expects
  const shaped = products.map(p => ({
    id: p.slug,
    name: p.name,
    category: p.category,
    family: p.family || '',
    status: p.status,
    desc: p.description,
    img: p.image_url,
    notes: p.notes || {},
    sizes: p.product_variants
      .map(v => ({
        variantId: v.id,
        ml: v.size_ml,
        price: Number(v.price),
        compareAt: v.compare_at_price ? Number(v.compare_at_price) : null,
        stock: v.stock
      }))
      .sort((a, b) => a.ml - b.ml)
  }));

  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
  return res.status(200).json(shaped);
}
