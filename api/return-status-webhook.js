// POST /api/return-status-webhook
// Called automatically by a Supabase Database Webhook whenever a row in the
// `return_requests` table is updated. If you change `status` to 'approved',
// this processes the actual Razorpay refund and emails the customer. If you
// change it to 'rejected', it emails the customer with your reason (if given).
//
// SECURITY: verifies a shared secret header, same pattern as the order
// status webhook — so this can't be triggered by a forged external request.

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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = req.headers['x-webhook-secret'];
  if (!process.env.SUPABASE_WEBHOOK_SECRET || secret !== process.env.SUPABASE_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { record, old_record } = req.body || {};
  if (!record || !old_record) {
    return res.status(400).json({ error: 'Missing return request data' });
  }

  if (record.status === old_record.status) {
    return res.status(200).json({ skipped: true, reason: 'Status unchanged' });
  }

  const shortId = record.id.slice(0, 8).toUpperCase();

  if (record.status === 'approved') {
    // Fetch the order to get the Razorpay payment ID and total
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, total, razorpay_payment_id, refunded_amount')
      .eq('id', record.order_id)
      .single();

    if (orderError || !order) {
      console.error('Could not find order for return request:', record.order_id);
      return res.status(500).json({ error: 'Order not found' });
    }

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
          return res.status(502).json({ error: 'Refund failed — please process it manually in Razorpay.' });
        }
      } catch (e) {
        console.error('Refund error:', e);
        return res.status(502).json({ error: 'Refund failed — please process it manually in Razorpay.' });
      }
    }

    await supabase.from('orders').update({ status: 'refunded', refunded_amount: order.total }).eq('id', order.id);
    await supabase.from('return_requests').update({ status: 'refunded', reviewed_at: new Date().toISOString() }).eq('id', record.id);

    sendEmail(record.email, `Your Return Has Been Approved & Refunded — #${shortId}`, `
      <div style="max-width:560px;margin:0 auto;font-family:Georgia,serif;color:#1a1a1a">
        <div style="text-align:center;padding:24px 0;border-bottom:2px solid #c9a14a">
          <h1 style="margin:0;font-size:24px;letter-spacing:4px;color:#c9a14a">HEEZE 94</h1>
          <p style="margin:6px 0 0;font-size:12px;letter-spacing:2px;color:#888">RETURN APPROVED</p>
        </div>
        <div style="padding:28px 20px;font-size:14px;line-height:1.7;color:#333">
          <p>Good news — your return has been approved, and a full refund of ₹${Number(order.total).toLocaleString('en-IN')} is on its way back to your original payment method. This usually takes 5-7 working days to reflect.</p>
          <p style="margin-top:16px;font-size:12px;color:#999">We're sorry this one didn't work out — we hope to see you again soon.</p>
        </div>
      </div>`);

    return res.status(200).json({ success: true, action: 'refunded' });
  }

  if (record.status === 'rejected') {
    await supabase.from('return_requests').update({ reviewed_at: new Date().toISOString() }).eq('id', record.id);

    sendEmail(record.email, `Update on Your Return Request — #${shortId}`, `
      <div style="max-width:560px;margin:0 auto;font-family:Georgia,serif;color:#1a1a1a">
        <div style="text-align:center;padding:24px 0;border-bottom:2px solid #c9a14a">
          <h1 style="margin:0;font-size:24px;letter-spacing:4px;color:#c9a14a">HEEZE 94</h1>
          <p style="margin:6px 0 0;font-size:12px;letter-spacing:2px;color:#888">RETURN REQUEST UPDATE</p>
        </div>
        <div style="padding:28px 20px;font-size:14px;line-height:1.7;color:#333">
          <p>After review, we're unable to approve this return request.</p>
          ${record.admin_notes ? `<p style="background:#fafafa;border-radius:6px;padding:14px;margin-top:12px">${escapeHtml(record.admin_notes)}</p>` : ''}
          <p style="margin-top:16px;font-size:12px;color:#999">If you have questions about this decision, just reply to this email.</p>
        </div>
      </div>`);

    return res.status(200).json({ success: true, action: 'rejected_email_sent' });
  }

  return res.status(200).json({ skipped: true, reason: `No action for status: ${record.status}` });
}
