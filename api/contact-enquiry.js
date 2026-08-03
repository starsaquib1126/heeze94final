// POST /api/contact-enquiry
// Sends the Contact page form submission to the business owner's email.
// Uses the same Resend setup already configured for order notifications.

async function sendEmail(to, subject, html, replyTo) {
  if (!process.env.RESEND_API_KEY) return false;
  try {
    const body = {
      from: process.env.RESEND_FROM_EMAIL || 'HEEZE 94 <orders@heeze94.com>',
      to: Array.isArray(to) ? to : [to],
      subject,
      html
    };
    if (replyTo) body.reply_to = replyTo;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify(body)
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

  const { name, email, phone, interest, message } = req.body || {};

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Please fill in your name, email, and message.' });
  }

  const ownerEmail = process.env.OWNER_NOTIFICATION_EMAIL || 'heeze94official@gmail.com';

  const html = `
  <div style="max-width:600px;margin:0 auto;font-family:Georgia,serif;color:#1a1a1a">
    <div style="text-align:center;padding:24px 0;border-bottom:2px solid #c9a14a">
      <h1 style="margin:0;font-size:24px;letter-spacing:4px;color:#c9a14a">HEEZE 94</h1>
      <p style="margin:6px 0 0;font-size:12px;letter-spacing:2px;color:#888">NEW CONTACT ENQUIRY</p>
    </div>
    <div style="padding:28px 20px;font-size:14px;line-height:1.7;color:#333">
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      ${phone ? `<p><strong>Phone:</strong> ${escapeHtml(phone)}</p>` : ''}
      ${interest ? `<p><strong>Enquiry type:</strong> ${escapeHtml(interest)}</p>` : ''}
      <p><strong>Message:</strong></p>
      <p style="background:#fafafa;border-radius:6px;padding:14px;white-space:pre-wrap">${escapeHtml(message)}</p>
      <p style="margin-top:20px;font-size:12px;color:#999">Reply directly to this email to respond to ${escapeHtml(name)}.</p>
    </div>
  </div>`;

  const sent = await sendEmail(ownerEmail, `New Enquiry from ${name} — HEEZE 94`, html, email);

  if (!sent) {
    return res.status(502).json({ error: 'Could not send your message right now — please try WhatsApp or email us directly.' });
  }

  return res.status(200).json({ success: true });
}
