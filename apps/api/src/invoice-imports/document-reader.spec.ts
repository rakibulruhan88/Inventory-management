import { ConfigService } from '@nestjs/config';
import { DocumentExtractor } from './document-extractor.js';
import {
  imageDimensions,
  nativeTextUsable,
  positionedLines,
} from './document-reader.js';
import {
  documentFixture,
  imageFixture,
  invoiceLines,
  pdfFixture,
} from './fixtures/sanitized-invoice.js';
import { parseCommercialInvoice } from './commercial-invoice-parser.js';

const extractor = () => new DocumentExtractor(new ConfigService());
describe('local native text and OCR document reader', () => {
  it('uses native text for an actual generated PDF', async () => {
    const result = await extractor().extract(
      await pdfFixture([invoiceLines]),
      'application/pdf',
    );
    expect(result.method).toBe('PDF_TEXT');
    expect(result.lines.every((l) => l.method === 'PDF_TEXT')).toBe(true);
    expect(parseCommercialInvoice(result, 'draft').containerNumber).toBe(
      'B0312614',
    );
  }, 30_000);
  it.each(['png', 'jpg'] as const)(
    'reads %s directly with local OCR and produces review data',
    async (format) => {
      const result = await extractor().extract(
        imageFixture(invoiceLines, format),
        format === 'png' ? 'image/png' : 'image/jpeg',
      );
      expect(result.method).toBe('OCR');
      expect(
        parseCommercialInvoice(result, 'draft').items.length,
      ).toBeGreaterThan(0);
    },
    60_000,
  );
  it('falls back to OCR for a scanned PDF', async () => {
    const result = await extractor().extract(
      await pdfFixture([imageFixture(invoiceLines)]),
      'application/pdf',
    );
    expect(result.method).toBe('OCR');
    expect(parseCommercialInvoice(result, 'draft').containerNumber).toBe(
      'B0312614',
    );
  }, 60_000);
  it('uses HYBRID only when a page needs OCR', async () => {
    const result = await extractor().extract(
      await pdfFixture([
        invoiceLines.slice(0, 10),
        imageFixture(['Total Meter: 5670.5', 'Total Rolls: 154']),
      ]),
      'application/pdf',
    );
    expect(result.method).toBe('HYBRID');
    expect(
      result.lines
        .filter((l) => l.page === 1)
        .every((l) => l.method === 'PDF_TEXT'),
    ).toBe(true);
    expect(
      result.lines.filter((l) => l.page === 2).every((l) => l.method === 'OCR'),
    ).toBe(true);
  }, 60_000);
  it('rejects a random image after OCR rather than treating text as an invoice', async () => {
    const result = await extractor().extract(
      imageFixture([
        'Welcome to the sample document',
        'This is not a commercial invoice',
      ]),
      'image/png',
    );
    expect(() => parseCommercialInvoice(result, 'draft')).toThrow(
      'Could not recognize',
    );
  }, 30_000);
  it('handles corrupt PDFs without exposing parser details or paths', async () => {
    await expect(
      extractor().extract(
        Buffer.from('%PDF-1.7\nnot a pdf\n%%EOF'),
        'application/pdf',
      ),
    ).rejects.toThrow('Could not read this document');
  }, 30_000);
  it('enforces page limits before OCR', async () => {
    const reader = new DocumentExtractor(
      new ConfigService({ INVOICE_IMPORT_MAX_PDF_PAGES: 1 }),
    );
    await expect(
      reader.extract(await pdfFixture([invoiceLines, []]), 'application/pdf'),
    ).rejects.toThrow('too many pages');
  }, 30_000);
  it('kills a timed-out reader and releases its processing slot', async () => {
    const reader = new DocumentExtractor(
      new ConfigService({ INVOICE_IMPORT_TIMEOUT_MS: 1 }),
    );
    const image = imageFixture(invoiceLines);
    await expect(reader.extract(image, 'image/png')).rejects.toThrow(
      'timed out',
    );
    await expect(reader.extract(image, 'image/png')).rejects.toThrow(
      'timed out',
    );
  });
  it('does not start uncontrolled concurrent document workers', async () => {
    const reader = extractor();
    const job = reader.extract(
      await pdfFixture([invoiceLines]),
      'application/pdf',
    );
    await expect(reader.extract(Buffer.alloc(10), 'image/png')).rejects.toThrow(
      'Another document',
    );
    await job;
  }, 30_000);
  it('rejects decompression-size image bombs before decoding', async () => {
    const image = imageFixture(['sample']);
    image.writeUInt32BE(100000, 16);
    await expect(extractor().extract(image, 'image/png')).rejects.toThrow(
      'dimensions exceed',
    );
  }, 30_000);
  it('classifies continuation native text and reconstructs relative line positions', () => {
    expect(
      nativeTextUsable(
        documentFixture()
          .lines.map((l) => l.text)
          .join('\n'),
      ),
    ).toBe(true);
    expect(nativeTextUsable('   ')).toBe(false);
    expect(nativeTextUsable('1#Black 1502 41')).toBe(true);
    expect(nativeTextUsable('Total Meter: 1502\nTotal Rolls: 41')).toBe(true);
    expect(nativeTextUsable('Contract No.: B0312614\nOrder List\nItem No. Description Color code Meter Rolls')).toBe(false);
    expect(
      nativeTextUsable('02#Pine green                1263.5             35'),
    ).toBe(true);
    expect(
      positionedLines([
        {
          str: 'right',
          transform: [1, 0, 0, 1, 80, 100],
          height: 10,
          width: 30,
        },
        {
          str: 'left',
          transform: [1, 0, 0, 1, 20, 100],
          height: 10,
          width: 30,
        },
      ]),
    ).toEqual(['left  right']);
    expect(imageDimensions(imageFixture(['test']), 'image/png').width).toBe(
      2350,
    );
  });
});
