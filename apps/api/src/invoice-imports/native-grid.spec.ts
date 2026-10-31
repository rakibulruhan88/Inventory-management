import { groupPositionedSpans } from './document-reader.js';
import { parseCommercialInvoice } from './commercial-invoice-parser.js';
import type {
  DocumentCell,
  DocumentSpan,
  ExtractedDocument,
} from './document-types.js';

// Invented identifiers/values reproduce a spreadsheet export that packs two
// colors into one physical cell and centers the item below its first rows.
function packedNativeTable(): ExtractedDocument {
  const spans: DocumentSpan[] = [];
  const add = (text: string, column: number, y: number) => {
    const span = {
      text,
      x: column * 200 + 20,
      y,
      width: Math.min(160, text.length * 6),
      height: 10,
    };
    spans.push(span);
    return span;
  };
  add('Commercial Invoice Contract No.:', 0, 10);
  add('TEST2614', 0, 30);
  add('SUPPLIER: SANITIZED SUPPLIER', 0, 60);
  add('Order List', 0, 85);
  [
    'Item No.',
    'Description',
    'Color code',
    'Meter',
    'Rolls',
    'Unit Price',
  ].forEach((s, c) => add(s, c, 120));
  add('1#Black 02#Pine', 2, 175);
  add('green', 2, 225);
  add('12.5', 3, 175);
  add('1', 4, 175);
  add('25', 3, 225);
  add('2', 4, 225);
  add('TEST-A', 0, 275);
  add('Size: 1.2mm*54"*36.5m', 1, 275);
  add('03#Beige', 2, 350);
  add('10', 3, 350);
  add('1', 4, 350);
  add('TEST-B', 0, 450);
  add('1#Black', 2, 450);
  add('10', 3, 450);
  add('1', 4, 450);
  add('Total Amount', 2, 550);
  add('57.5', 3, 550);
  add('5', 4, 550);
  const cells: DocumentCell[] = [];
  for (let column = 0; column < 6; column++) {
    const cuts = column < 2 ? [100, 400, 500, 600] : [100, 300, 400, 500, 600];
    for (let i = 0; i < cuts.length - 1; i++) {
      const words = spans.filter(
        (s) =>
          s.x >= column * 200 &&
          s.x < (column + 1) * 200 &&
          s.y >= cuts[i] &&
          s.y < cuts[i + 1],
      );
      cells.push({
        x: column * 200 + 3,
        y: cuts[i] + 3,
        width: 194,
        height: cuts[i + 1] - cuts[i] - 6,
        text: words.map((s) => s.text).join(' '),
        spans: words,
      });
    }
  }
  return {
    method: 'PDF_TEXT',
    warnings: [],
    lines: groupPositionedSpans(spans).map((row, i) => ({
      ...row,
      page: 1,
      line: i + 1,
      method: 'PDF_TEXT' as const,
    })),
    pages: [
      {
        page: 1,
        method: 'PDF_TEXT',
        width: 1200,
        height: 1000,
        rules: [],
        cells,
      },
    ],
  };
}
describe('packed native spreadsheet cells', () => {
  it('uses cell ownership, joins wrapped color names, and reads totals in Color column', () => {
    const r = parseCommercialInvoice(packedNativeTable(), 'draft');
    expect(r.containerNumber).toBe('TEST2614');
    expect(r.items.map((i) => i.itemCode)).toEqual(['TEST-A', 'TEST-B']);
    expect(r.items[0].colors.map((c) => c.color)).toEqual([
      '1#Black',
      '02#Pine green',
      '03#Beige',
    ]);
    expect(r.items[1].colors.map((c) => c.color)).toEqual(['1#Black']);
    expect(r.invoiceTotals).toEqual({ rolls: 5, meter: 57.5 });
    expect(r.totalsMatch).toEqual({ rolls: true, meter: true });
  });
  it('requires review when packed colors and positioned number counts differ', () => {
    const d = packedNativeTable();
    const colorCell = d.pages![0].cells!.find((c) =>
      c.text.includes('1#Black 02#Pine'),
    )!;
    colorCell.spans.push({
      text: '03#Extra',
      x: 420,
      y: 250,
      width: 70,
      height: 10,
    });
    const r = parseCommercialInvoice(d, 'draft');
    expect(r.warnings.some((w) => w.code === 'COLOR_CODE_UNCERTAIN')).toBe(
      true,
    );
    expect(r.validationPassed).toBe(false);
  });
});
