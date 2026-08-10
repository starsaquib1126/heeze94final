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

import PDFDocument from 'pdfkit';

const SELLER = {
  name: 'CLASSIC ENTERPRISES',
  gstin: '27ASBPP0295M1ZC',
  address: '212, Raas Leela, Ambadi Road, Diwanman Manikpur, Vasai, Palghar, Maharashtra 401202'
};
const HSN_CODE = '3303'; // perfumes, attars, toilet waters

function money(n) {
  return '\u20b9' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function sendEmail(to, subject, html, attachments) {
  if (!process.env.RESEND_API_KEY) return false;
  try {
    const body = {
      from: process.env.RESEND_FROM_EMAIL || 'HEEZE 94 <orders@heeze94.com>',
      to: Array.isArray(to) ? to : [to],
      subject,
      html
    };
    if (attachments && attachments.length) body.attachments = attachments;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify(body)
    });
    return res.ok;
  } catch (e) {
    console.error('Invoice email send failed:', e);
    return false;
  }
}

function computeTax(order) {
  const addr = order.shipping_address || {};
  const isMaharashtra = (addr.state || '').trim().toLowerCase() === 'maharashtra';
  const total = Number(order.total) || 0;
  const taxableValue = Math.round((total / 1.18) * 100) / 100;
  const totalTax = Math.round((total - taxableValue) * 100) / 100;
  const cgst = isMaharashtra ? Math.round((totalTax / 2) * 100) / 100 : 0;
  const sgst = isMaharashtra ? Math.round((totalTax / 2) * 100) / 100 : 0;
  const igst = isMaharashtra ? 0 : totalTax;
  return { isMaharashtra, total, taxableValue, cgst, sgst, igst };
}

// Renders the actual tax invoice as a real PDF (via pdfkit -- a pure-JS
// library with no native binaries, so it runs cleanly in a Vercel serverless
// function without a headless browser). Returns a Buffer.
function buildInvoicePdf(order, items, invoiceNumber, customerName) {
  return new Promise((resolve, reject) => {
    const addr = order.shipping_address || {};
    const tax = computeTax(order);
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fillColor('#c9a14a').fontSize(22).font('Helvetica-Bold').text('HEEZE 94', { align: 'center' });
    doc.fillColor('#888').fontSize(10).font('Helvetica').text('TAX INVOICE', { align: 'center', characterSpacing: 2 });
    doc.moveDown(1.2);
    doc.strokeColor('#c9a14a').lineWidth(1.5).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(1);

    const topY = doc.y;
    doc.fillColor('#1a1a1a').fontSize(11).font('Helvetica-Bold').text(SELLER.name, 50, topY);
    doc.font('Helvetica').fontSize(9).fillColor('#333')
      .text(SELLER.address, 50, doc.y, { width: 260 })
      .text('GSTIN: ' + SELLER.gstin, 50, doc.y);

    doc.font('Helvetica').fontSize(9).fillColor('#333')
      .text('Invoice No: ' + invoiceNumber, 300, topY, { width: 245, align: 'right' })
      .text('Invoice Date: ' + new Date().toLocaleDateString('en-IN'), 300, doc.y, { width: 245, align: 'right' })
      .text('Order ID: ' + order.id.slice(0, 8).toUpperCase(), 300, doc.y, { width: 245, align: 'right' });

    doc.moveDown(1.5);

    doc.fontSize(9).fillColor('#888').text('BILL TO', 50, doc.y, { characterSpacing: 1 });
    doc.fontSize(10).fillColor('#1a1a1a').font('Helvetica-Bold').text(customerName || addr.name || order.email, 50, doc.y + 2);
    doc.font('Helvetica').fontSize(9).fillColor('#333')
      .text([addr.line1, addr.city, addr.state].filter(Boolean).join(', ') + (addr.pincode ? ' ' + addr.pincode : ''), 50, doc.y)
      .text(order.email, 50, doc.y);

    doc.moveDown(1.5);

    const tableTop = doc.y;
    const col = { item: 50, hsn: 300, qty: 370, amt: 430 };
    doc.rect(50, tableTop, 495, 20).fill('#faf6ee');
    doc.fillColor('#1a1a1a').fontSize(9).font('Helvetica-Bold')
      .text('Item', col.item + 6, tableTop + 6)
      .text('HSN', col.hsn, tableTop + 6, { width: 60, align: 'center' })
      .text('Qty', col.qty, tableTop + 6, { width: 50, align: 'center' })
      .text('Amount', col.amt, tableTop + 6, { width: 105, align: 'right' });

    let rowY = tableTop + 20;
    doc.font('Helvetica').fontSize(9);
    for (const i of (items || [])) {
      const name = i.product_variants?.products?.name || 'Item';
      const ml = i.product_variants?.ml;
      const label = name + (ml ? ' (' + ml + 'ml)' : '');
      doc.fillColor('#1a1a1a')
        .text(label, col.item + 6, rowY + 6, { width: 240 })
        .text(HSN_CODE, col.hsn, rowY + 6, { width: 60, align: 'center' })
        .text(String(i.quantity), col.qty, rowY + 6, { width: 50, align: 'center' })
        .text(money(i.price_at_purchase), col.amt, rowY + 6, { width: 105, align: 'right' });
      rowY += 22;
      doc.strokeColor('#eee').lineWidth(0.5).moveTo(50, rowY).lineTo(545, rowY).stroke();
    }
    doc.rect(50, tableTop, 495, rowY - tableTop).stroke('#ddd');

    doc.y = rowY + 14;

    const summaryX = 350;
    const line = (label, value, bold) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5).fillColor('#1a1a1a')
        .text(label, summaryX, doc.y, { width: 100, continued: false })
        .text(value, summaryX, doc.y - doc.currentLineHeight(), { width: 195, align: 'right' });
      doc.moveDown(0.3);
    };
    line('Taxable Value', money(tax.taxableValue));
    if (tax.isMaharashtra) {
      line('CGST @ 9%', money(tax.cgst));
      line('SGST @ 9%', money(tax.sgst));
    } else {
      line('IGST @ 18%', money(tax.igst));
    }
    doc.strokeColor('#ccc').lineWidth(0.5).moveTo(summaryX, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.3);
    line('Total', money(tax.total), true);

    doc.moveDown(2);
    doc.fontSize(8).fillColor('#999').text('This is a computer-generated invoice.', 50, doc.y);

    doc.end();
  });
}

