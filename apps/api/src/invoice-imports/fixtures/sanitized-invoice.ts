import PDFDocument from 'pdfkit';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { ExtractedDocument } from '../document-types.js';

// Invented business identifiers and supplier; no private documents are stored here.
export const invoiceLines = [
  'Commercial Invoice',
  'Contract No.: B0312614',
  'EXPORTER / BENEFICIARY: SANITIZED LEATHER CO., LTD',
  'Order List',
  'Item No. | Description | Color code | Quantity (Meter) | Rolls quantity | Unit Price | Total Amount',
  'T902 | PVC LEATHER Size: 1.2mm*54"*36.5m | 1#Black | 1502 | 41 | 2.00 | 3004.00',
  ' | | 02#Pine green | 1263.5 | 35 | 2.00 | 2527.00',
  ' | | 03#Deep coffee | 1218 | 33 | | ',
  ' | | 19#Beige | 1287 | 35 | | ',
  'T639 | PVC LEATHER Size: 0.8mm*54"*40m | F07111#Green | 400 | 10 | | ',
  'Freight  200',
  'Loading/Export charge  50',
  'Total Meter: 5670.5',
  'Total Rolls: 154',
  'Payment: By bank transfer',
  'Banking Details',
];
export const documentFixture = (lines = invoiceLines): ExtractedDocument => ({
  method: 'PDF_TEXT',
  warnings: [],
  lines: lines.map((text, i) => ({
    text,
    page: 1,
    line: i + 1,
    method: 'PDF_TEXT',
  })),
});
export async function pdfFixture(pages: (string[] | Buffer)[]) {
  const doc = new PDFDocument({
    size: [1100, 1600],
    margin: 25,
    autoFirstPage: false,
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  for (const page of pages) {
    doc.addPage();
    if (Buffer.isBuffer(page)) doc.image(page, 25, 25, { fit: [1050, 1500] });
    else
      page.forEach((line, i) => {
        const cells =
          line.split('|').length === 7
            ? line.split('|').map((cell) => cell.trim())
            : [line];
        const positions = [25, 115, 410, 590, 710, 810, 915];
        cells.forEach((cell, column) => {
          if (cell)
            doc
              .font('Helvetica')
              .fontSize(8)
              .text(cell, positions[column] ?? 25, 30 + i * 28, {
                lineBreak: false,
              });
        });
      });
  }
  doc.end();
  return done;
}
export function imageFixture(lines: string[], format: 'png' | 'jpg' = 'png') {
  const require = createRequire(import.meta.url);
  GlobalFonts.registerFromPath(
    join(
      dirname(require.resolve('pdfjs-dist/package.json')),
      'standard_fonts/LiberationSans-Regular.ttf',
    ),
    'InvoiceFixture',
  );
  const canvas = createCanvas(2350, Math.max(400, lines.length * 60 + 80));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';
  ctx.font = '25px InvoiceFixture';
  const positions = [30, 250, 930, 1310, 1560, 1780, 2000];
  lines.forEach((line, i) => {
    const cells =
      line.split('|').length === 7
        ? line.split('|').map((cell) => cell.trim())
        : [line];
    cells.forEach((cell, column) => {
      if (cell) ctx.fillText(cell, positions[column] ?? 30, 55 + i * 60);
    });
  });
  return format === 'png'
    ? canvas.toBuffer('image/png')
    : canvas.toBuffer('image/jpeg', 95);
}
