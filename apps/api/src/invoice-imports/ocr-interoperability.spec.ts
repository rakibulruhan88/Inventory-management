import { ConfigService } from '@nestjs/config';
import { DocumentExtractor } from './document-extractor.js';
import { parseCommercialInvoice } from './commercial-invoice-parser.js';
import { ruledInvoiceImage } from './fixtures/ocr-invoice.js';
import { pdfFixture, invoiceLines } from './fixtures/sanitized-invoice.js';
import { supplierLayoutGroups } from './fixtures/supplier-layout-invoice.js';
import { preprocessInvoiceImage } from './image-preprocessing.js';

describe('ruled image geometry, merged cells and OCR interoperability', () => {
  it.each([
    ['clean', {}],
    ['resized', { scale: 0.7 }],
    ['blurred', { blur: true }],
    ['rotated', { rotation: 1.25 }],
    ['sideways', { rotation: 90 }],
    ['compressed', { compressed: true }],
  ] as const)(
    'reads a %s image without guessing ownership',
    async (_, options) => {
      const image = ruledInvoiceImage(options),
        document = await new DocumentExtractor(new ConfigService()).extract(
          image,
          'compressed' in options && options.compressed
            ? 'image/jpeg'
            : 'image/png',
        );
      expect(document.method).toBe('OCR');
      expect(document.pages?.[0].cells?.length).toBeGreaterThan(0);
      const r = parseCommercialInvoice(document, 'test');
      expect(r.items.map((i) => i.itemCode)).toEqual(
        supplierLayoutGroups.map((g) => g.item),
      );
      expect(r.items.map((i) => i.colors.length)).toEqual([
        4, 5, 5, 5, 2, 1, 1,
      ]);
      expect(r.supplier.detectedName).toBe('SANITIZED LEATHER CO.,LTD');
      expect(r.supplier.contactPerson).toBe('Test Operator');
      expect(r.invoiceTotals).toEqual({ rolls: 964, meter: 35050 });
      if (r.totalsMatch.meter !== true || r.totalsMatch.rolls !== true)
        expect(r.warnings.length).toBeGreaterThan(0);
      expect(r.warnings.some((w) => w.code === 'ROW_OWNERSHIP_UNCERTAIN')).toBe(
        false,
      );
    },
    60_000,
  );
  it('uses the same cells for a scanned PDF', async () => {
    const document = await new DocumentExtractor(new ConfigService()).extract(
      await pdfFixture([ruledInvoiceImage()]),
      'application/pdf',
    );
    expect(document.method).toBe('OCR');
    const r = parseCommercialInvoice(document, 'test');
    expect(r.items).toHaveLength(7);
    expect(r.items.map((i) => i.colors.length)).toEqual([4, 5, 5, 5, 2, 1, 1]);
  }, 60_000);
  it('retains both sources in a mixed native/OCR PDF', async () => {
    const d = await new DocumentExtractor(new ConfigService()).extract(
      await pdfFixture([invoiceLines, ruledInvoiceImage()]),
      'application/pdf',
    );
    expect(d.method).toBe('HYBRID');
    expect(d.pages?.map((p) => p.method)).toEqual(['PDF_TEXT', 'OCR']);
    expect(parseCommercialInvoice(d, 'test').items.length).toBeGreaterThan(0);
  }, 60_000);
  it('never modifies the original bytes and stays below the pixel bound', async () => {
    const original = ruledInvoiceImage({ scale: 0.5 }),
      before = Buffer.from(original);
    const p = await preprocessInvoiceImage(original, 16000000);
    expect(original.equals(before)).toBe(true);
    expect(p.width * p.height).toBeLessThanOrEqual(16000000);
    expect(p.rules.length).toBeGreaterThan(0);
  });
});
