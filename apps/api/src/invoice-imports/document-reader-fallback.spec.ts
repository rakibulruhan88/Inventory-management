import { documentFixture } from './fixtures/sanitized-invoice.js';
const mocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  recognize: vi.fn(),
  terminate: vi.fn(),
  createWorker: vi.fn(),
}));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: mocks.getDocument,
}));
vi.mock('tesseract.js', () => ({
  OEM: { LSTM_ONLY: 1 },
  PSM: { AUTO: '3', SINGLE_BLOCK: '6' },
  createWorker: mocks.createWorker,
}));
import { readDocument } from './document-reader.js';

describe('page-level native extraction failure and OCR cleanup', () => {
  beforeEach(() => {
    mocks.recognize.mockReset().mockResolvedValue({
      data: {
        text: documentFixture()
          .lines.map((l) => l.text)
          .join('\n'),
      },
    });
    mocks.terminate.mockReset().mockResolvedValue(undefined);
    mocks.createWorker.mockReset().mockResolvedValue({
      setParameters: vi.fn(),
      recognize: mocks.recognize,
      terminate: mocks.terminate,
    });
  });
  const options = { maxPages: 20, maxPixels: 16000000, maxTextLength: 2000000 };
  it('falls back to local OCR if native extraction on a readable page fails', async () => {
    const cleanup = vi.fn(),
      destroy = vi.fn();
    mocks.getDocument.mockReturnValue({
      destroy,
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getTextContent: async () => {
            throw new Error('text extraction failure');
          },
          getViewport: () => ({ width: 100, height: 100 }),
          render: () => ({ promise: Promise.resolve() }),
          cleanup,
        }),
      }),
    });
    const result = await readDocument(
      Buffer.from('test'),
      'application/pdf',
      options,
    );
    expect(result.method).toBe('OCR');
    expect(result.warnings[0].code).toBe('PDF_TEXT_FAILED');
    expect(mocks.recognize).toHaveBeenCalledTimes(1);
    expect(mocks.terminate).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalled();
    expect(destroy).toHaveBeenCalled();
  });
  it('terminates the OCR worker and cleans the PDF page even when OCR fails', async () => {
    const cleanup = vi.fn(),
      destroy = vi.fn();
    mocks.getDocument.mockReturnValue({
      destroy,
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getTextContent: async () => ({ items: [] }),
          getViewport: () => ({ width: 100, height: 100 }),
          render: () => ({ promise: Promise.resolve() }),
          cleanup,
        }),
      }),
    });
    mocks.recognize.mockRejectedValue(new Error('OCR failed'));
    await expect(
      readDocument(Buffer.from('test'), 'application/pdf', options),
    ).rejects.toThrow('OCR failed');
    expect(mocks.terminate).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalled();
    expect(destroy).toHaveBeenCalled();
  });
});
