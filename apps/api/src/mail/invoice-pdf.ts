import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import type { SaleInvoice } from '@afia/contracts';

const colors = {
  ink: '#26231F',
  body: '#4F4942',
  muted: '#82796F',
  border: '#DED8CF',
  warm: '#F7F4EE',
  cognac: '#895332',
  danger: '#A1352B',
};

export type EmbeddedImage = {
  buffer: Buffer;
  contentType: 'image/png' | 'image/jpeg';
  extension: 'png' | 'jpg';
};

export function dataUrlImage(value?: string | null): EmbeddedImage | null {
  if (!value) return null;
  const match = /^data:(image\/(?:png|jpeg));base64,([a-z0-9+/=\s]+)$/i.exec(
    value,
  );
  if (!match) return null;
  try {
    const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
    if (!buffer.length) return null;
    const contentType = match[1].toLowerCase() as 'image/png' | 'image/jpeg';
    return {
      buffer,
      contentType,
      extension: contentType === 'image/png' ? 'png' : 'jpg',
    };
  } catch {
    return null;
  }
}

export function invoiceFileName(invoice: SaleInvoice) {
  const store =
    invoice.settings.storeName
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '') || 'Invoice';
  return `${store}-${invoice.invoiceNumber}.pdf`;
}

export function createInvoicePdf(invoice: SaleInvoice): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 42, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont(
      'Money',
      fileURLToPath(
        new URL('./fonts/NotoSansBengali-Regular.ttf', import.meta.url),
      ),
    );
    const left = 42,
      right = doc.page.width - 42,
      width = right - left,
      bottom = doc.page.height - 72;
    const money = (n: number | null | undefined) =>
      n == null
        ? '—'
        : `${invoice.settings.currencySymbol}${n.toLocaleString('en-BD', { maximumFractionDigits: 2, minimumFractionDigits: n % 1 ? 2 : 0 })}`;
    const date = (s: string) =>
      new Date(s).toLocaleDateString('en-GB', {
        timeZone: 'Asia/Dhaka',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    const text = (
      s: string,
      x: number,
      y: number,
      w: number,
      size = 9,
      bold = false,
      align: 'left' | 'right' = 'left',
      font?: string,
    ) => {
      doc
        .font(font ?? (bold ? 'Helvetica-Bold' : 'Helvetica'))
        .fontSize(size)
        .fillColor(colors.ink)
        .text(s, x, y, { width: w, align, lineGap: 3 });
    };
    const height = (
      s: string,
      w: number,
      size = 9,
      bold = false,
      font?: string,
    ) =>
      doc
        .font(font ?? (bold ? 'Helvetica-Bold' : 'Helvetica'))
        .fontSize(size)
        .heightOfString(s, { width: w, lineGap: 3 });
    const rule = (y: number, x = left, w = width) =>
      doc
        .moveTo(x, y)
        .lineTo(x + w, y)
        .strokeColor(colors.border)
        .lineWidth(0.6)
        .stroke();
    let y = 42;
    const logo = dataUrlImage(invoice.settings.logoUrl);
    let brandX = left;
    if (logo) {
      try {
        doc.image(logo.buffer, left, y, { fit: [42, 42] });
        brandX += 54;
      } catch {
        /* Broken historical logo must not prevent printing. */
      }
    }
    const nameHeight = height(invoice.settings.storeName, 250, 20, true);
    text(invoice.settings.storeName, brandX, y, 250, 20, true);
    const contacts = [
      invoice.settings.storeAddress,
      invoice.settings.storePhone,
      invoice.settings.storeEmail,
    ]
      .filter(Boolean)
      .join('\n');
    const contactHeight = height(contacts, 245, 8);
    text(contacts, brandX, y + nameHeight + 6, 245, 8);
    const identityX = right - 175;
    text('INVOICE', identityX, y, 175, 24, true, 'right');
    text(invoice.invoiceNumber, identityX, y + 37, 175, 10, true, 'right');
    text(date(invoice.soldAt), identityX, y + 54, 175, 9, false, 'right');
    y += Math.max(nameHeight + contactHeight + 22, 84);
    rule(y);
    y += 20;
    text('BILL TO', left, y, width, 8, true);
    y += 16;
    const customerHeight = height(invoice.customer.name, width, 13, true);
    text(invoice.customer.name, left, y, width, 13, true);
    y += customerHeight + 5;
    const customerContact = [
      invoice.customer.phone,
      invoice.customer.address,
      invoice.customer.email,
    ]
      .filter(Boolean)
      .join(' · ');
    text(customerContact, left, y, width, 9);
    y += height(customerContact, width, 9) + 20;
    if (invoice.status === 'VOIDED') {
      text(
        `VOID INVOICE · ${invoice.voidReason ?? ''}`,
        left,
        y,
        width,
        10,
        true,
      );
      y +=
        height(`VOID INVOICE · ${invoice.voidReason ?? ''}`, width, 10, true) +
        16;
    }
    const widths = [70, 108, 95, 34, 43, 78, width - 428];
    const offsets = widths.map((_, i) =>
      widths.slice(0, i).reduce((a, b) => a + b, 0),
    );
    const headings = [
      'Item',
      'Description / Size',
      'Color',
      'Rolls',
      'Meter',
      'Price / Roll',
      'Amount',
    ];
    const tableHeader = () => {
      doc.rect(left, y, width, 29).fill(colors.warm);
      headings.forEach((h, i) =>
        text(
          h,
          left + offsets[i] + 6,
          y + 10,
          widths[i] - 12,
          8,
          true,
          i > 2 ? 'right' : 'left',
        ),
      );
      rule(y);
      rule(y + 29);
      y += 29;
    };
    const newPage = () => {
      doc.addPage();
      y = 42;
      text(
        `${invoice.settings.storeName} · ${invoice.invoiceNumber}`,
        left,
        y,
        width,
        9,
        true,
      );
      y += 26;
    };
    tableHeader();
    for (const line of invoice.lines) {
      const values = [
        line.itemCode,
        line.description || line.itemName || '—',
        line.color,
        String(line.rollsSold),
        line.meterSold?.toLocaleString('en-BD') ?? '—',
        money(line.unitPricePerRoll),
        money(line.lineTotal),
      ];
      const rowHeight = Math.max(
        38,
        ...values.map(
          (v, i) =>
            height(
              v,
              widths[i] - 12,
              8.5,
              i === 0,
              i > 4 ? 'Money' : undefined,
            ) + 22,
        ),
      );
      if (y + rowHeight > bottom) {
        newPage();
        tableHeader();
      }
      // Tall source text is flowed by PDFKit; normal row heights are measured,
      // so long descriptions and monetary values are never clipped to fixed cells.
      values.forEach((v, i) =>
        text(
          v,
          left + offsets[i] + 6,
          y + 11,
          widths[i] - 12,
          8.5,
          i === 0,
          i > 2 ? 'right' : 'left',
          i > 4 ? 'Money' : undefined,
        ),
      );
      y += rowHeight;
      rule(y);
    }
    if (!invoice.lines.length) {
      text('No items recorded.', left, y + 12, width, 9);
      y += 40;
    }
    y += 20;
    const paidAtSale =
      Math.round((invoice.receivedAmount - invoice.changeAmount) * 100) / 100;
    const totals: [string, number | null | undefined, boolean?][] = [
      ['Subtotal', invoice.subtotal],
      ['Discount', invoice.discountAmount],
      ['Invoice Total', invoice.totalAmount, true],
      ['Paid at Sale', paidAtSale],
      ...(invoice.paidAmount > paidAtSale
        ? [
            [
              'Later Payments',
              Math.round((invoice.paidAmount - paidAtSale) * 100) / 100,
            ] as [string, number],
          ]
        : []),
      ['Paid', invoice.paidAmount],
      ['Invoice Due', invoice.dueAmount, true],
      ...(invoice.changeAmount > 0
        ? [['Change Returned', invoice.changeAmount] as [string, number]]
        : []),
    ];
    if (y + totals.length * 26 + 20 > bottom) newPage();
    const summaryY = y,
      totalsX = right - 250;
    text('CUSTOMER DUE AT SALE', left, y, 220, 8, true);
    y += 22;
    const dues: [string, number | null | undefined][] = [
      ['Previous Due', invoice.previousOutstandingBeforeSale],
      [
        'This Invoice Due',
        Math.round((invoice.totalAmount - paidAtSale) * 100) / 100,
      ],
      ['Total Due After Sale', invoice.outstandingAfterSale],
    ];
    for (const [label, value] of dues) {
      text(label, left, y, 135, 8);
      text(money(value), left + 135, y, 90, 9, false, 'right', 'Money');
      y += 25;
    }
    const dueEnd = y;
    y = summaryY;
    for (const [label, value, strong] of totals) {
      if (strong) {
        doc.rect(totalsX - 8, y - 6, 258, 27).fill(colors.warm);
      }
      text(label, totalsX, y, 135, strong ? 10 : 9, !!strong);
      text(
        money(value),
        totalsX + 135,
        y,
        115,
        strong ? 10 : 9,
        false,
        'right',
        'Money',
      );
      y += 27;
    }
    y = Math.max(y, dueEnd) + 16;
    if (invoice.payments.length) {
      if (y + 55 > bottom) newPage();
      const paymentHeader = () => {
        text('PAYMENT HISTORY', left, y, width, 8, true);
        y += 18;
        rule(y);
        y += 10;
      };
      paymentHeader();
      for (const p of invoice.payments) {
        const method = {
          CASH: 'Cash',
          BANK: 'Bank',
          MOBILE_BANKING: 'Mobile Banking',
          OTHER: 'Other',
        }[p.method];
        const details = [method, p.receiptNumber, p.reference]
          .filter(Boolean)
          .join(' · ');
        const rowHeight = Math.max(26, height(details, width - 195, 8) + 12);
        if (y + rowHeight > bottom) {
          newPage();
          paymentHeader();
        }
        text(date(p.receivedAt), left, y, 95, 8);
        text(details, left + 105, y, width - 205, 8);
        text(money(p.amount), right - 95, y, 95, 9, false, 'right', 'Money');
        y += rowHeight;
        rule(y - 5);
      }
      y += 16;
    }
    if (invoice.notes) {
      if (y + 45 > bottom) newPage();
      text('NOTE', left, y, width, 8, true);
      y += 17;
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(colors.body)
        .text(invoice.notes, left, y, { width, lineGap: 4 });
      y = doc.y + 20;
    }
    if (y + 70 > bottom) newPage();
    y += 35;
    rule(y, left, 190);
    rule(y, right - 190, 190);
    text('Customer Signature', left, y + 9, 190, 8);
    text('Authorized Signature', right - 190, y + 9, 190, 8, false, 'right');
    const pages = doc.bufferedPageRange();
    for (let i = pages.start; i < pages.start + pages.count; i++) {
      doc.switchToPage(i);
      const footer = doc.page.height - 58;
      rule(footer - 10);
      text('Thank you for your business.', left, footer, width - 45, 8);
      text(
        `${i + 1} / ${pages.count}`,
        right - 40,
        footer,
        40,
        8,
        false,
        'right',
      );
    }
    doc.end();
  });
}
