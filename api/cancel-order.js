// POST /api/cancel-order
// Lets a customer cancel their own order for a full, instant refund — but
// ONLY if it hasn't been dispatched yet. No manual review needed here,
// since nothing has shipped and there's no cost to the business in undoing it.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function sendEmail(to, subject, html) {
  if (!process.env.RESEND_API_KEY) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || 'HEEZE 94 <orders@heeze94.com>',
        to: Array.isArray(to) ? to : [to],
        subject,
        html
      })
    });
    return res.ok;
  } catch (e) {
    console.error('Email send failed:', e);
    return false;
  }
}

// Statuses that mean "hasn't shipped yet" — safe to cancel.
// 'pending' = checkout started but payment never completed (no razorpay_payment_id,
// so the refund block below is skipped — nothing was ever charged).
const CANCELLABLE_STATUSES = ['pending', 'payment_failed', 'created', 'paid', 'processing'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { orderId, email } = req.body || {};
  if (!orderId || !email) {
    return res.status(400).json({ error: 'Missing order details' });
  }

  const { data: order, error } = await supabase
    .from('orders')
    .select('id, email, total, status, razorpay_payment_id')
    .eq('id', orderId)
    .single();

  if (error || !order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  // Only the customer who placed the order can cancel it
  if (order.email !== email) {
    return res.status(403).json({ error: 'This order does not belong to you' });
  }

  if (!CANCELLABLE_STATUSES.includes(order.status)) {
    return res.status(400).json({ error: 'This order has already been dispatched and can no longer be cancelled here — please request a return instead.' });
  }

  // Process the Razorpay refund (full amount, instant speed)
  if (order.razorpay_payment_id) {
    try {
      const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
      const refundRes = await fetch(`https://api.razorpay.com/v1/payments/${order.razorpay_payment_id}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
        body: JSON.stringify({ speed: 'optimum' })
      });
      if (!refundRes.ok) {
        const errText = await refundRes.text();
        console.error('Razorpay refund failed:', refundRes.status, errText);
        return res.status(502).json({ error: 'Could not process the refund right now — please contact us directly.' });
      }
    } catch (e) {
      console.error('Refund error:', e);
      return res.status(502).json({ error: 'Could not process the refund right now — please contact us directly.' });
    }
  }

  // Mark the order cancelled and release its reserved stock
  await supabase
    .from('orders')
    .update({ status: 'cancelled', refunded_amount: order.total })
    .eq('id', orderId);

  const { data: items } = await supabase
    .from('order_items')
    .select('product_variant_id, quantity')
    .eq('order_id', orderId);

  for (const item of items || []) {
    await supabase.rpc('increment_stock', { variant_id: item.product_variant_id, qty: item.quantity });
  }

  const ownerEmail = process.env.OWNER_NOTIFICATION_EMAIL || 'heeze94official@gmail.com';
  const wasActuallyPaid = !!order.razorpay_payment_id;
  const bodyText = wasActuallyPaid
    ? `Your order has been cancelled and a full refund of ₹${Number(order.total).toLocaleString('en-IN')} is on its way back to your original payment method — this usually takes 5-7 working days to reflect.`
    : `Your order has been cancelled as requested. As this order was never charged, there's no refund needed on your end — we'd love to welcome you back whenever you're ready.`;
  const html = `
  <div style="max-width:560px;margin:0 auto;font-family:Georgia,serif;color:#1a1a1a">
    <div style="text-align:center;padding:24px 0;border-bottom:2px solid #c9a14a">
      <h1 style="margin:0;font-size:24px;letter-spacing:4px;color:#c9a14a">HEEZE 94</h1>
      <p style="margin:6px 0 0;font-size:12px;letter-spacing:2px;color:#888">ORDER CANCELLED</p>
    </div>
    <div style="padding:28px 20px;font-size:14px;line-height:1.7;color:#333">
      <p>${bodyText}</p>
      <p style="margin-top:16px;font-size:12px;color:#999">Order ID: ${order.id.slice(0, 8).toUpperCase()}</p>
    </div>
  </div>`;

  sendEmail(order.email, `Your HEEZE 94 Order Has Been Cancelled — #${order.id.slice(0, 8).toUpperCase()}`, html);
  sendEmail(ownerEmail, `Order Cancelled by Customer — #${order.id.slice(0, 8).toUpperCase()}${wasActuallyPaid ? '' : ' (was never paid)'}`, html);

  return res.status(200).json({ success: true });
}
