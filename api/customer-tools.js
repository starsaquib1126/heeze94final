// POST /api/customer-tools
// Handles two lightweight, related customer-facing actions in ONE file —
// kept together deliberately because the Vercel Hobby plan caps serverless
// functions at 12, and this project is already at that ceiling.
//
// Body: { action: 'notify-me', email, variantId }
//   -> Records interest in a sold-out size/variant. Silent no-op on duplicate
//      signup (same email + variant) rather than erroring, since re-submitting
//      is a harmless, common user action, not a real failure.
//
// Body: { action: 'track-order', orderId, email }
//   -> Looks up an order's current status and tracking number. Requires BOTH
//      the order ID and the email on it — this is the only "auth" a guest
//      checkout has, so it's deliberately treated as sensitive: no email match
//      means no data is returned, regardless of whether the order ID exists.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action } = req.body || {};

  try {
    if (action === 'notify-me') {
      return await handleNotifyMe(req, res);
    }
    if (action === 'track-order') {
      return await handleTrackOrder(req, res);
    }
    if (action === 'get-referral-code') {
      return await handleGetReferralCode(req, res);
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Something went wrong' });
  }
}

async function handleNotifyMe(req, res) {
  const { email, variantId } = req.body;
  const cleanEmail = (email || '').trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  if (!variantId) {
    return res.status(400).json({ error: 'Missing product variant' });
  }

  const { error } = await supabase
    .from('stock_notifications')
    .upsert({ email: cleanEmail, product_variant_id: variantId }, { onConflict: 'email,product_variant_id', ignoreDuplicates: true });

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ success: true });
}

async function handleGetReferralCode(req, res) {
  const { email } = req.body;
  const cleanEmail = (email || '').trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@')) {
    return res.status(400).json({ error: 'A valid email is required' });
  }

  // Ensure a customers row exists (a signed-in visitor who's never checked out
  // yet won't have one — create a bare-minimum one here, same upsert pattern
  // create-order.js already uses).
  const { data: customerRow, error: customerError } = await supabase
    .from('customers')
    .upsert({ email: cleanEmail }, { onConflict: 'email', ignoreDuplicates: false })
    .select()
    .single();
  if (customerError) return res.status(500).json({ error: customerError.message });

  // Already has a referral code? Return it with usage stats.
  const { data: existing } = await supabase
    .from('promo_codes')
    .select('code, times_used')
    .eq('owner_customer_id', customerRow.id)
    .eq('is_referral', true)
    .maybeSingle();
  if (existing) {
    return res.status(200).json({ code: existing.code, timesUsed: existing.times_used });
  }

  // First time — generate and create one. Uses part of the customer's own
  // row id so it's naturally unique without a retry loop.
  const code = 'FRIEND' + customerRow.id.replace(/-/g, '').slice(0, 6).toUpperCase();
  const { data: created, error: createError } = await supabase
    .from('promo_codes')
    .insert({
      code,
      discount_type: 'percent',
      discount_value: 10,
      min_order_value: 0,
      max_uses: null,
      active: true,
      first_order_only: true,
      owner_customer_id: customerRow.id,
      is_referral: true
    })
    .select()
    .single();
  if (createError) return res.status(500).json({ error: createError.message });

  return res.status(200).json({ code: created.code, timesUsed: 0 });
}

async function handleTrackOrder(req, res) {
  const { orderId, email } = req.body;
  const cleanOrderId = (orderId || '').trim();
  const cleanEmail = (email || '').trim().toLowerCase();
  if (!cleanOrderId || !cleanEmail) {
    return res.status(400).json({ error: 'Order ID and email are both required' });
  }

  const { data: order } = await supabase
    .from('orders')
    .select('id, status, created_at, total, tracking_number, email')
    .eq('id', cleanOrderId)
    .maybeSingle();

  // Deliberately identical error for "not found" and "wrong email" — never reveal
  // whether an order ID exists to someone who doesn't already know the email on it.
  if (!order || order.email.toLowerCase() !== cleanEmail) {
    return res.status(404).json({ error: 'No matching order found. Check your Order ID and email.' });
  }

  const { data: items } = await supabase
    .from('order_items')
    .select('quantity, price_at_purchase, product_variants(ml, products(name))')
    .eq('order_id', order.id);

  return res.status(200).json({
    id: order.id,
    status: order.status,
    createdAt: order.created_at,
    total: order.total,
    trackingNumber: order.tracking_number || null,
    dtdcTrackingUrl: order.tracking_number ? 'https://www.dtdc.com/track-your-shipment/' : null,
    items: (items || []).map(i => ({
      name: i.product_variants?.products?.name || 'Item',
      ml: i.product_variants?.ml,
      quantity: i.quantity,
      price: i.price_at_purchase
    }))
  });
}
