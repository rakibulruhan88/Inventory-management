import { OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pdfTableGeometry, nativeTableCells } from './pdf-geometry.js';
import { nativeTextUsable } from './document-reader.js';
import PDFDocument from 'pdfkit';
import { ConfigService } from '@nestjs/config';
import { DocumentExtractor } from './document-extractor.js';
import { parseCommercialInvoice } from './commercial-invoice-parser.js';

const viewport = {
  transform: [2, 0, 0, -2, 0, 1000],
  width: 1200,
  height: 1000,
};
describe('PDF vector table geometry', () => {
  const rectangle = (x: number, y: number, width: number, height: number) =>
    new Float32Array([
      0,
      x,
      y,
      1,
      x + width,
      y,
      1,
      x + width,
      y + height,
      1,
      x,
      y + height,
      4,
    ]);
  it.each([OPS.fill, OPS.eoFill])(
    'reads thin filled spreadsheet borders with paint %s',
    (paint) => {
      const geometry = pdfTableGeometry(
        {
          fnArray: [OPS.constructPath, OPS.constructPath],
          argsArray: [
            [paint, [rectangle(10, 20, 200, 0.5)]],
            [paint, [rectangle(10, 20, 0.5, 180)]],
          ],
        },
        viewport,
      );
      expect(geometry.rules).toEqual([
        { x0: 20, x1: 420, y0: 959.5, y1: 959.5 },
        { x0: 20.5, x1: 20.5, y0: 600, y1: 960 },
      ]);
    },
  );
  it('rejects filled backgrounds, open paths, compound paths and unpainted borders', () => {
    const thin = rectangle(10, 20, 200, 0.5);
    for (const [paint, commands] of [
      [OPS.fill, rectangle(10, 20, 200, 20)],
      [OPS.fill, thin.slice(0, -1)],
      [OPS.fill, new Float32Array([...thin, ...thin])],
      [OPS.endPath, thin],
      [OPS.clip, thin],
    ] as const) {
      expect(
        pdfTableGeometry(
          { fnArray: [OPS.constructPath], argsArray: [[paint, [commands]]] },
          viewport,
        ).rules,
      ).toEqual([]);
    }
  });
  it('assigns all rows to vertically centered item cells in a native PDF with filled borders', async () => {
    const pdf = new PDFDocument({ size: [600, 800], margin: 0 });
    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>((resolve, reject) => {
      pdf.on('data', (chunk) => chunks.push(chunk));
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);
    });
    const text = (value: string, x: number, y: number) =>
      pdf
        .font('Times-Bold')
        .fontSize(9)
        .text(value, x, y, { lineBreak: false });
    text('Commercial Invoice', 30, 30);
    text('Contract No.: TEST-FILLED-01', 30, 50);
    text('SUPPLIER: SANITIZED LEATHER CO.,LTD', 30, 70);
    text('Order List', 30, 90);
    const edges = [30, 100, 280, 390, 470, 550];
    ['Item No.', 'Description', 'Color code', 'Meter', 'Rolls'].forEach(
      (label, i) => text(label, edges[i] + 4, 109),
    );
    // Emit text in visual row order. Centered labels must not leave earlier
    // rows ownerless or assign the next group's first rows to this group.
    for (let group = 0; group < 2; group++) {
      const top = 130 + group * 120;
      for (let row = 0; row < 5; row++) {
        text(`${row + 1}#Color${row}`, 286, top + row * 24 + 7);
        text(String(100 + group * 10 + row + 0.5), 398, top + row * 24 + 7);
        text(String(3 + group), 478, top + row * 24 + 7);
      }
      text(`TEST-${group + 1}`, 34, top + 56);
      text('PVC LEATHER Size:', 104, top + 36);
      text('1.1mm*54*36.5m', 104, top + 52);
      text('Brush backing', 104, top + 68);
    }
    text('LC ammount', 34, 380);
    text('Total Amount', 34, 404);
    text('1075', 398, 404);
    text('35', 478, 404);
    // Same filled-rectangle representation as spreadsheet PDF exports.
    const horizontal = (x: number, y: number, right: number) =>
      pdf.rect(x, y, right - x, 0.5).fill('black');
    const vertical = (x: number, y: number, bottom: number) =>
      pdf.rect(x, y, 0.5, bottom - y).fill('black');
    for (const y of [100, 130, 250, 370, 394, 418]) horizontal(30, y, 550);
    for (const x of edges) vertical(x, 100, 418);
    for (const top of [130, 250])
      for (let row = 1; row < 5; row++) horizontal(280, top + row * 24, 550);
    pdf.end();
    const extractor = new DocumentExtractor(new ConfigService());
    try {
      const document = await extractor.extract(await done, 'application/pdf');
      const review = parseCommercialInvoice(
        document,
        'filled-border-regression',
      );
      expect(document.method).toBe('PDF_TEXT');
      expect(review.items.map((item) => item.itemCode)).toEqual([
        'TEST-1',
        'TEST-2',
      ]);
      expect(
        review.items.map((item) =>
          item.colors.map((color) => [color.color, color.meter, color.rolls]),
        ),
      ).toEqual(
        [0, 1].map((group) =>
          Array.from({ length: 5 }, (_, row) => [
            `${row + 1}#Color${row}`,
            100 + group * 10 + row + 0.5,
            3 + group,
          ]),
        ),
      );
      expect(review.items.map((item) => item.description)).toEqual([
        '1.1mm*54*36.5m',
        '1.1mm*54*36.5m',
      ]);
      expect(review.invoiceTotals).toEqual({ meter: 1075, rolls: 35 });
      expect(review.parsedTotals).toEqual(review.invoiceTotals);
      expect(review.unassignedRows).toEqual([]);
      expect(review.warnings).toEqual([]);
    } finally {
      extractor.onModuleDestroy();
    }
  }, 30000);
  it('uses transformed painted rules and ignores clipping paths', () => {
    const commands = new Float32Array([
      0, 10, 20, 1, 200, 20, 0, 10, 20, 1, 10, 180,
    ]);
    const geometry = pdfTableGeometry(
      {
        fnArray: [
          OPS.save,
          OPS.transform,
          OPS.constructPath,
          OPS.restore,
          OPS.constructPath,
        ],
        argsArray: [
          [],
          [1, 0, 0, 1, 5, 10],
          [OPS.stroke, [commands]],
          [],
          [OPS.clip, [commands]],
        ],
      },
      viewport,
    );
    expect(geometry.rules).toEqual([
      { x0: 30, x1: 410, y0: 940, y1: 940 },
      { x0: 30, x1: 30, y0: 620, y1: 940 },
    ]);
    expect(geometry.nonRuleContent).toBe(false);
  });
  it('never treats images, curves or filled backgrounds as an empty page', () => {
    for (const list of [
      { fnArray: [OPS.paintImageXObject], argsArray: [[]] },
      {
        fnArray: [OPS.constructPath],
        argsArray: [[OPS.fill, [new Float32Array([0, 0, 0, 1, 10, 10])]]],
      },
      {
        fnArray: [OPS.constructPath],
        argsArray: [
          [OPS.stroke, [new Float32Array([0, 0, 0, 2, 1, 2, 3, 4, 5, 6])]],
        ],
      },
    ])
      expect(pdfTableGeometry(list, viewport).nonRuleContent).toBe(true);
  });
  it('retains row geometry in a wide native table with extra empty spreadsheet columns', () => {
    const rules = Array.from({ length: 16 }, (_, i) => ({
      x0: i * 70,
      x1: i * 70,
      y0: 100,
      y1: 900,
    }));
    rules.push(
      ...[100, 300, 500, 700, 900].map((y) => ({
        x0: 0,
        x1: 1050,
        y0: y,
        y1: y,
      })),
    );
    const cells = nativeTableCells(
      rules,
      [{ text: 'TEST2614', x: 10, y: 220, width: 40, height: 10 }],
      1200,
      1000,
    );
    expect(cells).toHaveLength(60);
    expect(cells.filter((c) => c.text)).toHaveLength(1);
  });
  it('uses OCR when native font text is corrupted even if headings survive', () => {
    expect(
      nativeTextUsable('1#Black 1502 41\nContract No.\n\ufffd\ufffd'),
    ).toBe(false);
  });
});
