// GET or POST /api/check-status-updates
// Called periodically by a free external scheduler (e.g. cron-job.org) —
// NOT by Supabase. Checks for any order or return request flagged as
// needing a notification (see 015_status_notifications.sql), sends the
// right email for each, and clears the flag. Also processes the actual
// Razorpay refund when a return request has just been approved.
//
// SECURITY: requires ?secret=... matching SUPABASE_WEBHOOK_SECRET, since
// most free external schedulers only support calling a plain URL rather
// than setting custom headers.

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

const DTDC_GENERAL_TRACKING_URL = 'https://www.dtdc.com/track-your-shipment/';

async function generateAndSendGstInvoice(order) {
  // Called once, when an order first reaches "delivered" -- generates a real
  // sequential invoice number (via a Postgres sequence, so it can never repeat
  // or collide even under concurrent runs) and emails a GST-compliant invoice.
  //
  // IMPORTANT CAVEATS, worth having a CA confirm before relying on this:
  // - Seller details (name/GSTIN/state) are hardcoded below from what was
  //   provided; the full registered address line was not supplied and should
  //   be added for completeness.
  // - Tax is computed on the order's already GST-inclusive total (18% extracted
  //   via total/1.18), split evenly into CGST+SGST for Maharashtra shipping
  //   addresses, or charged as IGST for every other Indian state.
  // - Shipping charges are taxed at the same 18% as the goods, as a
  //   simplifying assumption for a single-rate catalog.
  const SELLER = {
    name: 'CLASSIC ENTERPRISES',
    legalName: 'Ajamkhan Mahmad Hanifkhan Pathan',
    gstin: '27ASBPP0295M1ZC',
    address: '212, Raas Leela, Ambadi Road, Diwanman Manikpur, Vasai, Palghar, Maharashtra 401202',
    state: 'Maharashtra'
  };
  const HSN_CODE = '3303'; // perfumes, attars, toilet waters

  const { data: seqRow } = await supabase.rpc('nextval_gst_invoice');
  const invoiceNumber = 'HZ94-' + String(seqRow).padStart(5, '0');

  const { data: items } = await supabase
    .from('order_items')
    .select('quantity, price_at_purchase, product_variants(ml, products(name))')
    .eq('order_id', order.id);

  const addr = order.shipping_address || {};
  const isMaharashtra = (addr.state || '').trim().toLowerCase() === 'maharashtra';
  const total = Number(order.total) || 0;
  const taxableValue = Math.round((total / 1.18) * 100) / 100;
  const totalTax = Math.round((total - taxableValue) * 100) / 100;
  const cgst = isMaharashtra ? Math.round((totalTax / 2) * 100) / 100 : 0;
  const sgst = isMaharashtra ? Math.round((totalTax / 2) * 100) / 100 : 0;
  const igst = isMaharashtra ? 0 : totalTax;

  const itemRows = (items || []).map(i => {
    const name = i.product_variants?.products?.name || 'Item';
    const ml = i.product_variants?.ml;
    return `<tr>
      <td style="padding:6px 8px;border:1px solid #ddd">${escapeHtml(name)}${ml ? ' (' + ml + 'ml)' : ''}</td>
      <td style="padding:6px 8px;border:1px solid #ddd;text-align:center">${HSN_CODE}</td>
      <td style="padding:6px 8px;border:1px solid #ddd;text-align:center">${i.quantity}</td>
      <td style="padding:6px 8px;border:1px solid #ddd;text-align:right">₹${Number(i.price_at_purchase).toLocaleString('en-IN')}</td>
    </tr>`;
  }).join('');

  const html = `
  <div style="max-width:640px;margin:0 auto;font-family:Georgia,serif;color:#1a1a1a;font-size:13px">
    <div style="text-align:center;padding:20px 0;border-bottom:2px solid #c9a14a">
      <h1 style="margin:0;font-size:22px;letter-spacing:4px;color:#c9a14a">HEEZE 94</h1>
      <p style="margin:6px 0 0;font-size:11px;letter-spacing:2px;color:#888">TAX INVOICE</p>
    </div>
    <div style="padding:20px">
      <table style="width:100%;margin-bottom:16px"><tr>
        <td style="vertical-align:top;width:50%">
          <strong>${escapeHtml(SELLER.name)}</strong><br>
          ${escapeHtml(SELLER.address)}<br>
          GSTIN: ${SELLER.gstin}
        </td>
        <td style="vertical-align:top;width:50%;text-align:right">
          Invoice No: <strong>${invoiceNumber}</strong><br>
          Invoice Date: ${new Date().toLocaleDateString('en-IN')}<br>
          Order ID: ${order.id.slice(0, 8).toUpperCase()}
        </td>
      </tr></table>
      <p style="margin:0 0 4px;color:#888;font-size:11px;letter-spacing:1px">BILL TO</p>
      <p style="margin:0 0 16px">
        ${escapeHtml(addr.name || order.email)}<br>
        ${escapeHtml(addr.line1 || '')}${addr.city ? ', ' + escapeHtml(addr.city) : ''}${addr.state ? ', ' + escapeHtml(addr.state) : ''} ${escapeHtml(addr.pincode || '')}<br>
        ${escapeHtml(order.email)}
      </p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
        <thead><tr style="background:#faf6ee">
          <th style="padding:6px 8px;border:1px solid #ddd;text-align:left">Item</th>
          <th style="padding:6px 8px;border:1px solid #ddd">HSN</th>
          <th style="padding:6px 8px;border:1px solid #ddd">Qty</th>
          <th style="padding:6px 8px;border:1px solid #ddd;text-align:right">Amount</th>
        </tr></thead>
        <tbody>${itemRows}</tbody>
      </table>
      <table style="width:100%;margin-bottom:8px">
        <tr><td>Taxable Value</td><td style="text-align:right">₹${taxableValue.toLocaleString('en-IN')}</td></tr>
        ${isMaharashtra ? `
        <tr><td>CGST @ 9%</td><td style="text-align:right">₹${cgst.toLocaleString('en-IN')}</td></tr>
        <tr><td>SGST @ 9%</td><td style="text-align:right">₹${sgst.toLocaleString('en-IN')}</td></tr>` : `
        <tr><td>IGST @ 18%</td><td style="text-align:right">₹${igst.toLocaleString('en-IN')}</td></tr>`}
        <tr style="font-weight:bold;border-top:1px solid #ccc"><td style="padding-top:6px">Total</td><td style="text-align:right;padding-top:6px">₹${total.toLocaleString('en-IN')}</td></tr>
      </table>
      <p style="font-size:11px;color:#999;margin-top:24px">This is a computer-generated invoice.</p>
    </div>
  </div>`;

  await sendEmail(order.email, `Tax Invoice — HEEZE 94 Order #${order.id.slice(0, 8).toUpperCase()}`, html);
  await supabase.from('orders').update({ invoice_number: invoiceNumber, invoice_sent_at: new Date().toISOString() }).eq('id', order.id);
}

