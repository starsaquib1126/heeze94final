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
    .select('id, email, status, created_at, total, tracking_number, gift_note, is_gift')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ orders: orders || [] });
}

async function handleAdminUpdateOrder(req, res) {
  if (!checkAdminSecret(req)) return res.status(401).json({ error: 'Unauthorized' });

  const { orderId, status, trackingNumber } = req.body;
  if (!orderId) return res.status(400).json({ error: 'Missing order ID' });

  const update = {};
  if (status) update.status = status;
  if (trackingNumber !== undefined) update.tracking_number = trackingNumber || null;
  if (Object.keys(update).length === 0) return res.status(400).json({ error: 'Nothing to update' });

  // Setting status to shipped/delivered here will be picked up and emailed by
  // the existing check-status-updates.js cron on its next run — this endpoint
  // deliberately does NOT send email itself, to keep all customer-facing email
  // logic in one place.
  const { error } = await supabase.from('orders').update(update).eq('id', orderId);
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ success: true });
}
