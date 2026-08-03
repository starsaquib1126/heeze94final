// POST /api/contact-request-code
// Step 1 of email verification: generates a 6-digit code, emails it to the
// customer's address, and returns a signed token containing the code + the
// original form data. No database needed — the token itself carries
// everything needed for step 2 (see /api/contact-enquiry.js), and its HMAC
// signature means it can't be tampered with or forged without the secret.

import crypto from 'crypto';

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

function signToken(payload) {
  const secret = process.env.CONTACT_CODE_SECRET;
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${signature}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.CONTACT_CODE_SECRET) {
    return res.status(500).json({ error: 'Verification is not configured yet.' });
  }

  const { name, email, phone, interest, message } = req.body || {};

  if (!name || !email || !phone || !message) {
    return res.status(400).json({ error: 'Please fill in your name, email, phone, and message.' });
  }

  const code = String(Math.floor(100000 + Math.random() * 900000)); // 6-digit code
  const exp = Date.now() + 10 * 60 * 1000; // 10 minutes to enter it

  const token = signToken({ name, email, phone, interest, message, code, exp });

  const html = `
  <div style="max-width:500px;margin:0 auto;font-family:Georgia,serif;color:#1a1a1a">
    <div style="text-align:center;padding:24px 0;border-bottom:2px solid #c9a14a">
      <h1 style="margin:0;font-size:24px;letter-spacing:4px;color:#c9a14a">HEEZE 94</h1>
    </div>
    <div style="padding:28px 20px;font-size:14px;line-height:1.7;color:#333;text-align:center">
      <p>Your verification code is:</p>
      <p style="font-size:32px;letter-spacing:8px;font-weight:bold;color:#c9a14a;margin:16px 0">${code}</p>
      <p style="font-size:12px;color:#999">This code expires in 10 minutes. If you didn't request this, you can ignore this email.</p>
    </div>
  </div>`;

  const sent = await sendEmail(email, 'Your HEEZE 94 verification code', html);

  if (!sent) {
    return res.status(502).json({ error: 'Could not send a verification code to that email — please check it and try again.' });
  }

  return res.status(200).json({ success: true, token });
}
