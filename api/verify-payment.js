// POST /api/verify-payment
// Called after Razorpay's checkout widget completes, to confirm the payment
// is genuine before marking the order as paid. This check is essential —
// without it, anyone could fake a "success" message from the browser.
// Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  // Recreate the expected signature using our secret key, and compare.
  // If it doesn't match, the payment did not genuinely come from Razorpay.
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (expectedSignature !== razorpay_signature) {
    return res.status(400).json({ error: 'Payment verification failed' });
  }

  // Signature is valid — mark the order paid and reduce stock
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .update({ status: 'paid', razorpay_payment_id })
    .eq('razorpay_order_id', razorpay_order_id)
    .select('id')
    .single();

  if (orderError) return res.status(500).json({ error: orderError.message });

  const { data: items } = await supabase
    .from('order_items')
    .select('product_variant_id, quantity')
    .eq('order_id', order.id);

  for (const item of items) {
    await supabase.rpc('decrement_stock', { variant_id: item.product_variant_id, qty: item.quantity });
  }

  return res.status(200).json({ success: true, orderId: order.id });
}
