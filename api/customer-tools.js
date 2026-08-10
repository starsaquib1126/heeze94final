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
import Razorpay from 'razorpay';
import { generateAndSendGstInvoice } from './_lib/gstInvoice.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

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
    if (action === 'submit-review') {
      return await handleSubmitReview(req, res);
    }
    if (action === 'get-reviews') {
      return await handleGetReviews(req, res);
    }
    if (action === 'admin-list-orders') {
      return await handleAdminListOrders(req, res);
    }
    if (action === 'admin-update-order') {
      return await handleAdminUpdateOrder(req, res);
    }
    if (action === 'resume-payment') {
      return await handleResumePayment(req, res);
    }
    if (action === 'admin-export-orders') {
      return await handleAdminExportOrders(req, res);
    }
    if (action === 'admin-generate-invoice') {
      return await handleAdminGenerateInvoice(req, res);
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
    .select('id, status, created_at, total, tracking_number, email, is_delayed, delay_note, delayed_until')
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
    isDelayed: !!order.is_delayed,
    delayNote: order.delay_note || null,
    delayedUntil: order.delayed_until || null,
    items: (items || []).map(i => ({
      name: i.product_variants?.products?.name || 'Item',
      ml: i.product_variants?.ml,
      quantity: i.quantity,
      price: i.price_at_purchase
    }))
  });
}

async function handleSubmitReview(req, res) {
  const { productId, email, name, rating, comment } = req.body;
  const cleanEmail = (email || '').trim().toLowerCase();
  const cleanName = (name || '').trim().slice(0, 80);
  const cleanComment = (comment || '').trim().slice(0, 1000);
  const numRating = Number(rating);

  if (!productId) return res.status(400).json({ error: 'Missing product' });
  if (!cleanEmail || !cleanEmail.includes('@')) return res.status(400).json({ error: 'A valid email is required' });
  if (!numRating || numRating < 1 || numRating > 5) return res.status(400).json({ error: 'Rating must be between 1 and 5' });

  // Verified purchase check: does this email have a paid/shipped/delivered order
  // containing a variant of this product? Two simple queries rather than one
  // complex embedded join, to stay robust against exact FK-relationship naming.
  let verifiedPurchase = false;
  const { data: variants } = await supabase.from('product_variants').select('id').eq('product_id', productId);
  const variantIds = (variants || []).map(v => v.id);
  if (variantIds.length) {
    const { data: matchingItems } = await supabase
      .from('order_items')
      .select('order_id, orders!inner(email, status)')
      .in('product_variant_id', variantIds)
      .eq('orders.email', cleanEmail)
      .in('orders.status', ['paid', 'shipped', 'delivered']);
    verifiedPurchase = (matchingItems || []).length > 0;
  }

  const { error } = await supabase.from('product_reviews').insert({
    product_id: productId,
    customer_email: cleanEmail,
    customer_name: cleanName || null,
    rating: numRating,
    comment: cleanComment || null,
    verified_purchase: verifiedPurchase
  });
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ success: true, verifiedPurchase });
}

async function handleGetReviews(req, res) {
  const { productId } = req.body;
  if (!productId) return res.status(400).json({ error: 'Missing product' });

  const { data: reviews, error } = await supabase
    .from('product_reviews')
    .select('customer_name, rating, comment, verified_purchase, created_at')
    .eq('product_id', productId)
    .eq('approved', true)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: error.message });

  const list = reviews || [];
  const average = list.length ? list.reduce((s, r) => s + r.rating, 0) / list.length : 0;

  return res.status(200).json({
    count: list.length,
    average: Math.round(average * 10) / 10,
    reviews: list.map(r => ({
      name: r.customer_name || 'Anonymous',
      rating: r.rating,
      comment: r.comment,
      verified: r.verified_purchase,
      date: r.created_at
    }))
  });
}

function checkAdminSecret(req) {
  return !!process.env.SUPABASE_WEBHOOK_SECRET && req.body.secret === process.env.SUPABASE_WEBHOOK_SECRET;
}

