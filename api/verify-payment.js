// POST /api/verify-payment
// Called after Razorpay's checkout widget completes, to confirm the payment
// is genuine before marking the order as paid. This check is essential —
// without it, anyone could fake a "success" message from the browser.
// Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { generateAndSendGstInvoice } from './_lib/gstInvoice.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

/* ── Email helper (Resend) ── */
async function sendEmail(to, subject, html) {
  if (!process.env.RESEND_API_KEY) return; // skip silently if not configured yet
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || 'HEEZE 94 <orders@heeze94.com>',
        to: Array.isArray(to) ? to : [to],
        subject,
        html
      })
    });
  } catch (e) { console.error('Email send failed:', e); }
}

function orderEmailHTML(order, customer, items, isOwner) {
  const itemRows = items.map(i =>
    `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${i.product_name || i.product_variant_id}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center">${i.size || '-'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center">${i.quantity}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right">₹${Number(i.price_at_purchase).toLocaleString('en-IN')}</td>
    </tr>`
  ).join('');

  const addr = order.shipping_address || {};
  const addressStr = [addr.line1, addr.line2, addr.city, addr.state, addr.pincode, addr.country].filter(Boolean).join(', ');

  const discountLine = order.discount_amount > 0
    ? `<tr><td colspan="3" style="padding:8px 12px;text-align:right;color:#888">Discount (${order.promo_code})</td><td style="padding:8px 12px;text-align:right;color:#22c55e">-₹${order.discount_amount}</td></tr>`
    : '';

  return `
  <div style="max-width:600px;margin:0 auto;font-family:Georgia,serif;color:#1a1a1a">
    <div style="text-align:center;padding:24px 0;border-bottom:2px solid #c9a14a">
      <h1 style="margin:0;font-size:24px;letter-spacing:4px;color:#c9a14a">HEEZE 94</h1>
      <p style="margin:6px 0 0;font-size:12px;letter-spacing:2px;color:#888">A LUXURY FRAGRANCE HOUSE</p>
    </div>
    <div style="padding:28px 20px">
      <h2 style="font-size:18px;margin:0 0 16px">${isOwner ? '🎉 New Order Received!' : 'Thank you for your order!'}</h2>
      <p style="font-size:14px;color:#555;line-height:1.6">
        ${isOwner
          ? `<strong>${customer.name}</strong> (${customer.email}${customer.phone ? ', ' + customer.phone : ''}) just placed an order.`
          : `Hi ${customer.name}, your order has been confirmed and we're preparing it with care.`}
      </p>
      <div style="background:#fafafa;border-radius:6px;padding:16px;margin:20px 0">
        <p style="margin:0 0 4px;font-size:12px;color:#888;letter-spacing:1px">ORDER ID</p>
        <p style="margin:0;font-size:16px;font-family:monospace">${order.id.slice(0, 8).toUpperCase()}</p>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
        <tr style="background:#f5f5f5">
          <th style="padding:8px 12px;text-align:left">Item</th>
          <th style="padding:8px 12px;text-align:center">Size</th>
          <th style="padding:8px 12px;text-align:center">Qty</th>
          <th style="padding:8px 12px;text-align:right">Price</th>
        </tr>
        ${itemRows}
        ${discountLine}
        <tr style="font-weight:bold">
          <td colspan="3" style="padding:10px 12px;text-align:right;border-top:2px solid #c9a14a">Total</td>
          <td style="padding:10px 12px;text-align:right;border-top:2px solid #c9a14a">₹${Number(order.total).toLocaleString('en-IN')}</td>
        </tr>
      </table>
      ${isOwner ? `<div style="margin:16px 0;padding:12px;background:#f0f8ff;border-radius:4px;font-size:13px"><strong>Ship to:</strong> ${addressStr}</div>` : ''}
      ${!isOwner ? `<p style="font-size:14px;color:#555;line-height:1.6">We'll notify you when your order ships. For any queries, reply to this email or reach us at <a href="mailto:contact@heeze94.com" style="color:#c9a14a">contact@heeze94.com</a></p>` : ''}
    </div>
    <div style="text-align:center;padding:20px;border-top:1px solid #eee;font-size:11px;color:#999;letter-spacing:1px">
      HEEZE 94 · Crafted in Dubai
    </div>
  </div>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  // Recreate the expected signature using our secret key, and compare.
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
    .select('id, total, subtotal, shipping_address, promo_code, discount_amount, customer_id, email')
    .single();

  if (orderError) return res.status(500).json({ error: orderError.message });

  // Fetch order items with product names for the email
  const { data: items } = await supabase
    .from('order_items')
    .select('product_variant_id, quantity, price_at_purchase')
    .eq('order_id', order.id);

  // Decrement stock. Wrapped so a failure here (a missing/broken DB function,
  // a stale variant ID, etc.) can never silently prevent the emails below from
  // sending -- the order is already correctly marked "paid" by this point,
  // so a stock-tracking hiccup shouldn't cost the owner their notification.
  for (const item of items) {
    try {
      await supabase.rpc('decrement_stock', { variant_id: item.product_variant_id, qty: item.quantity });
    } catch (e) {
      console.error('Stock decrement failed for', item.product_variant_id, e);
    }
  }

  // Fetch customer details + variant names for the email
  const { data: customer } = await supabase
    .from('customers')
    .select('name, email, phone')
    .eq('id', order.customer_id)
    .single();

  // Enrich items with product names and sizes
  const variantIds = items.map(i => i.product_variant_id);
  const { data: variants } = await supabase
    .from('product_variants')
    .select('id, size, product:products(name)')
    .in('id', variantIds);

  const enrichedItems = items.map(item => {
    const v = variants?.find(vr => vr.id === item.product_variant_id);
    return {
      ...item,
      product_name: v?.product?.name || item.product_variant_id,
      size: v?.size || '-'
    };
  });

  // Send emails (non-blocking — don't let email failure break the order)
  const ownerEmail = process.env.OWNER_NOTIFICATION_EMAIL || 'heeze94official@gmail.com';
  const customerEmail = customer?.email || order.email;

  const emailOrder = { ...order };
  const emailCustomer = customer || { name: 'Customer', email: customerEmail, phone: '' };

  // Owner notification
  sendEmail(
    ownerEmail,
    `🎉 New Order #${order.id.slice(0, 8).toUpperCase()} — ₹${Number(order.total).toLocaleString('en-IN')}`,
    orderEmailHTML(emailOrder, emailCustomer, enrichedItems, true)
  );

  // Customer confirmation
  if (customerEmail) {
    sendEmail(
      customerEmail,
      `Your HEEZE 94 Order Confirmation — #${order.id.slice(0, 8).toUpperCase()}`,
      orderEmailHTML(emailOrder, emailCustomer, enrichedItems, false)
    );
  }

  // GST tax invoice -- generated and emailed to both the customer and the
  // owner right now, at payment confirmation. This is the legally correct
  // timing (invoices must be issued at or before dispatch, not after
  // delivery) and doesn't depend on remembering to mark orders "delivered".
  try {
    await generateAndSendGstInvoice(supabase, { ...order, email: customerEmail });
  } catch (e) {
    console.error('GST invoice generation failed for order', order.id, e);
  }

  return res.status(200).json({ success: true, orderId: order.id });
}