// supabase: an already-configured @supabase/supabase-js client from the caller.
// order: the full order row (must include shipping_address, total, email, id,
// customer_id, invoice_number if already generated).
// Returns the invoice number on success.
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

  let customerName = null;
  if (order.customer_id) {
    const { data: customerRow } = await supabase.from('customers').select('name').eq('id', order.customer_id).maybeSingle();
    customerName = customerRow?.name || null;
  }

  const pdfBuffer = await buildInvoicePdf(order, items, invoiceNumber, customerName);
  const pdfBase64 = pdfBuffer.toString('base64');
  const filename = 'HEEZE94-Invoice-' + invoiceNumber + '.pdf';
  const attachments = [{ content: pdfBase64, filename }];

  const shortHtml = `
  <div style="max-width:480px;margin:0 auto;font-family:Georgia,serif;color:#1a1a1a">
    <div style="text-align:center;padding:20px 0;border-bottom:2px solid #c9a14a">
      <h1 style="margin:0;font-size:22px;letter-spacing:4px;color:#c9a14a">HEEZE 94</h1>
    </div>
    <div style="padding:24px 16px;font-size:14px;line-height:1.7">
      <p>Please find attached the GST tax invoice for order #` + order.id.slice(0, 8).toUpperCase() + `.</p>
      <p style="font-size:12px;color:#999">Invoice No: ` + invoiceNumber + `</p>
    </div>
  </div>`;

  await sendEmail(order.email, 'Tax Invoice — HEEZE 94 Order #' + order.id.slice(0, 8).toUpperCase(), shortHtml, attachments);
  await sendEmail(ownerEmail, '[Copy] Tax Invoice ' + invoiceNumber + ' — Order #' + order.id.slice(0, 8).toUpperCase(), shortHtml, attachments);

  await supabase.from('orders').update({ invoice_number: invoiceNumber, invoice_sent_at: new Date().toISOString() }).eq('id', order.id);
  return invoiceNumber;
}
