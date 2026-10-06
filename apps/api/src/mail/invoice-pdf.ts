import PDFDocument from 'pdfkit';
import type { SaleInvoice } from '@afia/contracts';

const colors = {
  primary: '#2563EB', primaryStrong: '#1E40AF', navy: '#0F172A', body: '#334155',
  muted: '#64748B', border: '#E2E8F0', surface: '#F8FAFC', danger: '#DC2626',
  warning: '#D97706', white: '#FFFFFF',
};

export type EmbeddedImage = { buffer: Buffer; contentType: 'image/png' | 'image/jpeg'; extension: 'png' | 'jpg' };

export function dataUrlImage(value?: string | null): EmbeddedImage | null {
  if (!value) return null;
  const match = /^data:(image\/(?:png|jpeg));base64,([a-z0-9+/=\s]+)$/i.exec(value);
  if (!match) return null;
  try {
    const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
    if (!buffer.length) return null;
    const contentType = match[1].toLowerCase() as 'image/png' | 'image/jpeg';
    return { buffer, contentType, extension: contentType === 'image/png' ? 'png' : 'jpg' };
  } catch { return null; }
}

export function invoiceFileName(invoice: SaleInvoice) {
  const store = invoice.settings.storeName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'Invoice';
  return `${store}-${invoice.invoiceNumber}.pdf`;
}