async function handleAdminListOrders(req, res) {
  // Reuses the SAME shared secret as the cron endpoint, rather than building
  // separate admin auth infrastructure — good enough for a single-owner store,
  // not intended as a multi-admin permission system.
  if (!checkAdminSecret(req)) return res.status(401).json({ error: 'Unauthorized' });

  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, email, status, created_at, total, tracking_number, gift_note, is_gift, is_delayed, delay_note, delayed_until, shipping_address, invoice_number, customers(name, phone)')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({
    orders: (orders || []).map(o => {
      // Internal bookkeeping only -- never shown to customers, never added to
      // what they're charged. 2% + 18% GST on that fee, India orders only
      // (matches typical domestic payment-gateway cost); computed as a real
      // rupee figure so it's actually useful for reconciling accounts.
      const isIndia = (o.shipping_address?.country || '').toUpperCase() === 'IN';
      const platformFeeBase = isIndia ? Math.round(o.total * 0.02) : null;
      const platformFeeGst = isIndia ? Math.round(platformFeeBase * 0.18) : null;
      const platformFeeTotal = isIndia ? platformFeeBase + platformFeeGst : null;
      return {
        ...o,
        customer_name: o.customers?.name || null,
        customer_phone: o.customers?.phone || null,
        platform_fee_total: platformFeeTotal
      };
    })
  });
}

async function handleAdminUpdateOrder(req, res) {
  if (!checkAdminSecret(req)) return res.status(401).json({ error: 'Unauthorized' });

  const { orderId, status, trackingNumber, isDelayed, delayNote, delayedUntil } = req.body;
  if (!orderId) return res.status(400).json({ error: 'Missing order ID' });

  const update = {};
  if (status) update.status = status;
  if (trackingNumber !== undefined) update.tracking_number = trackingNumber || null;
  if (isDelayed !== undefined) update.is_delayed = !!isDelayed;
  if (delayNote !== undefined) update.delay_note = delayNote || null;
  if (delayedUntil !== undefined) update.delayed_until = delayedUntil || null;
  if (Object.keys(update).length === 0) return res.status(400).json({ error: 'Nothing to update' });

  // Setting status to shipped/delivered here will be picked up and emailed by
  // the existing check-status-updates.js cron on its next run — this endpoint
  // deliberately does NOT send email itself, to keep all customer-facing email
  // logic in one place.
  const { error } = await supabase.from('orders').update(update).eq('id', orderId);
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ success: true });
}

async function handleResumePayment(req, res) {
  // "Complete Payment" on a pending order. An abandoned Razorpay order can't be
  // revived, so we create a FRESH Razorpay order for the SAME stored total, then
  // point the existing pending order row at the new razorpay_order_id. Nothing
  // about the items or price changes — verify-payment.js will mark it 'paid' on
  // success exactly as it does for a normal checkout.
  const { orderId, email } = req.body;
  const cleanOrderId = (orderId || '').trim();
  const cleanEmail = (email || '').trim().toLowerCase();
  if (!cleanOrderId || !cleanEmail) {
    return res.status(400).json({ error: 'Order ID and email are both required' });
  }

  const { data: order } = await supabase
    .from('orders')
    .select('id, email, status, total')
    .eq('id', cleanOrderId)
    .maybeSingle();

  // Same privacy stance as track-order: no email match => reveal nothing.
  if (!order || order.email.toLowerCase() !== cleanEmail) {
    return res.status(404).json({ error: 'No matching order found.' });
  }
  // Only a still-pending or failed-payment order can be resumed. A paid/shipped/cancelled order must not be re-charged.
  if (!['pending', 'payment_failed'].includes(order.status)) {
    return res.status(400).json({ error: 'This order can no longer be paid for here.' });
  }
  if (!order.total || order.total <= 0) {
    return res.status(400).json({ error: 'This order has no payable amount.' });
  }

  const razorpayOrder = await razorpay.orders.create({
    amount: Math.round(order.total * 100),
    currency: 'INR',
    receipt: order.id
  });

  await supabase.from('orders').update({ razorpay_order_id: razorpayOrder.id }).eq('id', order.id);

  return res.status(200).json({
    orderId: order.id,
    razorpayOrderId: razorpayOrder.id,
    amount: razorpayOrder.amount,
    currency: razorpayOrder.currency,
    keyId: process.env.RAZORPAY_KEY_ID
  });
}

