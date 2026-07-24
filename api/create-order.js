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

  const { items, customer } = req.body;
  if (!items || !items.length) {
    return res.status(400).json({ error: 'No items in order' });
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

  // Create the order in Supabase (status: pending)
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .insert({ customer_id: customerRow.id, status: 'pending', subtotal, total: subtotal, shipping_address: customer.address })
    .select()
    .single();

  if (orderError) return res.status(500).json({ error: orderError.message });

  await supabase.from('order_items').insert(
    orderItems.map(i => ({ ...i, order_id: order.id }))
  );

  // Create the actual Razorpay order (amount is in paise, hence *100)
  const razorpayOrder = await razorpay.orders.create({
    amount: Math.round(subtotal * 100),
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
}
