import type { InvoiceImportIssue, InvoiceParsingMethod } from '@afia/contracts';
// Coordinates share a top-to-bottom reading direction within each page. They are
// used relative to detected headers; no invoice-specific page coordinates exist.
export type DocumentSpan = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence?: number;
};
export type DocumentLine = {
  text: string;
  page: number;
  line: number;
  method: 'PDF_TEXT' | 'OCR';
  spans?: DocumentSpan[];
  cellSpans?: DocumentSpan[];
};
export type DocumentRule = { x0: number; y0: number; x1: number; y1: number };
export type DocumentCell = {
  text: string;
  spans: DocumentSpan[];
  x: number;
  y: number;
  width: number;
  height: number;
};
export type DocumentPage = {
  page: number;
  method: DocumentLine['method'];
  width: number;
  height: number;
  rules: DocumentRule[];
  cells?: DocumentCell[];
};
export type ExtractedDocument = {
  pages?: DocumentPage[];
  lines: DocumentLine[];
  method: InvoiceParsingMethod;
  warnings: InvoiceImportIssue[];
};
export class DocumentReadError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export type ReaderOptions = {
  maxPages: number;
  maxPixels: number;
  maxTextLength: number;
};
