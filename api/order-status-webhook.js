// POST /api/order-status-webhook
// Called automatically by a Supabase Database Webhook whenever a row in the
// `orders` table is updated. If the `status` field genuinely changed to
// something the customer should know about (shipped / delivered), this
// sends them an email automatically — no manual step needed beyond
// updating the order in Supabase.
//
// SECURITY: verifies a shared secret header so this endpoint can't be used
// by a random internet request to spam customers with fake emails.

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

// DTDC's general tracking page — used whenever a specific tracking link
// hasn't been provided for an order, so the customer can still track it
// by pasting in the tracking number themselves.
const DTDC_GENERAL_TRACKING_URL = 'https://www.dtdc.com/track-your-shipment/';

function buildStatusEmailHtml(order, statusLabel, message) {
  const trackingUrl = order.tracking_url || DTDC_GENERAL_TRACKING_URL;
  const showTracking = !!order.tracking_number;

  return `
  <div style="max-width:560px;margin:0 auto;font-family:Georgia,serif;color:#1a1a1a">
    <div style="text-align:center;padding:24px 0;border-bottom:2px solid #c9a14a">
      <h1 style="margin:0;font-size:24px;letter-spacing:4px;color:#c9a14a">HEEZE 94</h1>
      <p style="margin:6px 0 0;font-size:12px;letter-spacing:2px;color:#888">ORDER ${statusLabel.toUpperCase()}</p>
    </div>
    <div style="padding:28px 20px;font-size:14px;line-height:1.7;color:#333">
      <p>${message}</p>
      <div style="background:#fafafa;border-radius:6px;padding:16px;margin:20px 0">
        <p style="margin:0 0 4px;font-size:12px;color:#888;letter-spacing:1px">ORDER ID</p>
        <p style="margin:0;font-size:16px;font-family:monospace">${order.id.slice(0, 8).toUpperCase()}</p>
        ${showTracking ? `
        <p style="margin:14px 0 4px;font-size:12px;color:#888;letter-spacing:1px">COURIER</p>
        <p style="margin:0;font-size:14px">${escapeHtml(order.courier_name || 'DTDC')}</p>
        <p style="margin:14px 0 4px;font-size:12px;color:#888;letter-spacing:1px">TRACKING NUMBER</p>
        <p style="margin:0;font-size:16px;font-family:monospace">${escapeHtml(order.tracking_number)}</p>
        ` : ''}
      </div>
      ${showTracking ? `
      <div style="text-align:center;margin:24px 0">
        <a href="${trackingUrl}" style="display:inline-block;background:#c9a14a;color:#1a1208;padding:12px 28px;text-decoration:none;border-radius:4px;font-size:13px;letter-spacing:1px;font-weight:bold">TRACK YOUR PACKAGE</a>
      </div>
      ${!order.tracking_url ? `<p style="font-size:12px;color:#999;text-align:center">Enter your tracking number above on the DTDC tracking page to see live status.</p>` : ''}
      ` : ''}
      <p style="margin-top:20px;font-size:12px;color:#999">Questions about your order? Just reply to this email.</p>
    </div>
  </div>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify this request genuinely came from our Supabase webhook, not
  // a forged request from elsewhere on the internet.
  const secret = req.headers['x-webhook-secret'];
  if (!process.env.SUPABASE_WEBHOOK_SECRET || secret !== process.env.SUPABASE_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { record, old_record } = req.body || {};
  if (!record || !old_record) {
    return res.status(400).json({ error: 'Missing order data' });
  }

  // Only act on a genuine status change — not every edit to the row
  if (record.status === old_record.status) {
    return res.status(200).json({ skipped: true, reason: 'Status unchanged' });
  }

  const email = record.email;
  if (!email) {
    return res.status(200).json({ skipped: true, reason: 'No customer email on this order' });
  }

  let statusLabel, message;
  if (record.status === 'shipped') {
    statusLabel = 'Shipped';
    message = 'Your HEEZE 94 order is on its way.';
  } else if (record.status === 'delivered') {
    statusLabel = 'Delivered';
    message = 'Your HEEZE 94 order has been delivered. We hope you love it.';
  } else {
    // Other status changes (e.g. 'processing') don't currently trigger an email
    return res.status(200).json({ skipped: true, reason: `No email configured for status: ${record.status}` });
  }

  const html = buildStatusEmailHtml(record, statusLabel, message);
  const sent = await sendEmail(email, `Your HEEZE 94 Order is ${statusLabel} — #${record.id.slice(0, 8).toUpperCase()}`, html);

  return res.status(200).json({ success: sent });
}