async function handleAdminExportOrders(req, res) {
  if (!checkAdminSecret(req)) return res.status(401).json({ error: 'Unauthorized' });

  const { startDate, endDate, status, emailSearch } = req.body;

  let query = supabase
    .from('orders')
    .select('id, email, status, created_at, total, subtotal, discount_amount, tracking_number, gift_note, is_gift, shipping_address, customers(name, phone)')
    .order('created_at', { ascending: false })
    .limit(2000); // generous cap so a wide export can't run away indefinitely

  if (startDate) query = query.gte('created_at', startDate);
  if (endDate) {
    // Make the end date inclusive of the whole day, not just midnight.
    const inclusiveEnd = new Date(endDate);
    inclusiveEnd.setDate(inclusiveEnd.getDate() + 1);
    query = query.lt('created_at', inclusiveEnd.toISOString());
  }
  if (status && status !== 'all') query = query.eq('status', status);
  if (emailSearch) query = query.ilike('email', `%${emailSearch}%`);

  const { data: orders, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const orderIds = (orders || []).map(o => o.id);
  let itemsByOrder = {};
  if (orderIds.length) {
    const { data: items } = await supabase
      .from('order_items')
      .select('order_id, quantity, price_at_purchase, product_variants(ml, products(name))')
      .in('order_id', orderIds);
    for (const it of items || []) {
      const name = it.product_variants?.products?.name || 'Item';
      const ml = it.product_variants?.ml;
      const line = `${name}${ml ? ' (' + ml + 'ml)' : ''} x${it.quantity}`;
      (itemsByOrder[it.order_id] = itemsByOrder[it.order_id] || []).push(line);
    }
  }

  const rows = (orders || []).map(o => {
    const addr = o.shipping_address || {};
    const isIndia = (addr.country || '').toUpperCase() === 'IN';
    const platformFeeBase = isIndia ? Math.round(o.total * 0.02) : '';
    const platformFeeGst = isIndia ? Math.round(platformFeeBase * 0.18) : '';
    const platformFeeTotal = isIndia ? platformFeeBase + platformFeeGst : '';
    return {
      order_id: o.id,
      date: o.created_at,
      customer_name: o.customers?.name || '',
      email: o.email,
      phone: o.customers?.phone || '',
      status: o.status,
      items: (itemsByOrder[o.id] || []).join('; '),
      subtotal: o.subtotal || '',
      discount: o.discount_amount || '',
      total: o.total,
      platform_fee_2pct: platformFeeBase,
      platform_fee_gst_18pct: platformFeeGst,
      platform_fee_total: platformFeeTotal,
      is_gift: o.is_gift ? 'Yes' : 'No',
      gift_note: o.gift_note || '',
      tracking_number: o.tracking_number || '',
      shipping_city: addr.city || '',
      shipping_state: addr.state || '',
      shipping_country: addr.country || ''
    };
  });

  return res.status(200).json({ rows });
}

async function handleAdminGenerateInvoice(req, res) {
  if (!checkAdminSecret(req)) return res.status(401).json({ error: 'Unauthorized' });

  const { orderId } = req.body;
  if (!orderId) return res.status(400).json({ error: 'Missing order ID' });

  const { data: order, error } = await supabase
    .from('orders')
    .select('id, email, total, shipping_address, invoice_number, customer_id')
    .eq('id', orderId)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (!order.email) return res.status(400).json({ error: 'This order has no email on file to send the invoice to.' });

  try {
    const invoiceNumber = await generateAndSendGstInvoice(supabase, order);
    return res.status(200).json({ success: true, invoiceNumber });
  } catch (e) {
    console.error('Manual invoice generation failed for order', orderId, e);
    return res.status(500).json({ error: 'Could not generate the invoice right now.' });
  }
}
