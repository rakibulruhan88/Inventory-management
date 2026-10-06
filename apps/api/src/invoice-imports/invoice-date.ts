import { validPurchaseDate } from '@afia/contracts';
import type { DocumentLine } from './document-types.js';

export function extractInvoiceDate(lines: DocumentLine[]) {
  const values: string[] = [];
  let uncertain = false;
  for (const line of lines) {
    // Explicit structural labels only; do not infer dates from contract numbers.
    const match =
      /(?:^|[|\s])(?:Invoice\s+Date|CI\s+Date|Document\s+Date|Date)\s*[:：]?\s*(\S+)/i.exec(
        line.text,
      );
    if (!match) continue;
    const raw = match[1];
    const value = /^\d{8}$/.test(raw)
      ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}`
      : raw.replaceAll('/', '-');
    const lowConfidence = line.spans?.some(
      (span) =>
        span.confidence !== undefined &&
        span.confidence < 80 &&
        /\d/.test(span.text),
    );
    if (!validPurchaseDate(value) || lowConfidence) uncertain = true;
    else values.push(value);
  }
  if (new Set(values).size > 1) uncertain = true;
  return {
    purchasedAt: !uncertain && values.length ? values[0] : null,
    uncertain,
  };
}
