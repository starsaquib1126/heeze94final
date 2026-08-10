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
  address: '212, Raas Leela, Ambadi Road, Diwanman Manikpur, Vasai, Palghar, Maharashtra 401202',
  state: 'Maharashtra'
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

function buildInvoicePdf(order, items, invoiceNumber, customerName) {
  return new Promise((resolve, reject) => {
    const addr = order.shipping_address || {};
    const isMaharashtra = (addr.state || '').trim().toLowerCase() === 'maharashtra';
    const doc = new PDFDocument({ size: 'A4', margin: 45 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const PAGE_LEFT = 45, PAGE_RIGHT = 550;

    // ── Header ──────────────────────────────────────────────
    doc.fillColor('#c9a14a').fontSize(24).font('Helvetica-Bold').text('HEEZE 94', { align: 'center' });
    doc.fillColor('#888').fontSize(9.5).font('Helvetica').text('LUXURY FRAGRANCE HOUSE', { align: 'center', characterSpacing: 2.5 });
    doc.moveDown(0.6);
    doc.fillColor('#1a1a1a').fontSize(13).font('Helvetica-Bold').text('TAX INVOICE', { align: 'center', characterSpacing: 1 });
    doc.moveDown(0.8);
    doc.strokeColor('#c9a14a').lineWidth(1.5).moveTo(PAGE_LEFT, doc.y).lineTo(PAGE_RIGHT, doc.y).stroke();
    doc.moveDown(0.9);

    // ── Seller / Invoice meta / Bill-To / Ship-To — three columns ──
    const blockTop = doc.y;
    const colW = 165;

    doc.fillColor('#888').fontSize(8).font('Helvetica-Bold').text('SOLD BY', PAGE_LEFT, blockTop, { characterSpacing: 1 });
    doc.fillColor('#1a1a1a').fontSize(10).font('Helvetica-Bold').text(SELLER.name, PAGE_LEFT, doc.y + 2, { width: colW });
    doc.font('Helvetica').fontSize(8.5).fillColor('#333')
      .text(SELLER.address, PAGE_LEFT, doc.y, { width: colW })
      .text('GSTIN: ' + SELLER.gstin, PAGE_LEFT, doc.y, { width: colW })
      .text('State: ' + SELLER.state, PAGE_LEFT, doc.y, { width: colW });
    const sellerBottom = doc.y;

    const billX = PAGE_LEFT + colW + 20;
    doc.fillColor('#888').fontSize(8).font('Helvetica-Bold').text('BILLED TO / SHIPPED TO', billX, blockTop, { characterSpacing: 1 });
    doc.fillColor('#1a1a1a').fontSize(10).font('Helvetica-Bold').text(customerName || addr.name || order.email, billX, doc.y + 2, { width: colW });
    doc.font('Helvetica').fontSize(8.5).fillColor('#333')
      .text([addr.line1, addr.city].filter(Boolean).join(', '), billX, doc.y, { width: colW })
      .text([addr.state, addr.pincode].filter(Boolean).join(' '), billX, doc.y, { width: colW })
      .text(order.email, billX, doc.y, { width: colW });
    const billBottom = doc.y;

    const metaX = PAGE_LEFT + (colW + 20) * 2;
    const metaW = PAGE_RIGHT - metaX;
    doc.fillColor('#888').fontSize(8).font('Helvetica-Bold').text('INVOICE DETAILS', metaX, blockTop, { width: metaW, characterSpacing: 1 });
    doc.font('Helvetica').fontSize(8.5).fillColor('#333')
      .text('Invoice No: ' + invoiceNumber, metaX, doc.y + 4, { width: metaW })
      .text('Invoice Date: ' + new Date().toLocaleDateString('en-IN'), metaX, doc.y, { width: metaW })
      .text('Order No: ' + order.id.slice(0, 8).toUpperCase(), metaX, doc.y, { width: metaW })
      .text('Order Date: ' + new Date(order.created_at || Date.now()).toLocaleDateString('en-IN'), metaX, doc.y, { width: metaW })
      .text('Place of Supply: ' + (addr.state || SELLER.state), metaX, doc.y, { width: metaW });
    const metaBottom = doc.y;

    doc.y = Math.max(sellerBottom, billBottom, metaBottom) + 14;
    doc.strokeColor('#eee').lineWidth(0.5).moveTo(PAGE_LEFT, doc.y).lineTo(PAGE_RIGHT, doc.y).stroke();
    doc.moveDown(0.9);

    // ── Item table ──────────────────────────────────────────
    const col = { desc: PAGE_LEFT, hsn: 320, rate: 380, qty: 440, amt: 475 };
    const rowH = 15;

    function tableHeader(y) {
      doc.rect(PAGE_LEFT, y, PAGE_RIGHT - PAGE_LEFT, 20).fill('#1a1408');
      doc.fillColor('#e9be5a').fontSize(7.5).font('Helvetica-Bold')
        .text('DESCRIPTION', col.desc + 6, y + 6, { width: col.hsn - col.desc - 10 })
        .text('HSN', col.hsn, y + 6, { width: col.rate - col.hsn, align: 'center' })
        .text('RATE', col.rate, y + 6, { width: col.qty - col.rate, align: 'center' })
        .text('QTY', col.qty, y + 6, { width: col.amt - col.qty, align: 'center' })
        .text('AMOUNT', col.amt, y + 6, { width: PAGE_RIGHT - col.amt - 6, align: 'right' });
      return y + 20;
    }

    let y = tableHeader(doc.y);
    let itemsSubtotal = 0;

    for (const i of (items || [])) {
      const name = i.product_variants?.products?.name || 'Item';
      const desc = i.product_variants?.products?.desc || '';
      const ml = i.product_variants?.ml;
      const lineTotal = Number(i.price_at_purchase) * Number(i.quantity);
      itemsSubtotal += lineTotal;

      const descText = desc ? desc.slice(0, 85) + (desc.length > 85 ? '…' : '') : '';
      const nameLine = name + (ml ? ' (' + ml + 'ml)' : '');
      const lineHeight = descText ? rowH * 2 + 4 : rowH + 6;

      doc.fillColor('#1a1a1a').fontSize(8.5).font('Helvetica-Bold').text(nameLine, col.desc + 6, y + 5, { width: col.hsn - col.desc - 10 });
      if (descText) doc.fillColor('#888').fontSize(7).font('Helvetica').text(descText, col.desc + 6, y + 5 + 11, { width: col.hsn - col.desc - 10 });

      doc.fillColor('#333').fontSize(8).font('Helvetica')
        .text(HSN_CODE, col.hsn, y + 5, { width: col.rate - col.hsn, align: 'center' })
        .text(money(i.price_at_purchase), col.rate, y + 5, { width: col.qty - col.rate, align: 'center' })
        .text(String(i.quantity), col.qty, y + 5, { width: col.amt - col.qty, align: 'center' })
        .text(money(lineTotal), col.amt, y + 5, { width: PAGE_RIGHT - col.amt - 6, align: 'right' });

      y += lineHeight;
      doc.strokeColor('#eee').lineWidth(0.5).moveTo(PAGE_LEFT, y).lineTo(PAGE_RIGHT, y).stroke();
    }
    doc.y = y + 12;

    // ── Summary — shows the full path from items to what was actually
    // charged, so every figure here reconciles exactly with order.total.
    // Tax is computed on the FINAL total (post-discount, post-shipping),
    // not per line item, since discounts and shipping apply at the order
    // level and can't be correctly allocated per line without arbitrary
    // proportional splitting. ──
    const total = Number(order.total) || 0;
    const discount = Number(order.discount_amount) || 0;
    const shippingFee = Number(order.shipping_fee) || 0;
    const taxableValue = Math.round((total / 1.18) * 100) / 100;
    const totalTax = Math.round((total - taxableValue) * 100) / 100;
    const cgst = isMaharashtra ? Math.round((totalTax / 2) * 100) / 100 : 0;
    const sgst = isMaharashtra ? Math.round((totalTax / 2) * 100) / 100 : 0;
    const igst = isMaharashtra ? 0 : totalTax;

    const summaryLabelX = 370, summaryValX = 470;
    const sumLine = (label, value, bold) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor('#1a1a1a')
        .text(label, summaryLabelX, doc.y, { width: 95 });
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor('#1a1a1a')
        .text(value, summaryValX, doc.y - doc.currentLineHeight(), { width: PAGE_RIGHT - summaryValX, align: 'right' });
      doc.moveDown(0.35);
    };
    sumLine('Items Subtotal', money(itemsSubtotal));
    if (discount > 0) sumLine('Discount', '-' + money(discount));
    if (shippingFee > 0) sumLine('Shipping', money(shippingFee));
    doc.strokeColor('#eee').lineWidth(0.5).moveTo(summaryLabelX, doc.y).lineTo(PAGE_RIGHT, doc.y).stroke();
    doc.moveDown(0.3);
    sumLine('Taxable Value', money(taxableValue));
    if (isMaharashtra) {
      sumLine('CGST', money(cgst));
      sumLine('SGST', money(sgst));
    } else {
      sumLine('IGST', money(igst));
    }
    doc.strokeColor('#ccc').lineWidth(0.5).moveTo(summaryLabelX, doc.y).lineTo(PAGE_RIGHT, doc.y).stroke();
    doc.moveDown(0.3);
    sumLine('Total Amount', money(total), true);

    doc.moveDown(1.2);
    doc.fontSize(7.5).fillColor('#999').font('Helvetica')
      .text('Whether tax is payable under reverse charge: No', PAGE_LEFT, doc.y)
      .text('This is a computer-generated invoice and does not require a physical signature.', PAGE_LEFT, doc.y + 12);

    doc.end();
  });
}

// supabase: an already-configured @supabase/supabase-js client from the caller.
// order: the full order row (must include shipping_address, total, email, id,
// customer_id, created_at, invoice_number if already generated).
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
    .select('quantity, price_at_purchase, product_variants(ml, products(name, desc))')
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
