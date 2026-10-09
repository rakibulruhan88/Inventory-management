import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import {
  invoiceAmounts,
  invoiceSummaryRows,
  type SaleInvoice,
} from '@afia/contracts';

const colors = {
  ink: '#26231F',
  body: '#4F4942',
  muted: '#82796F',
  border: '#DED8CF',
  warm: '#F2E8DE',
  due: '#EEE9E1',
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
    for (const [name, file] of [
      ['Body', 'Inter-Regular.woff'],
      ['BodyBold', 'Inter-Semibold.woff'],
      ['Heading', 'Manrope-Bold.woff'],
    ]) {
      doc.registerFont(
        name,
        fileURLToPath(new URL(`./fonts/${file}`, import.meta.url)),
      );
    }
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
        .font(font ?? (bold ? 'BodyBold' : 'Body'))
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
        .font(font ?? (bold ? 'BodyBold' : 'Body'))
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
    const nameHeight = height(
      invoice.settings.storeName,
      250,
      20,
      true,
      'Heading',
    );
    text(
      invoice.settings.storeName,
      brandX,
      y,
      250,
      20,
      true,
      'left',
      'Heading',
    );
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
    text('Invoice No', identityX, y + 37, 65, 9);
    text(invoice.invoiceNumber, identityX + 70, y + 37, 105, 9, true, 'right');
    text('Date', identityX, y + 54, 65, 9);
    text(date(invoice.soldAt), identityX + 70, y + 54, 105, 9, true, 'right');
    text('Prepared by', identityX, y + 71, 65, 9);
    text(
      invoice.creatorName ?? 'Not recorded',
      identityX + 70,
      y + 71,
      105,
      9,
      true,
      'right',
      /[\u0980-\u09ff]/.test(invoice.creatorName ?? '') ? 'Money' : undefined,
    );
    y += Math.max(nameHeight + contactHeight + 22, 102);
    doc
      .moveTo(left, y)
      .lineTo(right, y)
      .strokeColor(colors.ink)
      .lineWidth(1.5)
      .stroke();
    y += 20;
    text('CUSTOMER', left, y, width, 8, true);
    y += 16;
    const customerHeight = height(invoice.customer.name, width, 13, true);
    text(invoice.customer.name, left, y, width, 13, true);
    y += customerHeight + 5;
    const customerContact = [
      invoice.customer.phone ? `Phone: ${invoice.customer.phone}` : null,
      invoice.customer.address,
      invoice.customer.email,
    ]
      .filter(Boolean)
      .join('\n');
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
    const widths = [0.12, 0.22, 0.2, 0.07, 0.09, 0.15, 0.15].map(
      (ratio) => width * ratio,
    );
    const offsets = widths.map((_, i) =>
      widths.slice(0, i).reduce((a, b) => a + b, 0),
    );
    const headings = [
      'Item',
      'Description / Size',
      'Color',
      'Rolls',
      'Meter',
      invoice.lines.some((line) => line.mode === 'BY_METER')
        ? 'Unit Price'
        : 'Unit Price / Roll',
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
        `${line.itemCode}\nSell By: ${line.mode === 'BY_METER' ? 'Meter' : 'Roll'}`,
        line.description || line.itemName || '—',
        line.color,
        String(line.rollsSold),
        line.meterSold?.toLocaleString('en-BD') ?? '—',
        money(
          line.mode === 'BY_METER'
            ? (line.unitPricePerMeter ?? null)
            : line.unitPricePerRoll,
        ),
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
            ) +
            22 +
            (i === 6 &&
            line.mode === 'BY_METER' &&
            line.unitPricePerMeter != null
              ? height(
                  `${line.meterSold?.toLocaleString('en-BD')} Meter ×`,
                  widths[i] - 12,
                  7,
                ) +
                height(
                  `${money(line.unitPricePerMeter)} = ${money(line.lineTotal)}`,
                  widths[i] - 12,
                  7,
                  false,
                  'Money',
                ) +
                8
              : 0),
        ),
      );
      if (y + rowHeight > bottom) {
        newPage();
        tableHeader();
      }
      // Tall source text is flowed by PDFKit; normal row heights are measured,
      // so long descriptions and monetary values are never clipped to fixed cells.
      values.forEach((v, i) => {
        text(
          v,
          left + offsets[i] + 6,
          y + 11,
          widths[i] - 12,
          8.5,
          i === 0,
          i > 2 ? 'right' : 'left',
          i > 4 ? 'Money' : undefined,
        );
        if (
          i === 6 &&
          line.mode === 'BY_METER' &&
          line.unitPricePerMeter != null
        ) {
          const noteY = y + 14 + height(v, widths[i] - 12, 8.5, false, 'Money');
          const basis = `${line.meterSold?.toLocaleString('en-BD')} Meter ×`;
          text(
            basis,
            left + offsets[i] + 6,
            noteY,
            widths[i] - 12,
            7,
            false,
            'right',
          );
          text(
            `${money(line.unitPricePerMeter)} = ${money(line.lineTotal)}`,
            left + offsets[i] + 6,
            noteY + height(basis, widths[i] - 12, 7) + 2,
            widths[i] - 12,
            7,
            false,
            'right',
            'Money',
          );
        }
      });
      y += rowHeight;
      rule(y);
    }
    if (!invoice.lines.length) {
      text('No items recorded.', left, y + 12, width, 9);
      y += 40;
    }
    y += 20;
    const amounts = invoiceAmounts(invoice);
    const totals = invoiceSummaryRows(invoice);
    const ungrouped = invoice.payments.filter((payment) => !payment.receiptId);
    const salePayment =
      ungrouped.length === 1 && ungrouped[0].amount === amounts.paidAtSale
        ? ungrouped[0]
        : undefined;
    const method = (value: string) =>
      ({
        CASH: 'Cash',
        BANK: 'Bank',
        MOBILE_BANKING: 'Mobile Banking',
        OTHER: 'Other',
      })[value] ?? value;
    const paymentText = salePayment
      ? [
          `Payment Method: ${method(salePayment.method)}`,
          salePayment.reference ? `Reference: ${salePayment.reference}` : null,
        ]
          .filter(Boolean)
          .join('\n')
      : '';
    const columnWidth = (width - 22) / 2;
    const rowHeight = 23;
    const paymentHeight = paymentText
      ? height(paymentText, columnWidth, 9) + 22
      : 0;
    const totalsHeight = 35 + totals.length * rowHeight + paymentHeight;
    if (y + totalsHeight > bottom) newPage();
    const summaryY = y,
      totalsX = left + columnWidth + 22;
    const unknownDues =
      amounts.previousDue == null || amounts.totalDueAfterSale == null;
    const dueCaption = 'When this sale was made';
    const dueNote = 'Previous customer due was not saved for this invoice.';
    const dueHeight =
      57 +
      3 * rowHeight +
      (unknownDues ? height(dueNote, columnWidth - 20, 8) + 14 : 0);
    doc.rect(left, summaryY, columnWidth, dueHeight).fill(colors.due);
    text('Customer Due', left + 10, summaryY + 12, columnWidth - 20, 10, true);
    text(dueCaption, left + 10, summaryY + 32, columnWidth - 20, 9);
    y = summaryY + 55;
    const dues: [string, number | null | undefined][] = [
      ['Previous Due', amounts.previousDue],
      ['This Invoice Due', amounts.dueAtSale],
      ['Total Due After Sale', amounts.totalDueAfterSale],
    ];
    for (const [label, value] of dues) {
      const strong = label === 'Total Due After Sale';
      if (strong) {
        rule(y - 5, left + 10, columnWidth - 20);
        rule(y + rowHeight - 5, left + 10, columnWidth - 20);
      }
      text(label, left + 10, y, columnWidth - 85, 8.5, strong);
      text(
        money(value),
        left + columnWidth - 75,
        y,
        65,
        9,
        false,
        'right',
        'Money',
      );
      y += rowHeight;
    }
    if (unknownDues) text(dueNote, left + 10, y + 4, columnWidth - 20, 8);
    doc
      .moveTo(totalsX, summaryY)
      .lineTo(right, summaryY)
      .strokeColor(colors.cognac)
      .lineWidth(1.5)
      .stroke();
    text('Current Sale', totalsX, summaryY + 12, columnWidth, 11, true);
    y = summaryY + 35;
    for (const { label, value, strong } of totals) {
      if (strong) {
        rule(y - 5, totalsX, columnWidth);
        rule(y + rowHeight - 5, totalsX, columnWidth);
      }
      const size = label === 'Invoice Total' ? 12 : 10;
      text(label, totalsX, y, columnWidth - 85, size, !!strong);
      text(money(value), right - 85, y, 85, size, false, 'right', 'Money');
      y += rowHeight;
    }
    if (paymentText) {
      rule(y + 3, totalsX, columnWidth);
      text(paymentText, totalsX, y + 14, columnWidth, 9);
      y += paymentHeight;
    }
    y = Math.max(y, summaryY + dueHeight) + 16;
    if (invoice.notes) {
      if (y + 45 > bottom) newPage();
      text('NOTE', left, y, width, 8, true);
      y += 17;
      doc
        .font('Body')
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
      doc
        .font('Body')
        .fontSize(8)
        .fillColor(colors.muted)
        .text('Thank you for your business.', left, footer, {
          width,
          align: 'center',
        });
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
