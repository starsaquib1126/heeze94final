// Shared GST invoice logic. This file is NOT a route -- Vercel only counts
// files directly under /api that export a default handler as a serverless
// function, so importing this from multiple API files does not count against
// the 12-function limit.
//
// IMPORTANT CAVEATS, worth having a CA confirm before relying on this fully:
// - Seller details below are from the GST registration certificate provided.
// - Tax is computed on the order's already GST-inclusive total (18% extracted
//   via total/1.18), split into CGST+SGST for Maharashtra shipping addresses,
//   or IGST for every other Indian state.
// - Shipping charges are taxed at the same 18% as the goods, as a
//   simplifying assumption for a single-rate catalog.

const SELLER = {
  name: 'CLASSIC ENTERPRISES',
  gstin: '27ASBPP0295M1ZC',
  address: '212, Raas Leela, Ambadi Road, Diwanman Manikpur, Vasai, Palghar, Maharashtra 401202'
};
const HSN_CODE = '3303'; // perfumes, attars, toilet waters

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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
    console.error('Invoice email send failed:', e);
    return false;
  }
}

function buildInvoiceHtml(order, items, invoiceNumber) {
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

  return `
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
}

// supabase: an already-configured @supabase/supabase-js client from the caller.
// order: the full order row (must include shipping_address, total, email, id).
// Returns the invoice number on success, or null if it couldn't be generated.
export async function generateAndSendGstInvoice(supabase, order) {
  const ownerEmail = process.env.OWNER_NOTIFICATION_EMAIL || 'heeze94official@gmail.com';

  let invoiceNumber = order.invoice_number;
  if (!invoiceNumber) {
    const { data: seqRow } = await supabase.rpc('nextval_gst_invoice');
    invoiceNumber = 'HZ94-' + String(seqRow).padStart(5, '0');
  }

  const { data: items } = await supabase
    .from('order_items')
    .select('quantity, price_at_purchase, product_variants(ml, products(name))')
    .eq('order_id', order.id);

  const html = buildInvoiceHtml(order, items, invoiceNumber);

  await sendEmail(order.email, `Tax Invoice — HEEZE 94 Order #${order.id.slice(0, 8).toUpperCase()}`, html);
  await sendEmail(ownerEmail, `[Copy] Tax Invoice ${invoiceNumber} — Order #${order.id.slice(0, 8).toUpperCase()}`, html);

  await supabase.from('orders').update({ invoice_number: invoiceNumber, invoice_sent_at: new Date().toISOString() }).eq('id', order.id);
  return invoiceNumber;
}