async function processOrderUpdates() {
  const { data: orders } = await supabase
    .from('orders')
    .select('*')
    .eq('notification_sent', false)
    .in('status', ['shipped', 'delivered']);

  let processed = 0;
  for (const order of orders || []) {
    if (!order.email) {
      await supabase.from('orders').update({ notification_sent: true }).eq('id', order.id);
      continue;
    }

    const statusLabel = order.status === 'shipped' ? 'Shipped' : 'Delivered';
    const message = order.status === 'shipped'
      ? 'Your HEEZE 94 order is on its way.'
      : 'Your HEEZE 94 order has been delivered. We hope you love it.';
    const showTracking = !!order.tracking_number;
    const trackingUrl = order.tracking_url || DTDC_GENERAL_TRACKING_URL;

    const html = `
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
          <p style="margin:0;font-size:16px;font-family:monospace">${escapeHtml(order.tracking_number)}</p>` : ''}
        </div>
        ${showTracking ? `
        <div style="text-align:center;margin:24px 0">
          <a href="${trackingUrl}" style="display:inline-block;background:#c9a14a;color:#1a1208;padding:12px 28px;text-decoration:none;border-radius:4px;font-size:13px;letter-spacing:1px;font-weight:bold">TRACK YOUR PACKAGE</a>
        </div>` : ''}
        <p style="margin-top:20px;font-size:12px;color:#999">Questions about your order? Just reply to this email.</p>
      </div>
    </div>`;

    await sendEmail(order.email, `Your HEEZE 94 Order is ${statusLabel} — #${order.id.slice(0, 8).toUpperCase()}`, html);
    if (order.status === 'delivered' && !order.invoice_sent_at) {
      try {
        await generateAndSendGstInvoice(order);
      } catch (e) {
        console.error('GST invoice generation failed for order', order.id, e);
      }
    }
    await supabase.from('orders').update({ notification_sent: true }).eq('id', order.id);
    processed++;
  }
  return processed;
}

