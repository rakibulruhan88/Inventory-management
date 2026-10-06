import type { InvoiceImportReview } from '@afia/contracts';
import { normalizeText } from '../common/normalize.js';
import type { DocumentLine } from './document-types.js';
import { findStructuralLabels, prefixLabel } from './structural-labels.js';
export function extractInvoiceSupplier(
  lines: DocumentLine[],
): InvoiceImportReview['supplier'] {
  const supplier: InvoiceImportReview['supplier'] = {
    detectedName: null,
    phone: null,
    address: null,
    contactPerson: null,
    fax: null,
    matchedSupplierId: null,
    matchStatus: 'NOT_DETECTED',
  };
  const start = lines.findIndex((l) => prefixLabel(l.text, ['supplier'], true));
  if (start < 0) return supplier;
  const initial = lines[start];
  // Party labels on the same baseline are separate spatial sections, not part
  // of the supplier's address. Retain only the exporter column below it.
  const party = initial.spans?.find((s) =>
    /^(?:notify|consignee|buyer)$/i.test(s.text),
  );
  const right = party?.x ?? Infinity;
  const section: string[] = [];
  for (const line of lines.slice(start)) {
    const text =
      line.spans && right < Infinity
        ? line.spans
            .filter((s) => s.x < right)
            .map((s) => s.text)
            .join(' ')
        : line.text;
    if (!text.trim()) continue;
    if (
      section.length &&
      (prefixLabel(text, ['stop', 'table', 'contract', 'invoice'], true) ||
        prefixLabel(text, ['item'], true))
    )
      break;
    section.push(text);
  }
  const label = prefixLabel(section[0], ['supplier'], true)!;
  const text = [
    section[0].slice(label.end).replace(/^[\s:：|;-]+/, ''),
    ...section.slice(1),
  ].join(' ');
  const labels = findStructuralLabels(
    text,
    ['address', 'phone', 'fax', 'contact'],
    true,
  ).filter((m) => /^[\s]*[:：]/.test(text.slice(m.end)));
  const clean = (value: string) =>
    normalizeText(value.replace(/^[\s|;:]+|[\s|;]+$/g, '')) || null;
  supplier.detectedName = clean(text.slice(0, labels[0]?.start ?? text.length));
  if (supplier.detectedName) supplier.matchStatus = 'NEW';
  for (let i = 0; i < labels.length; i++) {
    const m = labels[i],
      value = clean(text.slice(m.end, labels[i + 1]?.start ?? text.length));
    if (m.role === 'address') supplier.address = value;
    else if (m.role === 'phone') supplier.phone = value;
    else if (m.role === 'fax') supplier.fax = value;
    else if (m.role === 'contact') supplier.contactPerson = value;
  }
  return supplier;
}
