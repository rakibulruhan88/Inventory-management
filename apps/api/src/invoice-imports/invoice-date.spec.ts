import { defaultPurchaseNumber } from '@afia/contracts';
import { extractInvoiceDate } from './invoice-date.js';
import { documentFixture } from './fixtures/sanitized-invoice.js';

describe('deterministic Commercial Invoice purchase date', () => {
  it.each(['Date', 'Invoice Date', 'CI Date', 'Document Date'])(
    'recognizes %s and compact YYYYMMDD',
    (label) => {
      expect(
        extractInvoiceDate(documentFixture([`${label}: 20260930`]).lines),
      ).toEqual({ purchasedAt: '2026-09-30', uncertain: false });
    },
  );
  it.each([
    '20260229',
    '20261301',
    '20260931',
    '20269O30',
    '30/09/2026',
    'not a date',
  ])('does not guess malformed %s', (value) => {
    expect(
      extractInvoiceDate(documentFixture([`Date: ${value}`]).lines).purchasedAt,
    ).toBeNull();
  });
  it('accepts real leap days and supported separated dates', () => {
    expect(
      extractInvoiceDate(documentFixture(['Invoice Date: 20240229']).lines)
        .purchasedAt,
    ).toBe('2024-02-29');
    expect(
      extractInvoiceDate(documentFixture(['CI Date: 2026/09/30']).lines)
        .purchasedAt,
    ).toBe('2026-09-30');
  });
  it('leaves a missing, conflicting or low-confidence date for manual review', () => {
    expect(
      extractInvoiceDate(documentFixture(['Contract No: 20260930']).lines)
        .purchasedAt,
    ).toBeNull();
    expect(
      extractInvoiceDate(
        documentFixture(['Date: 20260930', 'Date: 20261001']).lines,
      ).uncertain,
    ).toBe(true);
    const doc = documentFixture(['Date: 20260930']);
    doc.lines[0].spans = [
      { text: '20260930', x: 0, y: 0, width: 100, height: 10, confidence: 50 },
    ];
    expect(extractInvoiceDate(doc.lines).purchasedAt).toBeNull();
  });
  it('keeps the exact existing manual editable reference default', () => {
    expect(defaultPurchaseNumber(new Date(2026, 8, 30, 12, 5))).toBe(
      'PUR-20260930-1205',
    );
  });
});
