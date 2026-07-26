// POST /api/create-order
// Call this when the customer clicks "Continue to secure checkout."
// Creates a Razorpay order and a matching "pending" order in Supabase.
// Body: { items: [{ variantId, quantity }], customer: { name, email, phone, address } }

import { createClient } from '@supabase/supabase-js';
import Razorpay from 'razorpay';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {

  const { items, customer, promoCode } = req.body;
  if (!items || !items.length) {
    return res.status(400).json({ error: 'No items in order' });
  }

  // Check we actually deliver to this address's country before going any further
  const shipCountry = (customer?.address?.country || '').toUpperCase();
  const { data: deliveryCheck } = await supabase
    .from('delivery_countries')
    .select('active')
    .eq('country_code', shipCountry)
    .maybeSingle();
  if (!deliveryCheck || !deliveryCheck.active) {
    return res.status(400).json({ error: 'We currently don\'t deliver to this location.' });
  }

  // Look up real prices from Supabase — never trust prices sent from the browser
  const variantIds = items.map(i => i.variantId);
  const { data: variants, error: variantError } = await supabase
    .from('product_variants')
    .select('id, price, stock')
    .in('id', variantIds);

  if (variantError) return res.status(500).json({ error: variantError.message });

  let subtotal = 0;
  const orderItems = items.map(item => {
    const variant = variants.find(v => v.id === item.variantId);
    if (!variant) throw new Error(`Variant ${item.variantId} not found`);
    if (variant.stock < item.quantity) throw new Error(`Not enough stock for ${item.variantId}`);
    subtotal += Number(variant.price) * item.quantity;
    return { product_variant_id: item.variantId, quantity: item.quantity, price_at_purchase: variant.price };
  });

  // Create (or find) the customer
  const { data: customerRow, error: customerError } = await supabase
    .from('customers')
    .upsert({ email: customer.email, name: customer.name, phone: customer.phone, address: customer.address }, { onConflict: 'email' })
    .select()
    .single();

  if (customerError) return res.status(500).json({ error: customerError.message });

  // Re-validate the promo code server-side — never trust a discount amount
  // sent from the browser, always recompute it here from the real code.
  let discountAmount = 0;
  let appliedPromo = null;
  if (promoCode) {
    const { data: promo } = await supabase
      .from('promo_codes')
      .select('*')
      .eq('code', promoCode.trim().toUpperCase())
      .eq('active', true)
      .maybeSingle();

    const validPromo = promo
      && (!promo.expires_at || new Date(promo.expires_at) > new Date())
      && (promo.max_uses === null || promo.times_used < promo.max_uses)
      && subtotal >= promo.min_order_value;

    let firstOrderOk = true;
    if (validPromo && promo.first_order_only) {
      const { data: priorOrder } = await supabase.from('orders').select('id').eq('customer_id', customerRow.id).eq('status', 'paid').limit(1).maybeSingle();
      firstOrderOk = !priorOrder;
    }

    if (validPromo && firstOrderOk) {
      appliedPromo = promo;
      discountAmount = promo.discount_type === 'percent'
        ? Math.round(subtotal * (promo.discount_value / 100))
        : Math.min(promo.discount_value, subtotal);
    }
  }
  const total = Math.max(subtotal - discountAmount, 0);

  // Create the order in Supabase (status: pending)
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({ customer_id: customerRow.id, email: customer.email, status: 'pending', subtotal, total, shipping_address: customer.address, promo_code: appliedPromo?.code || null, discount_amount: discountAmount })
    .select()
    .single();

  if (orderError) return res.status(500).json({ error: orderError.message });

  await supabase.from('order_items').insert(
    orderItems.map(i => ({ ...i, order_id: order.id }))
  );

  if (appliedPromo) {
    await supabase.from('promo_codes').update({ times_used: appliedPromo.times_used + 1 }).eq('id', appliedPromo.id);
  }

  // Create the actual Razorpay order (amount is in paise, hence *100) — charges the DISCOUNTED total
  const razorpayOrder = await razorpay.orders.create({
    amount: Math.round(total * 100),
    currency: 'INR',
    receipt: order.id
  });

  // Save the Razorpay order ID against our order for later verification
  await supabase.from('orders').update({ razorpay_order_id: razorpayOrder.id }).eq('id', order.id);

  return res.status(200).json({
    orderId: order.id,
    razorpayOrderId: razorpayOrder.id,
    amount: razorpayOrder.amount,
    currency: razorpayOrder.currency,
    keyId: process.env.RAZORPAY_KEY_ID   // safe to expose — it's the public key, used by Razorpay's checkout widget
  });

  } catch (err) {
    return res.status(400).json({ error: err.message || 'Could not complete this order' });
  }
}
