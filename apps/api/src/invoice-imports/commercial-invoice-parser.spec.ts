import {
  parseCommercialInvoice,
  parseInvoiceNumber,
} from './commercial-invoice-parser.js';
import { documentFixture, invoiceLines } from './fixtures/sanitized-invoice.js';
const parse = (lines = invoiceLines) =>
  parseCommercialInvoice(documentFixture(lines), 'test-draft');

describe('deterministic commercial invoice parser', () => {
  it('maps Contract No. to Container Number and extracts exporter', () => {
    const result = parse();
    expect(result.containerNumber).toBe('B0312614');
    expect(result.supplier.detectedName).toBe('SANITIZED LEATHER CO., LTD');
    expect(result).not.toHaveProperty('contractNumber');
  });
  it('groups continuation colors under the item and extracts one item size', () => {
    const result = parse();
    expect(result.items).toHaveLength(2);
    expect(result.items[0].itemCode).toBe('T902');
    expect(result.items[0].description).toBe('1.2mm*54"*36.5m');
    expect(result.items[0].colors).toHaveLength(4);
    expect(result.items[0].colors[1]).toMatchObject({
      color: '02#Pine green',
      rolls: 35,
      meter: 1263.5,
    });
    expect(result.items[0].colors[0]).not.toHaveProperty('size');
  });
  it('keeps alphanumeric supplier colors as text, never swatches', () => {
    const result = parse();
    expect(result.items[1].colors[0].color).toBe('F07111#Green');
    expect(result.items[1].colors[0]).not.toHaveProperty('hex');
    expect(result.items[1].description).toBe('0.8mm*54"*40m');
  });
  it('calculates totals with decimal meter and checks both measures', () => {
    const result = parse();
    expect(result.parsedTotals).toEqual({ rolls: 154, meter: 5670.5 });
    expect(result.invoiceTotals).toEqual(result.parsedTotals);
    expect(result.totalsMatch).toEqual({ rolls: true, meter: true });
    expect(result.validationPassed).toBe(true);
  });
  it('marks mismatched totals unsafe for later confirmation', () => {
    const result = parse(
      invoiceLines.map((l) =>
        l.replace('Total Rolls: 154', 'Total Rolls: 964'),
      ),
    );
    expect(result.totalsMatch.rolls).toBe(false);
    expect(result.validationPassed).toBe(false);
    expect(result.warnings.some((w) => w.code === 'ROLLS_TOTAL_MISMATCH')).toBe(
      true,
    );
  });
  it('warns about missing totals instead of assuming a match', () => {
    const result = parse(
      invoiceLines.filter((l) => !l.startsWith('Total Meter')),
    );
    expect(result.invoiceTotals.meter).toBeNull();
    expect(result.totalsMatch.meter).toBeNull();
    expect(result.validationPassed).toBe(false);
  });
  it('stops at freight, payment, and banking sections', () => {
    const result = parse([
      ...invoiceLines,
      'T999  Size: fake  401#Black  900  9',
    ]);
    expect(result.items.map((i) => i.itemCode)).toEqual(['T902', 'T639']);
  });
  it('does not turn malformed OCR numbers into guessed values', () => {
    const result = parse(
      invoiceLines.map((l) => l.replace('1263.5 | 35', '12O3.5 | 3.5')),
    );
    expect(result.items[0].colors[1]).toMatchObject({
      meter: null,
      rolls: null,
    });
    expect(result.warnings.some((w) => w.code === 'METER_INVALID')).toBe(true);
    expect(result.warnings.some((w) => w.code === 'ROLLS_INVALID')).toBe(true);
  });
  it('accepts correctly grouped thousands and rejects ambiguous grouping or symbols', () => {
    expect(parseInvoiceNumber('1,263.50')).toBe(1263.5);
    for (const value of ['1,26.5', '12O3.5', '-4', '0', '3.456', 'Infinity'])
      expect(parseInvoiceNumber(value)).toBeNull();
    expect(parseInvoiceNumber('3.5', true)).toBeNull();
  });
  it('does not invent missing descriptions', () => {
    const result = parse(
      invoiceLines.map((l) =>
        l.replace('Size: 1.2mm*54"*36.5m', 'Brush backing'),
      ),
    );
    expect(result.items[0].description).toBeNull();
    expect(result.warnings.some((w) => w.code === 'DESCRIPTION_MISSING')).toBe(
      true,
    );
  });
  it('tolerates capitalization, pipes, and a size on a continuation line', () => {
    const lines = invoiceLines.map((l) =>
      l
        .replace('Contract No.:', 'CONTRACT no :')
        .replace('EXPORTER / BENEFICIARY:', 'supplier:'),
    );
    lines[5] = 'T902 | PVC LEATHER | 1#Black | 1502 | 41';
    lines.splice(6, 0, ' | Size: 1.2mm*54"*36.5m | | | | |');
    expect(parse(lines).items[0].description).toBe('1.2mm*54"*36.5m');
  });
  it('uses heading order if Rolls precedes Meter', () => {
    const lines = invoiceLines.map((l) =>
      l.replace(
        'Quantity (Meter) | Rolls quantity',
        'Rolls quantity | Quantity (Meter)',
      ),
    );
    lines[5] = 'T902 | Size: 1.2mm*54"*36.5m | 1#Black | 41 | 1502 | | ';
    expect(parse(lines).items[0].colors[0]).toMatchObject({
      rolls: 41,
      meter: 1502,
    });
  });
  it('recognizes a table without Order List and tolerates repeated page headings', () => {
    const lines = invoiceLines.filter((line) => line !== 'Order List');
    lines.splice(6, 0, invoiceLines[4]);
    const result = parse(lines);
    expect(result.items[0].colors).toHaveLength(4);
    expect(result.totalsMatch).toEqual({ rolls: true, meter: true });
  });
  it('rejects arbitrary text and anchor-only pseudo invoices', () => {
    expect(() => parse(['Hello this is a random document', '12 34'])).toThrow(
      'Could not recognize',
    );
    expect(() =>
      parse([
        'Commercial Invoice',
        'Contract No.: B0312614',
        'Order List',
        'Item No. Meter Rolls',
      ]),
    ).toThrow('Could not recognize');
  });
  it('retains source page / line and warns on duplicate or orphan colors', () => {
    const lines = [...invoiceLines];
    lines.splice(5, 0, ' | | 904#Off white | 200 | 5 | | ');
    lines.splice(7, 0, ' | | 1#Black | 1502 | 41 | | ');
    const result = parse(lines);
    expect(result.items[0].colors[0].source).toMatchObject({
      page: 1,
      method: 'PDF_TEXT',
    });
    expect(result.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining([
        'ROW_OWNERSHIP_UNCERTAIN',
        'DUPLICATE_COLOR_ROW',
      ]),
    );
  });
});
