import {
  columnRoles,
  findStructuralLabels,
  matchStructuralLabel,
  structuralAliases,
} from './structural-labels.js';
import { parseCommercialInvoice } from './commercial-invoice-parser.js';
import {
  supplierLayoutDocument,
  supplierLayoutGroups,
} from './fixtures/supplier-layout-invoice.js';
import { invoiceTableRows } from './invoice-table.js';
import { documentFixture } from './fixtures/sanitized-invoice.js';

describe('semantic structural labels with literal business values', () => {
  it.each(
    Object.entries(structuralAliases).flatMap(([role, aliases]) =>
      aliases.map((alias) => [role, alias]),
    ),
  )('accepts %s alias %s', (role, alias) => {
    expect(
      matchStructuralLabel(alias, [role as keyof typeof structuralAliases])
        ?.role,
    ).toBe(role);
  });
  it.each([
    ['rolls', 'Rolisquantity'],
    ['meter', 'Quantlty (Meter)'],
    ['item', 'Item N0.'],
    ['color', 'C0lor code'],
    ['contract', 'ContracI No.'],
    ['description', 'Descrlption'],
    ['amount', 'TotaI Amount'],
    ['size', 'S1ze:'],
  ])('matches conservative %s typo %s only as structure', (role, label) => {
    expect(
      matchStructuralLabel(
        label,
        [role as keyof typeof structuralAliases],
        true,
      )?.role,
    ).toBe(role);
  });
  it.each([
    [
      'Item Number',
      'Item Description',
      'Shade',
      'Meter Qty',
      'Roll Qty',
      'FOB Unit Price',
      'Total (USD)',
    ],
    [
      'Product Code',
      'Specification',
      'Color No.',
      'Length Meter',
      'Number of Rolls',
      'Rate',
      'Total Amount ($USD)',
    ],
    [
      'Style No.',
      'Description / Size',
      'Colour',
      'Meters',
      'Qty Rolls',
      'Price',
      'Line Total',
    ],
    [
      'Item N0.',
      'Descrlption',
      'C0lor code',
      'Quantlty (Meter)',
      'Rolisquantity',
      'Price',
      'TotaI Amount',
    ],
  ])(
    'accepts header variants supported by neighboring labels and values',
    (...labels) => {
      const d = supplierLayoutDocument();
      const h = d.lines.find((l) => l.text.startsWith('Item No.'))!;
      h.spans!.forEach((s, i) => (s.text = labels[i]));
      h.text = labels.join(' | ');
      const r = parseCommercialInvoice(d, 'test');
      expect(r.items.map((i) => i.itemCode)).toEqual(
        supplierLayoutGroups.map((g) => g.item),
      );
      expect(r.parsedTotals).toEqual({ rolls: 964, meter: 35050 });
      expect(r.totalsMatch).toEqual({ rolls: true, meter: true });
    },
  );
  it('maps an alternative semantic column order without positional assumptions', () => {
    const d = supplierLayoutDocument(),
      order = [2, 0, 4, 1, 6, 3, 5],
      positions = [50, 200, 350, 500, 710, 870, 1000];
    for (const line of d.lines.filter((l) => l.text.includes('|'))) {
      const cells = line.text.split('|').map((t) => t.trim());
      line.spans = order.flatMap((old, i) =>
        cells[old]
          ? [
              {
                text: cells[old],
                x: positions[i],
                y: line.spans![0].y,
                width: Math.min(90, cells[old].length * 3),
                height: 8,
              },
            ]
          : [],
      );
      line.text = order.map((i) => cells[i]).join(' | ');
    }
    const r = parseCommercialInvoice(d, 'test');
    expect(r.items.map((i) => i.itemCode)).toEqual(
      supplierLayoutGroups.map((g) => g.item),
    );
    expect(r.totalsMatch).toEqual({ rolls: true, meter: true });
  });
  it.each(['TotaI Amount', 'Freight', 'Invoice Total'])(
    'preserves structural-looking business item %s in a color row',
    (code) => {
      const d = supplierLayoutDocument(),
        row = d.lines.find((l) => l.text.startsWith('T902 PVC'))!;
      row.spans!.find((s) => s.text === 'T902 PVC')!.text = code;
      const r = parseCommercialInvoice(d, 'test');
      expect(r.items[0].itemCode).toBe(code);
      expect(r.items[0].colors).toHaveLength(4);
      expect(r.totalsMatch).toEqual({ rolls: true, meter: true });
    },
  );
  it('never repairs OCR business identifiers or malformed numbers', () => {
    const d = supplierLayoutDocument();
    d.method = 'OCR';
    d.lines.forEach((l) => (l.method = 'OCR'));
    d.lines[1].text = 'ContracI No.: B03I2614';
    const first = d.lines.find((l) => l.text.startsWith('T902 PVC'))!;
    first.spans!.find((s) => s.text === 'T902 PVC')!.text = 'T9O2 PVC';
    first.spans!.find((s) => s.text === '1#Black')!.text = 'O2#Pine green';
    first.spans!.find((s) => s.text === '1499.5')!.text = '121B';
    const r = parseCommercialInvoice(d, 'test');
    expect(r.containerNumber).toBe('B03I2614');
    expect(r.items[0].itemCode).toBe('T9O2 PVC');
    expect(r.items[0].colors[0]).toMatchObject({
      color: 'O2#Pine green',
      meter: null,
    });
    expect(r.warnings.some((w) => w.code === 'METER_INVALID')).toBe(true);
  });
  it('leaves low-confidence numeric OCR unresolved, even when it looks numeric', () => {
    const d = supplierLayoutDocument();
    d.method = 'OCR';
    d.lines.forEach((l) => (l.method = 'OCR'));
    const first = d.lines.find((l) => l.text.startsWith('T902 PVC'))!;
    first.spans!.find((s) => s.text === '1499.5')!.confidence = 40;
    const r = parseCommercialInvoice(d, 'test');
    expect(r.items[0].colors[0].meter).toBeNull();
    expect(r.totalsMatch.meter).toBe(false);
    expect(r.warnings.some((w) => w.code === 'METER_INVALID')).toBe(true);
  });
  it('does not interpret fuzzy headings alone as a supported table', () => {
    const d = documentFixture([
      'Invoice',
      'Contract No: B0312614',
      'Itam No | Descrlption | Colur | Metar | Rolis',
      'fake | fake | 1#Black | 100 | 4',
    ]);
    expect(() => parseCommercialInvoice(d, 'test')).toThrow(
      'Could not recognize',
    );
  });
  it('keeps an identity-clear partial table in review with unresolved columns', () => {
    const d = supplierLayoutDocument();
    const h = d.lines.find((l) => l.text.startsWith('Item No.'))!;
    h.spans!.find((s) => s.text === 'Quantity (Meter)')!.text = 'Unreadable';
    h.text = h.spans!.map((s) => s.text).join(' | ');
    const r = parseCommercialInvoice(d, 'test');
    expect(r.validationPassed).toBe(false);
    expect(r.unassignedRows.length).toBeGreaterThan(0);
    expect(
      r.warnings.some((w) => w.code === 'COLUMN_STRUCTURE_UNCERTAIN'),
    ).toBe(true);
  });
  it('keeps a strong invoice with an unreadable Item heading for review without assigning owners', () => {
    const d = supplierLayoutDocument();
    const h = d.lines.find((l) => l.text.startsWith('Item No.'))!;
    h.spans!.find((s) => s.text === 'Item No.')!.text = 'Unreadable';
    h.text = h.spans!.map((s) => s.text).join(' | ');
    const r = parseCommercialInvoice(d, 'test');
    expect(r.items).toHaveLength(0);
    expect(r.unassignedRows.length).toBeGreaterThan(0);
    expect(r.validationPassed).toBe(false);
  });
  it('rejects a misleading non-invoice table with plausible rows', () => {
    const d = documentFixture([
      'Stock worksheet',
      'Item No | Description | Color code | Meter | Rolls',
      'A1 | Size: sample | 1#Black | 100 | 4',
      'Total Meter: 100',
      'Total Rolls: 4',
    ]);
    expect(() => parseCommercialInvoice(d, 'test')).toThrow(
      'Could not recognize',
    );
  });
  it('normalizes common Unicode OCR confusables exclusively in labels', () => {
    expect(matchStructuralLabel('Cοlοr cοde', ['color'])?.role).toBe('color');
    expect(matchStructuralLabel('Rоlls quantity', ['rolls'])?.role).toBe(
      'rolls',
    );
  });
  it('retains literal Unicode business data while normalizing headings', () => {
    expect(matchStructuralLabel('Ｉｔｅｍ　Ｎｏ．', ['item'])?.role).toBe(
      'item',
    );
    const match = findStructuralLabels(
      'ContracI No.: B03I2614',
      ['contract'],
      true,
    )[0];
    expect('ContracI No.: B03I2614'.slice(match.end).trim()).toBe(
      '.: B03I2614',
    );
  });
});