async function processReturnUpdates() {
  const { data: requests } = await supabase
    .from('return_requests')
    .select('*')
    .eq('notification_sent', false)
    .in('status', ['approved', 'rejected']);

  let processed = 0;
  for (const request of requests || []) {
    const shortId = request.id.slice(0, 8).toUpperCase();

    if (request.status === 'approved') {
      const { data: order } = await supabase
        .from('orders')
        .select('id, total, razorpay_payment_id, refunded_amount')
        .eq('id', request.order_id)
        .single();

      if (order) {
        if (order.razorpay_payment_id && !order.refunded_amount) {
          try {
            const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
            const refundRes = await fetch(`https://api.razorpay.com/v1/payments/${order.razorpay_payment_id}/refund`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
              body: JSON.stringify({ speed: 'optimum' })
            });
            if (refundRes.ok) {
              await supabase.from('orders').update({ status: 'refunded', refunded_amount: order.total }).eq('id', order.id);
            } else {
              console.error('Refund failed for return request', request.id, await refundRes.text());
            }
          } catch (e) {
            console.error('Refund error:', e);
          }
        }

        await sendEmail(request.email, `Your Return Has Been Approved & Refunded — #${shortId}`, `
          <div style="max-width:560px;margin:0 auto;font-family:Georgia,serif;color:#1a1a1a">
            <div style="text-align:center;padding:24px 0;border-bottom:2px solid #c9a14a">
              <h1 style="margin:0;font-size:24px;letter-spacing:4px;color:#c9a14a">HEEZE 94</h1>
              <p style="margin:6px 0 0;font-size:12px;letter-spacing:2px;color:#888">RETURN APPROVED</p>
            </div>
            <div style="padding:28px 20px;font-size:14px;line-height:1.7;color:#333">
              <p>Good news — your return has been approved, and a full refund of ₹${Number(order.total).toLocaleString('en-IN')} is on its way back to your original payment method. This usually takes 5-7 working days to reflect.</p>
            </div>
          </div>`);
      }
    }

    if (request.status === 'rejected') {
      await sendEmail(request.email, `Update on Your Return Request — #${shortId}`, `
        <div style="max-width:560px;margin:0 auto;font-family:Georgia,serif;color:#1a1a1a">
          <div style="text-align:center;padding:24px 0;border-bottom:2px solid #c9a14a">
            <h1 style="margin:0;font-size:24px;letter-spacing:4px;color:#c9a14a">HEEZE 94</h1>
            <p style="margin:6px 0 0;font-size:12px;letter-spacing:2px;color:#888">RETURN REQUEST UPDATE</p>
          </div>
          <div style="padding:28px 20px;font-size:14px;line-height:1.7;color:#333">
            <p>After review, we're unable to approve this return request.</p>
            ${request.admin_notes ? `<p style="background:#fafafa;border-radius:6px;padding:14px;margin-top:12px">${escapeHtml(request.admin_notes)}</p>` : ''}
            <p style="margin-top:16px;font-size:12px;color:#999">If you have questions about this decision, just reply to this email.</p>
          </div>
        </div>`);
    }

    await supabase.from('return_requests').update({ notification_sent: true, reviewed_at: new Date().toISOString() }).eq('id', request.id);
    processed++;
  }
  return processed;
}