export function createInvoicePdf(invoice: SaleInvoice): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: 'A4', margin: 44, bufferPages: true });
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
    const left = document.page.margins.left;
    const right = document.page.width - document.page.margins.right;
    const width = right - left;
    const symbol = invoice.settings.currencySymbol === '৳' ? 'BDT ' : invoice.settings.currencySymbol;
    const amount = (value: number) => `${symbol}${value.toLocaleString('en-BD', { minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
    const ensureSpace = (height: number) => { if (document.y + height > document.page.height - 62) document.addPage(); };
    const label = (value: string, x: number, y: number) => document.font('Helvetica-Bold').fontSize(8).fillColor(colors.primaryStrong).text(value, x, y, { characterSpacing: 1.2 });

    const logo = dataUrlImage(invoice.settings.logoUrl) || dataUrlImage(invoice.settings.faviconUrl);
    const fallbackLogo = () => {
      document.roundedRect(left, 44, 52, 52, 8).fill(colors.primary);
      document.font('Helvetica-Bold').fontSize(22).fillColor(colors.white).text(invoice.settings.storeName.charAt(0).toUpperCase(), left, 58, { width: 52, align: 'center' });
    };
    if (logo) { try { document.image(logo.buffer, left, 44, { fit: [58, 58], valign: 'center' }); } catch { fallbackLogo(); } }
    else fallbackLogo();
    document.font('Helvetica-Bold').fontSize(17).fillColor(colors.navy).text(invoice.settings.storeName, left + 68, 44, { width: 260 });
    document.font('Helvetica').fontSize(8.5).fillColor(colors.muted).text([invoice.settings.storeAddress, invoice.settings.storePhone, invoice.settings.storeEmail].filter(Boolean).join('\n'), left + 68, 68, { width: 270, lineGap: 2 });
    document.font('Helvetica-Bold').fontSize(23).fillColor(colors.primaryStrong).text('INVOICE', right - 160, 44, { width: 160, align: 'right' });
    document.font('Helvetica-Bold').fontSize(10).fillColor(colors.navy).text(invoice.invoiceNumber, right - 160, 75, { width: 160, align: 'right' });
    document.font('Helvetica').fontSize(8.5).fillColor(colors.muted).text(new Date(invoice.soldAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }), right - 160, 92, { width: 160, align: 'right' });
    if (invoice.status === 'VOIDED') {
      document.roundedRect(right - 58, 110, 58, 20, 5).fill('#FEF2F2');
      document.font('Helvetica-Bold').fontSize(9).fillColor(colors.danger).text('VOID', right - 58, 116, { width: 58, align: 'center' });
    }
    document.moveTo(left, 142).lineTo(right, 142).lineWidth(1).strokeColor(colors.border).stroke();
    document.roundedRect(left, 160, width, 86, 8).fill(colors.surface);
    label('BILL TO', left + 14, 175);
    document.font('Helvetica-Bold').fontSize(12).fillColor(colors.navy).text(invoice.customer.name, left + 14, 193, { width: width - 28 });
    document.font('Helvetica').fontSize(8.5).fillColor(colors.muted).text([invoice.customer.phone, invoice.customer.email, invoice.customer.address].filter(Boolean).join('  •  ') || '—', left + 14, 213, { width: width - 28 });

    const columns = [0, 220, 310, 360, 420];
    const columnWidths = [220, 90, 50, 60, width - 420];
    const tableHeader = (y: number) => {
      document.rect(left, y, width, 27).fill(colors.navy);
      ['Item', 'Color', 'Rolls', 'Meter', 'Amount'].forEach((heading, index) => document.font('Helvetica-Bold').fontSize(8).fillColor(colors.white).text(heading, left + columns[index] + 8, y + 9, { width: columnWidths[index] - 16, align: index > 1 ? 'right' : 'left' }));
      return y + 27;
    };
    let rowY = tableHeader(268);
    for (const line of invoice.lines) {
      if (rowY + 42 > document.page.height - 60) { document.addPage(); rowY = tableHeader(44); }
      document.font('Helvetica-Bold').fontSize(8.5).fillColor(colors.navy).text(line.itemCode, left + 8, rowY + 9, { width: columnWidths[0] - 16 });
      if (line.description || line.itemName) document.font('Helvetica').fontSize(7.5).fillColor(colors.muted).text(line.description || line.itemName || '', left + 8, rowY + 22, { width: columnWidths[0] - 16 });
      document.font('Helvetica').fontSize(8.5).fillColor(colors.body).text(line.color, left + columns[1] + 8, rowY + 12, { width: columnWidths[1] - 16 });
      document.text(String(line.rollsSold), left + columns[2] + 8, rowY + 12, { width: columnWidths[2] - 16, align: 'right' });
      document.text(line.meterSold?.toLocaleString('en-BD') ?? '—', left + columns[3] + 8, rowY + 12, { width: columnWidths[3] - 16, align: 'right' });
      document.font('Helvetica-Bold').fillColor(colors.navy).text(amount(line.lineTotal), left + columns[4] + 8, rowY + 12, { width: columnWidths[4] - 16, align: 'right' });
      rowY += 42;
      document.moveTo(left, rowY).lineTo(right, rowY).lineWidth(0.7).strokeColor(colors.border).stroke();
    }
    document.y = rowY + 18;
    ensureSpace(190);
    const totalsX = right - 245;
    const totalRow = (title: string, value: number, options?: { grand?: boolean; warning?: boolean }) => {
      const y = document.y;
      if (options?.grand) document.roundedRect(totalsX - 10, y - 5, 255, 29, 5).fill('#EFF6FF');
      document.font(options?.grand ? 'Helvetica-Bold' : 'Helvetica').fontSize(options?.grand ? 10.5 : 8.5).fillColor(options?.warning ? colors.warning : options?.grand ? colors.primaryStrong : colors.body).text(title, totalsX, y, { width: 120 });
      document.font(options?.grand ? 'Helvetica-Bold' : 'Helvetica').text(amount(value), totalsX + 120, y, { width: 115, align: 'right' });
      document.y = y + (options?.grand ? 32 : 20);
    };
    totalRow('Subtotal', invoice.subtotal); totalRow('Discount', invoice.discountAmount);
    totalRow('Grand Total', invoice.totalAmount, { grand: true }); totalRow('Received at Sale', invoice.receivedAmount);
    totalRow('Total Paid', invoice.paidAmount); totalRow('Due', invoice.dueAmount, { warning: true }); totalRow('Change Returned', invoice.changeAmount);

    if (invoice.payments.length) {
      ensureSpace(48 + invoice.payments.length * 24);
      const y = document.y + 12; label('PAYMENT HISTORY', left, y); let paymentY = y + 19;
      document.rect(left, paymentY, width, 23).fill(colors.surface);
      ['Date', 'Method / Reference', 'Amount'].forEach((heading, index) => document.font('Helvetica-Bold').fontSize(7.5).fillColor(colors.body).text(heading, left + [8, 125, 400][index], paymentY + 8, { width: [105, 265, width - 408][index], align: index === 2 ? 'right' : 'left' }));
      paymentY += 23;
      for (const payment of invoice.payments) {
        if (paymentY + 24 > document.page.height - 62) { document.addPage(); paymentY = 44; }
        document.font('Helvetica').fontSize(8).fillColor(colors.body).text(new Date(payment.receivedAt).toLocaleDateString('en-GB'), left + 8, paymentY + 7, { width: 105 });
        document.text([payment.method.replace(/_/g, ' '), payment.reference].filter(Boolean).join(' · '), left + 125, paymentY + 7, { width: 265 });
        document.font('Helvetica-Bold').text(amount(payment.amount), left + 400, paymentY + 7, { width: width - 408, align: 'right' });
        paymentY += 24; document.moveTo(left, paymentY).lineTo(right, paymentY).lineWidth(0.5).strokeColor(colors.border).stroke(); document.y = paymentY;
      }
    }
    if (invoice.notes) {
      ensureSpace(70); const y = document.y + 18; document.roundedRect(left, y, width, 55, 7).fill(colors.surface); label('NOTES', left + 12, y + 11);
      document.font('Helvetica').fontSize(8.5).fillColor(colors.body).text(invoice.notes, left + 12, y + 29, { width: width - 24, height: 20, ellipsis: true }); document.y = y + 55;
    }
    if (invoice.status === 'VOIDED') {
      ensureSpace(66); const y = document.y + 16; document.roundedRect(left, y, width, 50, 7).fill('#FEF2F2');
      document.font('Helvetica-Bold').fontSize(10).fillColor(colors.danger).text('VOID INVOICE', left + 12, y + 10);
      document.font('Helvetica').fontSize(8.5).text(invoice.voidReason || 'No reason provided.', left + 12, y + 27, { width: width - 24 }); document.y = y + 50;
    }
    const pageCount = document.bufferedPageRange().count;
    for (let page = 0; page < pageCount; page += 1) {
      document.switchToPage(page); const footerY = document.page.height - 42;
      document.moveTo(left, footerY - 10).lineTo(right, footerY - 10).lineWidth(0.7).strokeColor(colors.border).stroke();
      document.font('Helvetica').fontSize(7.5).fillColor(colors.muted).text(`Thank you for your business.  ·  ${invoice.settings.storeName}${invoice.settings.storePhone ? `  ·  ${invoice.settings.storePhone}` : ''}${invoice.settings.storeEmail ? `  ·  ${invoice.settings.storeEmail}` : ''}`, left, footerY, { width: width - 45, align: 'center' });
      if (pageCount > 1) document.text(`${page + 1} / ${pageCount}`, right - 40, footerY, { width: 40, align: 'right' });
    }
    document.end();
  });
}
