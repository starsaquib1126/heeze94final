// POST /api/contact-enquiry
// Step 2 of email verification: takes the token from step 1
// (/api/contact-request-code.js) plus the code the customer typed in,
// verifies the signature/expiry/code match, then sends the actual enquiry
// to the business owner's email using the original form data carried
// inside the token — nothing has to be resubmitted or stored server-side.

import crypto from 'crypto';

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

function verifyToken(token) {
  const secret = process.env.CONTACT_CODE_SECRET;
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null; // tampered or forged token
  }
  try {
    return JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.CONTACT_CODE_SECRET) {
    return res.status(500).json({ error: 'Verification is not configured yet.' });
  }

  const { token, code } = req.body || {};
  if (!token || !code) {
    return res.status(400).json({ error: 'Missing verification code.' });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return res.status(400).json({ error: 'This verification link is invalid — please request a new code.' });
  }

  if (Date.now() > payload.exp) {
    return res.status(400).json({ error: 'This code has expired — please request a new one.' });
  }

  if (String(code).trim() !== String(payload.code)) {
    return res.status(400).json({ error: 'That code doesn\'t match — please check and try again.' });
  }

  const { name, email, phone, interest, message } = payload;
  const ownerEmail = process.env.OWNER_NOTIFICATION_EMAIL || 'heeze94official@gmail.com';

  const html = `
  <div style="max-width:600px;margin:0 auto;font-family:Georgia,serif;color:#1a1a1a">
    <div style="text-align:center;padding:24px 0;border-bottom:2px solid #c9a14a">
      <h1 style="margin:0;font-size:24px;letter-spacing:4px;color:#c9a14a">HEEZE 94</h1>
      <p style="margin:6px 0 0;font-size:12px;letter-spacing:2px;color:#888">NEW CONTACT ENQUIRY · EMAIL VERIFIED</p>
    </div>
    <div style="padding:28px 20px;font-size:14px;line-height:1.7;color:#333">
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Phone:</strong> ${escapeHtml(phone)}</p>
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
