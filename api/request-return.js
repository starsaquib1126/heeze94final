// POST /api/request-return
// Customer submits a return/damage claim. This does NOT process a refund —
// it just creates a pending request and notifies both sides. The business
// reviews it manually in Supabase; approving it triggers the actual refund
// (see /api/return-status-webhook.js).

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

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const VALID_REASONS = ['damaged', 'wrong_item', 'defective', 'other'];
const REASON_LABELS = { damaged: 'Item arrived damaged', wrong_item: 'Wrong item received', defective: 'Item is defective', other: 'Other' };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { orderId, email, reason, description } = req.body || {};

  if (!orderId || !email || !reason || !description) {
    return res.status(400).json({ error: 'Please fill in all fields.' });
  }
  if (!VALID_REASONS.includes(reason)) {
    return res.status(400).json({ error: 'Please select a valid reason.' });
  }

  // Confirm the order exists and actually belongs to this customer
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, email, status')
    .eq('id', orderId)
    .single();

  if (orderError || !order) {
    return res.status(404).json({ error: 'We could not find that order.' });
  }
  if (order.email !== email) {
    return res.status(403).json({ error: 'This order does not belong to you.' });
  }

  const { data: request, error: insertError } = await supabase
    .from('return_requests')
    .insert({ order_id: orderId, email, reason, description, status: 'pending' })
    .select('id')
    .single();

  if (insertError) {
    console.error('Return request insert error:', insertError);
    return res.status(500).json({ error: 'Could not submit your request right now — please try again.' });
  }

  const reasonLabel = REASON_LABELS[reason];
  const shortOrderId = order.id.slice(0, 8).toUpperCase();

  // Confirmation to the customer
  sendEmail(email, `We've received your return request — #${shortOrderId}`, `
    <div style="max-width:560px;margin:0 auto;font-family:Georgia,serif;color:#1a1a1a">
      <div style="text-align:center;padding:24px 0;border-bottom:2px solid #c9a14a">
        <h1 style="margin:0;font-size:24px;letter-spacing:4px;color:#c9a14a">HEEZE 94</h1>
        <p style="margin:6px 0 0;font-size:12px;letter-spacing:2px;color:#888">RETURN REQUEST RECEIVED</p>
      </div>
      <div style="padding:28px 20px;font-size:14px;line-height:1.7;color:#333">
        <p>We've received your return request for order #${shortOrderId} and will review it shortly. You'll hear from us by email once a decision has been made.</p>
        <p style="margin-top:16px;font-size:12px;color:#999">Reason given: ${escapeHtml(reasonLabel)}</p>
      </div>
    </div>`);

  // Notification to the business, with everything needed to review it
  const ownerEmail = process.env.OWNER_NOTIFICATION_EMAIL || 'heeze94official@gmail.com';
  sendEmail(ownerEmail, `New Return Request — Order #${shortOrderId}`, `
    <div style="max-width:560px;margin:0 auto;font-family:Georgia,serif;color:#1a1a1a">
      <div style="text-align:center;padding:24px 0;border-bottom:2px solid #c9a14a">
        <h1 style="margin:0;font-size:24px;letter-spacing:4px;color:#c9a14a">HEEZE 94</h1>
        <p style="margin:6px 0 0;font-size:12px;letter-spacing:2px;color:#888">NEW RETURN REQUEST — NEEDS REVIEW</p>
      </div>
      <div style="padding:28px 20px;font-size:14px;line-height:1.7;color:#333">
        <p><strong>Order:</strong> #${shortOrderId}</p>
        <p><strong>Customer:</strong> ${escapeHtml(email)}</p>
        <p><strong>Reason:</strong> ${escapeHtml(reasonLabel)}</p>
        <p><strong>Description:</strong></p>
        <p style="background:#fafafa;border-radius:6px;padding:14px;white-space:pre-wrap">${escapeHtml(description)}</p>
        <p style="margin-top:20px;font-size:12px;color:#999">Review this in Supabase → return_requests table → set status to 'approved' or 'rejected'.</p>
      </div>
    </div>`);

  return res.status(200).json({ success: true, requestId: request.id });
}