async function processAbandonedCarts() {
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2+ hours old
  const { data: orders } = await supabase
    .from('orders')
    .select('*')
    .eq('status', 'pending')
    .eq('abandoned_email_sent', false)
    .lt('created_at', cutoff);

  let processed = 0;
  for (const order of orders || []) {
    if (!order.email) {
      await supabase.from('orders').update({ abandoned_email_sent: true }).eq('id', order.id);
      continue;
    }

    const { data: items } = await supabase
      .from('order_items')
      .select('quantity, price_at_purchase, product_variants(ml, products(name))')
      .eq('order_id', order.id);

    const itemsHtml = (items || []).map(i =>
      `<tr><td style="padding:6px 0">${escapeHtml(i.product_variants?.products?.name || 'Item')} · ${i.product_variants?.ml}ml × ${i.quantity}</td></tr>`
    ).join('');

    await sendEmail(order.email, `You left something in your bag — HEEZE 94`, `
      <div style="max-width:560px;margin:0 auto;font-family:Georgia,serif;color:#1a1a1a">
        <div style="text-align:center;padding:24px 0;border-bottom:2px solid #c9a14a">
          <h1 style="margin:0;font-size:24px;letter-spacing:4px;color:#c9a14a">HEEZE 94</h1>
          <p style="margin:6px 0 0;font-size:12px;letter-spacing:2px;color:#888">YOUR BAG IS WAITING</p>
        </div>
        <div style="padding:28px 20px;font-size:14px;line-height:1.7;color:#333">
          <p>You left the following in your bag — it's still here whenever you're ready:</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0">${itemsHtml}</table>
          <p style="text-align:center;margin-top:24px">
            <a href="https://www.heeze94.com/collection" style="background:#c9a14a;color:#fff;padding:12px 28px;text-decoration:none;border-radius:4px;font-size:13px;letter-spacing:1px">RETURN TO YOUR BAG</a>
          </p>
        </div>
      </div>`);

    await supabase.from('orders').update({ abandoned_email_sent: true }).eq('id', order.id);
    processed++;
  }
  return processed;
}

async function processRefillReminders() {
  const windowStart = new Date(Date.now() - 52 * 24 * 60 * 60 * 1000).toISOString();
  const windowEnd = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
  const { data: orders } = await supabase
    .from('orders')
    .select('*')
    .in('status', ['paid', 'shipped', 'delivered'])
    .eq('refill_reminder_sent', false)
    .gte('created_at', windowStart)
    .lt('created_at', windowEnd);

  let processed = 0;
  for (const order of orders || []) {
    if (!order.email) {
      await supabase.from('orders').update({ refill_reminder_sent: true }).eq('id', order.id);
      continue;
    }

    await sendEmail(order.email, `Time for a refill? — HEEZE 94`, `
      <div style="max-width:560px;margin:0 auto;font-family:Georgia,serif;color:#1a1a1a">
        <div style="text-align:center;padding:24px 0;border-bottom:2px solid #c9a14a">
          <h1 style="margin:0;font-size:24px;letter-spacing:4px;color:#c9a14a">HEEZE 94</h1>
          <p style="margin:6px 0 0;font-size:12px;letter-spacing:2px;color:#888">A GENTLE REMINDER</p>
        </div>
        <div style="padding:28px 20px;font-size:14px;line-height:1.7;color:#333">
          <p>It's been about six weeks since your last HEEZE 94 order — most of our attars settle into a routine right around now. If you're running low, we'd love to have you back.</p>
          <p style="text-align:center;margin-top:24px">
            <a href="https://www.heeze94.com/collection" style="background:#c9a14a;color:#fff;padding:12px 28px;text-decoration:none;border-radius:4px;font-size:13px;letter-spacing:1px">SHOP AGAIN</a>
          </p>
        </div>
      </div>`);

    await supabase.from('orders').update({ refill_reminder_sent: true }).eq('id', order.id);
    processed++;
  }
  return processed;
}

