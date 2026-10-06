import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import {
  supplierLayoutGroups,
  supplierLayoutRows,
} from './supplier-layout-invoice.js';
export function ruledInvoiceImage(
  options: {
    scale?: number;
    rotation?: number;
    blur?: boolean;
    compressed?: boolean;
  } = {},
) {
  const require = createRequire(import.meta.url);
  GlobalFonts.registerFromPath(
    join(
      dirname(require.resolve('pdfjs-dist/package.json')),
      'standard_fonts/LiberationSans-Regular.ttf',
    ),
    'OcrFixture',
  );
  const canvas = createCanvas(2000, 2500),
    ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, 2000, 2500);
  ctx.fillStyle = 'black';
  ctx.font = '30px OcrFixture';
  [
    'Commercial Invoice',
    'Contract Ref: B0312614',
    'SUPPLIER: SANITIZED LEATHER CO.,LTD',
    'ADDR: ROOM 10, TEST ROAD, TEST DISTRICT, TEST CITY',
    'TELEPHONE: +880-000-101',
    'FAX: +880-000-102',
    'ATTN: Test Operator',
    'Product List',
  ].forEach((text, i) => ctx.fillText(text, 40, 65 + i * 45));
  const edges = [40, 260, 790, 1120, 1350, 1550, 1730, 1960],
    top = 445,
    headerBottom = 555;
  const rule = (x0: number, y0: number, x1: number, y1: number) => {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineWidth = 2;
    ctx.stroke();
  };
  const text = (value: string, col: number, y: number, size = 27) => {
    ctx.font = `${size}px OcrFixture`;
    const width = ctx.measureText(value).width;
    ctx.fillText(value, (edges[col] + edges[col + 1] - width) / 2, y);
  };
  const headers = [
    'Style No.',
    'Specification',
    'Colour code',
    'Qty (Meter)',
    'No. of Rolls',
    'Rate',
    'Line Total',
  ];
  headers.forEach((h, i) => text(h, i, 510, 25));
  rule(40, top, 1960, top);
  rule(40, headerBottom, 1960, headerBottom);
  let y = headerBottom,
    index = 0;
  for (const group of supplierLayoutGroups) {
    const start = y,
      step = group.colors.length === 1 ? 110 : 65;
    for (const color of group.colors) {
      const row = supplierLayoutRows[index++];
      text(color, 2, y + 43);
      text(row[3], 3, y + 43);
      text(row[4], 4, y + 43);
      text('1.00', 5, y + 43);
      text('US$' + row[3], 6, y + 43, 23);
      y += step;
      rule(790, y, 1960, y);
    }
    const mid = (start + y) / 2;
    text(group.item, 0, mid + 9);
    text('PVC LEATHER', 1, mid - 23, 24);
    text('S1ze: 1.2mm*54"*36.5m', 1, mid + 8, 24);
    text('Brush backing', 1, mid + 39, 24);
    rule(40, y, 1960, y);
  }
  const bottom = y;
  edges.forEach((x) => rule(x, top, x, bottom + 120));
  for (const label of ['Grand Total', 'Invoice Total']) {
    text(label, 0, y + 40, 23);
    text('35050', 3, y + 40);
    text('964', 4, y + 40);
    y += 60;
    rule(40, y, 1960, y);
  }
  ctx.fillText('Payment Information', 40, y + 80);
  const scale = options.scale ?? 1,
    angle = ((options.rotation ?? 0) * Math.PI) / 180;
  const width = Math.ceil(
      (2000 * Math.cos(angle) + 2500 * Math.abs(Math.sin(angle))) * scale,
    ),
    height = Math.ceil(
      (2500 * Math.cos(angle) + 2000 * Math.abs(Math.sin(angle))) * scale,
    );
  const output = createCanvas(width, height),
    out = output.getContext('2d');
  out.fillStyle = 'white';
  out.fillRect(0, 0, width, height);
  out.translate(width / 2, height / 2);
  out.rotate(angle);
  if (options.blur) out.filter = 'blur(0.45px)';
  out.drawImage(
    canvas,
    -1000 * scale,
    -1250 * scale,
    2000 * scale,
    2500 * scale,
  );
  return options.compressed
    ? output.toBuffer('image/jpeg', 65)
    : output.toBuffer('image/png');
}
