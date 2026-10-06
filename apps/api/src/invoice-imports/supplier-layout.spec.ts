import { parseCommercialInvoice } from './commercial-invoice-parser.js';
import { invoiceTableRows } from './invoice-table.js';
import {
  supplierLayoutDocument,
  supplierLayoutGroups,
  supplierLayoutHeader,
  supplierLayoutLines,
  supplierLayoutRows,
} from './fixtures/supplier-layout-invoice.js';
import {
  documentFixture,
  imageFixture,
  pdfFixture,
} from './fixtures/sanitized-invoice.js';
import { DocumentExtractor } from './document-extractor.js';
import { ConfigService } from '@nestjs/config';

const expectSevenGroups = (
  result: ReturnType<typeof parseCommercialInvoice>,
) => {
  expect(result.items.map((item) => item.itemCode)).toEqual(
    supplierLayoutGroups.map((group) => group.item),
  );
  expect(result.items.map((item) => item.colors.length)).toEqual([
    4, 5, 5, 5, 2, 1, 1,
  ]);
  supplierLayoutGroups.forEach((group, i) =>
    expect(result.items[i].colors.map((color) => color.color)).toEqual(
      group.colors,
    ),
  );
  expect(result.invoiceTotals).toEqual({ rolls: 964, meter: 35050 });
  expect(result.parsedTotals).toEqual({ rolls: 964, meter: 35050 });
  expect(result.totalsMatch).toEqual({ rolls: true, meter: true });
  expect(result.warnings).toEqual([]);
  expect(result.unassignedRows).toEqual([]);
};
const scanLines = [
  ...supplierLayoutLines.slice(0, 2),
  'EXPORTER / BENEFICIARY: SANITIZED LEATHER CO.,LTD',
  'ADD: ROOM 10, TEST ROAD, TEST DISTRICT, TEST CITY',
  'Tel: +880-000-101',
  'Fax: +880-000-102',
  'Contact person: Test Operator',
  ...supplierLayoutLines.slice(3),
];
const expectOcrGroups = (result: ReturnType<typeof parseCommercialInvoice>) => {
  expect(result.items.map((item) => item.itemCode)).toEqual(
    supplierLayoutGroups.map((group) => group.item),
  );
  expect(result.items.map((item) => item.colors.length)).toEqual([
    4, 5, 5, 5, 2, 1, 1,
  ]);
  expect(result.items[5].colors[0].color).toBe('1#Black');
  expect(result.items[6].colors[0].color).toBe('1#Black');
  expect(result.invoiceTotals).toEqual({ rolls: 964, meter: 35050 });
  expect(result.parsedTotals).toEqual({ rolls: 964, meter: 35050 });
  expect(result.totalsMatch).toEqual({ rolls: true, meter: true });
  expect(result.unassignedRows).toEqual([]);
  expect(result.warnings.some((w) => w.code === 'DUPLICATE_COLOR_ROW')).toBe(
    false,
  );
  // OCR spelling is retained as read, including letter/digit confusions.
};
describe('supplier invoice columns and exact item ownership', () => {
  it.each([
    [0, 1],
    [270, 1],
    [19, 0.6],
    [-45, 1.5],
  ])(
    'derives shifted/scaled header columns (offset %s, scale %s)',
    (offset, scale) => {
      expectSevenGroups(
        parseCommercialInvoice(supplierLayoutDocument(offset, scale), 'draft'),
      );
    },
  );
  it('separates exporter name, address, phone, fax, and contact person', () => {
    const result = parseCommercialInvoice(supplierLayoutDocument(), 'draft');
    expect(result.supplier).toMatchObject({
      detectedName: 'SANITIZED LEATHER CO.,LTD',
      phone: '+880-000-101',
      fax: '+880-000-102',
      contactPerson: 'Test Operator',
      address: 'ROOM 10, TEST ROAD, TEST DISTRICT, TEST CITY',
    });
    expect(result.containerNumber).toBe('B0312614');
    expect(result.warnings.some((w) => w.code === 'DUPLICATE_COLOR_ROW')).toBe(
      false,
    );
  });
  it('handles exporter/contact labels over separate lines without including the next party', () => {
    const document = supplierLayoutDocument();
    const original = document.lines[2];
    document.lines.splice(
      2,
      1,
      ...[
        'EXPORTER / BENEFICIARY:',
        'SANITIZED LEATHER CO.,LTD',
        'ADDRESS: ROOM 10, TEST ROAD,',
        'TEST DISTRICT, TEST CITY',
        'PHONE: +880-000-101',
        'FAX: +880-000-102',
        'CONTACT PERSON: Test Operator',
      ].map((text, i) => ({
        ...original,
        text,
        spans: undefined,
        line: i + 300,
      })),
    );
    expect(parseCommercialInvoice(document, 'draft').supplier).toMatchObject({
      detectedName: 'SANITIZED LEATHER CO.,LTD',
      phone: '+880-000-101',
      contactPerson: 'Test Operator',
      address: 'ROOM 10, TEST ROAD, TEST DISTRICT, TEST CITY',
    });
  });
  it('uses explicit full cells as a safe fallback without requiring digits', () => {
    expectSevenGroups(
      parseCommercialInvoice(documentFixture(supplierLayoutLines), 'draft'),
    );
  });
  it('never attaches a flattened ambiguous New Lamb row or its followers to XTZ182', () => {
    const document = supplierLayoutDocument();
    const row = document.lines.find((line) =>
      line.text.startsWith('New Lamb'),
    )!;
    row.spans = undefined;
    row.text = 'New Lamb PVC LEATHER Size: sample 401#Black 1500 40';
    const result = parseCommercialInvoice(document, 'draft');
    expect(
      result.items.find((item) => item.itemCode === 'XTZ182')?.colors,
    ).toHaveLength(5);
    expect(
      result.items.some((item) =>
        item.colors.some((color) => color.color === '716#L-Green'),
      ),
    ).toBe(false);
    expect(result.unassignedRows).toHaveLength(5);
    expect(
      result.warnings.some((w) => w.code === 'ROW_OWNERSHIP_UNCERTAIN'),
    ).toBe(true);
    expect(result.validationPassed).toBe(false);
    expect(result.totalsMatch).toEqual({ rolls: false, meter: false });
  });
  it('refuses whitespace-only fallback even when the number of tokens resembles columns', () => {
    const document = documentFixture(supplierLayoutLines);
    const row = document.lines.find((line) =>
      line.text.startsWith('New Lamb'),
    )!;
    row.text =
      'New Lamb  PVC LEATHER Size: sample  401#Black  1500  40  1.00  US$1500.00';
    const result = parseCommercialInvoice(document, 'draft');
    expect(
      result.items.find((item) => item.itemCode === 'XTZ182')?.colors,
    ).toHaveLength(5);
    expect(result.unassignedRows).toHaveLength(5);
  });
  it('retains ownership across a repeated positioned page header with a layout shift', () => {
    const document = supplierLayoutDocument();
    const split = document.lines.findIndex((line) =>
      line.text.startsWith('New Lamb'),
    );
    const shifted = supplierLayoutDocument(270, 1.2);
    const header = shifted.lines.find((line) =>
      line.text.startsWith('Item No.'),
    )!;
    document.lines.splice(
      split,
      document.lines.length - split,
      { ...header, page: 2, line: 1 },
      ...shifted.lines
        .slice(split)
        .map((line, i) => ({ ...line, page: 2, line: i + 2 })),
    );
    expectSevenGroups(parseCommercialInvoice(document, 'draft'));
  });
  it('does not treat a color cell at the item boundary as a continuation', () => {
    const document = supplierLayoutDocument();
    const row = document.lines.find((line) =>
      line.text.startsWith('New Lamb'),
    )!;
    const layout = invoiceTableRows(document.lines);
    expect(layout.find((r) => r.source === row)?.cells.item).toBe('New Lamb');
    row.spans![0].x = 129.8; // Deliberately at the midpoint of detected Item/Description headers.
    const result = parseCommercialInvoice(document, 'draft');
    expect(result.unassignedRows.length).toBeGreaterThan(0);
    expect(result.validationPassed).toBe(false);
  });
  it('leaves a blank item with a new description/color unassigned instead of using the previous item', () => {
    const document = supplierLayoutDocument();
    const row = document.lines.find((line) =>
      line.text.startsWith('New Lamb'),
    )!;
    row.spans = row.spans!.filter((span) => span.text !== 'New Lamb');
    const result = parseCommercialInvoice(document, 'draft');
    expect(
      result.items.find((item) => item.itemCode === 'XTZ182')?.colors,
    ).toHaveLength(5);
    expect(result.unassignedRows).toHaveLength(5);
  });
  it('does not report matching totals when declared table totals are missing or conflicting', () => {
    const document = supplierLayoutDocument();
    const total = document.lines.find((line) =>
      line.text.startsWith('Total Amount |'),
    )!;
    total.spans!.find((span) => span.text === '964')!.text = '96O';
    const result = parseCommercialInvoice(document, 'draft');
    expect(result.invoiceTotals.rolls).toBeNull();
    expect(result.totalsMatch.rolls).toBeNull();
    const conflicting = supplierLayoutDocument();
    conflicting.lines.push({
      text: 'Total Rolls: 999',
      page: 1,
      line: 999,
      method: 'PDF_TEXT',
    });
    expect(
      parseCommercialInvoice(conflicting, 'draft').totalsMatch.rolls,
    ).toBeNull();
  });
  it('keeps a real generated native PDF positioned and parses the seven structural cases', async () => {
    const result = await new DocumentExtractor(new ConfigService()).extract(
      await pdfFixture([supplierLayoutLines]),
      'application/pdf',
    );
    expect(
      result.lines.find((line) => line.text.includes('New Lamb'))?.spans
        ?.length,
    ).toBeGreaterThan(1);
    expectSevenGroups(parseCommercialInvoice(result, 'draft'));
  }, 30_000);
  it('preserves actual OCR word boxes and the seven item groups', async () => {
    const result = await new DocumentExtractor(new ConfigService()).extract(
      imageFixture(scanLines),
      'image/png',
    );
    expect(result.method).toBe('OCR');
    expect(result.lines.some((line) => line.spans?.length)).toBe(true);
    expectOcrGroups(parseCommercialInvoice(result, 'draft'));
  }, 60_000);
  it('does not merge digit-free items in a scanned PDF', async () => {
    const result = await new DocumentExtractor(new ConfigService()).extract(
      await pdfFixture([imageFixture(scanLines)]),
      'application/pdf',
    );
    expect(result.method).toBe('OCR');
    const parsed = parseCommercialInvoice(result, 'draft');
    expect(parsed.items.map((item) => item.itemCode)).toEqual(
      supplierLayoutGroups.map((group) => group.item),
    );
    expect(parsed.items.map((item) => item.colors.length)).toEqual([
      4, 5, 5, 5, 2, 1, 1,
    ]);
    expect(parsed.items[5].colors[0].color).toBe('1#Black');
    expect(parsed.items[6].colors[0].color).toBe('1#Black');
    expect(parsed.invoiceTotals).toEqual({ rolls: 964, meter: 35050 });
    expect(parsed.unassignedRows).toEqual([]);
    expect(parsed.warnings.some((w) => w.code === 'DUPLICATE_COLOR_ROW')).toBe(
      false,
    );
  }, 60_000);
});
