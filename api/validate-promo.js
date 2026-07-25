// POST /api/validate-promo
// Checks a promo code and returns the discount, without creating an order yet.
// Used to show "Code applied — 10% off" in the cart before checkout.
// Body: { code, subtotal }

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code, subtotal, email } = req.body;
  if (!code) return res.status(400).json({ error: 'No code provided' });

  const { data: promo, error } = await supabase
    .from('promo_codes')
    .select('*')
    .eq('code', code.trim().toUpperCase())
    .eq('active', true)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!promo) return res.status(404).json({ error: 'That code isn\'t valid' });

  if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
    return res.status(400).json({ error: 'That code has expired' });
  }
  if (promo.max_uses !== null && promo.times_used >= promo.max_uses) {
    return res.status(400).json({ error: 'That code has reached its usage limit' });
  }
  if (subtotal < promo.min_order_value) {
    return res.status(400).json({ error: `This code needs a minimum order of ₹${promo.min_order_value}` });
  }
  if (promo.first_order_only) {
    if (!email) return res.status(400).json({ error: 'Sign in or enter your email to use this code' });
    const { data: existingCustomer } = await supabase.from('customers').select('id').eq('email', email).maybeSingle();
    if (existingCustomer) {
      const { data: priorOrder } = await supabase.from('orders').select('id').eq('customer_id', existingCustomer.id).eq('status', 'paid').limit(1).maybeSingle();
      if (priorOrder) return res.status(400).json({ error: 'This code is for first orders only' });
    }
  }

  const discount = promo.discount_type === 'percent'
    ? Math.round(subtotal * (promo.discount_value / 100))
    : Math.min(promo.discount_value, subtotal);

  return res.status(200).json({
    valid: true,
    code: promo.code,
    discountType: promo.discount_type,
    discountValue: promo.discount_value,
    discountAmount: discount
  });
}