async function processStaleOrderReminders() {
  // Nudges the owner when a PAID order hasn't been moved to "shipped" yet --
  // first reminder 8h after the order was paid, then every 24h after that
  // (tracked via last_status_reminder_sent_at) until the status changes.
  const ownerEmail = process.env.OWNER_NOTIFICATION_EMAIL || 'heeze94official@gmail.com';
  const eightHoursAgo = new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString();

  const { data: orders } = await supabase
    .from('orders')
    .select('id, email, total, created_at, last_status_reminder_sent_at')
    .eq('status', 'paid')
    .lt('created_at', eightHoursAgo);

  let processed = 0;
  const now = Date.now();
  for (const order of orders || []) {
    const lastSent = order.last_status_reminder_sent_at ? new Date(order.last_status_reminder_sent_at).getTime() : null;
    const dueForReminder = !lastSent || (now - lastSent) >= 24 * 60 * 60 * 1000;
    if (!dueForReminder) continue;

    const hoursWaiting = Math.round((now - new Date(order.created_at).getTime()) / (60 * 60 * 1000));
    await sendEmail(ownerEmail, `Reminder: Order #${order.id.slice(0, 8).toUpperCase()} still needs shipping`, `
      <div style="max-width:520px;margin:0 auto;font-family:Georgia,serif;color:#1a1a1a">
        <div style="text-align:center;padding:20px 0;border-bottom:2px solid #c9a14a">
          <h1 style="margin:0;font-size:22px;letter-spacing:3px;color:#c9a14a">HEEZE 94</h1>
          <p style="margin:6px 0 0;font-size:12px;letter-spacing:2px;color:#888">ORDER NEEDS ATTENTION</p>
        </div>
        <div style="padding:24px 20px;font-size:14px;line-height:1.7;color:#333">
          <p>Order <strong>#${order.id.slice(0, 8).toUpperCase()}</strong> (₹${Number(order.total).toLocaleString('en-IN')}, ${escapeHtml(order.email)}) has been paid for about ${hoursWaiting} hours and is still marked "paid" -- it hasn't been updated to shipped yet.</p>
          <p>Update it from your <a href="https://www.heeze94.com/admin">admin order page</a> once it's on its way. You'll keep getting this reminder every 24 hours until the status changes.</p>
        </div>
      </div>`);

    await supabase.from('orders').update({ last_status_reminder_sent_at: new Date().toISOString() }).eq('id', order.id);
    processed++;
  }
  return processed;
}

export default async function handler(req, res) {
  const secret = req.query.secret;
  if (!process.env.SUPABASE_WEBHOOK_SECRET || secret !== process.env.SUPABASE_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const ordersProcessed = await processOrderUpdates();
    const returnsProcessed = await processReturnUpdates();
    const abandonedCartsProcessed = await processAbandonedCarts();
    const refillRemindersProcessed = await processRefillReminders();
    const staleOrderRemindersProcessed = await processStaleOrderReminders();
    return res.status(200).json({ success: true, ordersProcessed, returnsProcessed, abandonedCartsProcessed, refillRemindersProcessed, staleOrderRemindersProcessed });
  } catch (e) {
    console.error('Status check error:', e);
    return res.status(500).json({ error: 'Something went wrong checking for updates' });
  }
}
