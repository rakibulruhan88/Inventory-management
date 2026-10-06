import type {
  InvoiceImportItem,
  InvoiceImportIssue,
  InvoiceImportReview,
  InvoiceImportUnassignedRow,
} from '@afia/contracts';
import { normalizeCode, normalizeText } from '../common/normalize.js';
import { DocumentReadError, type ExtractedDocument } from './document-types.js';
import { invoiceTableRows, type InvoiceTableRow } from './invoice-table.js';
import {
  findStructuralLabels,
  prefixLabel,
  labeledValue,
} from './structural-labels.js';
import { extractInvoiceSupplier } from './supplier-extraction.js';

import { extractInvoiceDate } from './invoice-date.js';

export const INVOICE_PARSER_VERSION = 3;
const numeric = /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/;
export function parseInvoiceNumber(
  value: string | undefined,
  rolls = false,
): number | null {
  if (!value || !numeric.test(value)) return null;
  const n = Number(value.replace(/,/g, ''));
  if (
    !Number.isFinite(n) ||
    n <= 0 ||
    n > (rolls ? 2_147_483_647 : 9_999_999_999.99) ||
    (rolls && !Number.isInteger(n))
  )
    return null;
  return n;
}
const tableEnd =
  /^(?:freight\b|loading\b|export\s+charge\b|total\s+(?:amount|meter|metre|rolls?)\b|payment\b|bank(?:ing)?\s+details\b)/i;
const colorPattern = /^[A-Z0-9]+\s*#\s*\S/i;
const clean = (value?: string) => normalizeText(value) || null;
const sizeValue = (value?: string) => {
  if (!value) return null;
  const label = findStructuralLabels(value, ['size'], true)[0];
  const backing = findStructuralLabels(value, ['backing'], true)[0];
  return label
    ? clean(value.slice(label.end, backing?.start).replace(/^[\s:：]+/, ''))
    : null;
};

export function parseCommercialInvoice(
  document: ExtractedDocument,
  draftId: string,
): InvoiceImportReview {
  const lines = document.lines
    .map((line) => ({
      ...line,
      text: line.text.replace(/\u00a0/g, ' ').trim(),
    }))
    .filter((line) => line.text);
  const all = lines.map((line) => line.text).join('\n');
  const warnings: InvoiceImportIssue[] = [...document.warnings];
  const issue = (
    code: string,
    message: string,
    field?: string,
    source?: { page: number; line: number },
  ) =>
    warnings.push({
      code,
      message,
      field,
      ...(source ? { page: source.page, line: source.line } : {}),
    });
  const containerNumber =
    lines
      .map((line) => labeledValue(line.text, 'contract', true))
      .find((value) => value !== null)
      ?.match(/^[A-Z0-9][A-Z0-9_/-]*/i)?.[0] ?? null;
  const supplier = extractInvoiceSupplier(lines);
  if (!supplier.detectedName)
    issue(
      'SUPPLIER_MISSING',
      'Supplier / Exporter name could not be read.',
      'supplier',
    );
  if (!containerNumber)
    issue(
      'CONTAINER_MISSING',
      'Contract No. / Container Number could not be read.',
      'containerNumber',
    );
  const rows = invoiceTableRows(lines, document.pages);
  const hasInvoice = lines.some((line) =>
    prefixLabel(line.text, ['invoice'], true),
  );
  const tableStart = lines.find((line) =>
    prefixLabel(line.text, ['table'], true),
  );
  const plausible = lines.filter((line) =>
    /[A-Z0-9]+\s*#.+\d+(?:\.\d+)?\s+\d+/i.test(line.text.replace(/\|/g, ' ')),
  );
  const fallbackStart =
    !rows.some((row) => row.header) &&
    hasInvoice &&
    containerNumber &&
    supplier.detectedName &&
    tableStart &&
    plausible.length >= 2
      ? tableStart
      : null;
  const items: InvoiceImportItem[] = [];
  const unassignedRows: InvoiceImportUnassignedRow[] = [];
  const tableTotals: { rolls: number | null; meter: number | null }[] = [];
  let current: InvoiceImportItem | null = null;
  let inTable = false,
    stopped = false,
    colorRows = 0;
  const markUnassigned = (row: InvoiceTableRow, reason: string) => {
    const source = {
      page: row.source.page,
      line: row.source.line,
      method: row.source.method,
    };
    unassignedRows.push({
      itemCode: clean(row.cells.item),
      description: sizeValue(row.cells.description),
      color: clean(row.cells.color),
      meter: parseInvoiceNumber(row.cells.meter),
      rolls: parseInvoiceNumber(row.cells.rolls, true),
      text: row.source.text,
      reason,
      source,
    });
    issue('ROW_OWNERSHIP_UNCERTAIN', reason, 'unassignedRows', source);
    // Do not carry an earlier item over an unreadable possible item boundary.
    current = null;
  };
  for (const row of rows) {
    const { cells, source } = row;
    if (fallbackStart && source === fallbackStart) {
      inTable = true;
      issue(
        'COLUMN_STRUCTURE_UNCERTAIN',
        'Invoice identity is clear, but table columns could not be assigned safely. Rows remain unassigned for review.',
        'items',
        source,
      );
      continue;
    }
    if (row.header && !stopped) {
      if (row.weak)
        issue(
          'COLUMN_STRUCTURE_UNCERTAIN',
          'Some table columns could not be identified safely. Rows require review.',
          'items',
          source,
        );
      inTable = true;
      continue;
    }
    const label = clean(cells.item) ?? source.text;
    const structuralRow = !clean(cells.color);
    if (
      inTable &&
      structuralRow &&
      !row.header &&
      prefixLabel(label, ['total'], true) &&
      !prefixLabel(label, ['totalMeter', 'totalRolls'], true)
    ) {
      if (row.layout !== 'UNAVAILABLE' && !row.ambiguous)
        tableTotals.push({
          rolls: parseInvoiceNumber(cells.rolls, true),
          meter: parseInvoiceNumber(cells.meter),
        });
      else
        issue(
          'TOTAL_ROW_LAYOUT_UNCERTAIN',
          'Total Amount row columns could not be read safely.',
          'invoiceTotals',
          source,
        );
      stopped = true;
      continue;
    }
    if (
      inTable &&
      structuralRow &&
      (tableEnd.test(label) ||
        prefixLabel(label, ['stop', 'totalMeter', 'totalRolls'], true))
    ) {
      stopped = true;
      continue;
    }
    if (!inTable || stopped) continue;
    if (row.layout === 'UNAVAILABLE') {
      // A naked text row cannot establish a blank Item No. cell. Retain it for review.
      if (/[A-Z0-9]+\s*#\s*\S|\bsize\s*:/i.test(source.text))
        markUnassigned(
          row,
          'Table cell positions are unavailable. This row was not attached to the previous item.',
        );
      else if (
        !/^(?:item\s*(?:no|code)|description|colo[u]?r\s*code|quantity|rolls?|unit\s*price|order\s+list)\b/i.test(
          source.text,
        )
      ) {
        issue(
          'ROW_LAYOUT_UNAVAILABLE',
          'A table row could not be assigned to columns. Verify that no item or color was missed.',
          'items',
          source,
        );
        current = null;
      }
      continue;
    }
    const code = clean(cells.item),
      color = clean(cells.color),
      description = sizeValue(cells.description);
    if (row.ambiguous || (code && colorPattern.test(code))) {
      markUnassigned(
        row,
        'Item No. ownership is uncertain at a column boundary. Review this row before assigning it.',
      );
      continue;
    }
    if (code) {
      current = {
        itemCode: code,
        description,
        matchedProductId: null,
        existingDescription: null,
        matchStatus: 'NEW',
        descriptionMissingInExisting: false,
        colors: [],
      };
      if (
        items.some(
          (item) => normalizeCode(item.itemCode) === normalizeCode(code),
        )
      )
        issue(
          'DUPLICATE_ITEM_GROUP',
          `Item No. ${code} starts more than one group. Verify the document.`,
          'items',
          source,
        );
      items.push(current);
    } else if (clean(cells.description) && color) {
      markUnassigned(
        row,
        'A color row has Description content but a blank Item No. cell. Its item ownership needs review.',
      );
      continue;
    }
    if (description && current) {
      if (current.description && current.description !== description)
        issue(
          'ITEM_DESCRIPTION_INCONSISTENT',
          `More than one Description / Size was read for ${current.itemCode}.`,
          'items.description',
          source,
        );
      else current.description = description;
    }
    if (!color && !cells.rolls && !cells.meter) continue;
    colorRows++;
    if (!current) {
      markUnassigned(
        row,
        'This color row has no safely established Item No. owner.',
      );
      continue;
    }
    if (!color || (!colorPattern.test(color) && !/[A-Za-z]/.test(color))) {
      markUnassigned(
        row,
        'The Color Code cell is missing or cannot be read. Item ownership must be reviewed.',
      );
      continue;
    }
    if (!colorPattern.test(color))
      issue(
        'COLOR_CODE_UNCERTAIN',
        `Color Code text could not be validated: ${color}. It is retained literally under its established item.`,
        'items.colors.color',
        source,
      );
    if (source.method === 'OCR') {
      for (const [field, value] of [
        ['item', code],
        ['color', color],
        ['description', description],
      ] as const) {
        const confidence = row.confidence?.[field];
        if (value && confidence !== undefined && confidence < 80)
          issue(
            'OCR_FIELD_UNCERTAIN',
            `OCR ${field} text needs review: ${value}. It has been retained without correction.`,
            `items.${field}`,
            source,
          );
      }
    }
    const meter =
        row.confidence?.meter !== undefined && row.confidence.meter < 60
          ? null
          : parseInvoiceNumber(cells.meter),
      rolls =
        row.confidence?.rolls !== undefined && row.confidence.rolls < 60
          ? null
          : parseInvoiceNumber(cells.rolls, true);
    if (meter === null)
      issue(
        'METER_INVALID',
        `Meter value is missing or uncertain for ${current.itemCode} / ${color}. OCR/source text: ${cells.meter ?? '(blank)'}.`,
        'items.colors.meter',
        source,
      );
    if (rolls === null)
      issue(
        'ROLLS_INVALID',
        `Rolls must be a positive integer for ${current.itemCode} / ${color}. OCR/source text: ${cells.rolls ?? '(blank)'}.`,
        'items.colors.rolls',
        source,
      );
    if (
      current.colors.some(
        (row) => normalizeCode(row.color) === normalizeCode(color),
      )
    )
      issue(
        'DUPLICATE_COLOR_ROW',
        `Repeated Color Code ${color} in ${current.itemCode}; verify the rows.`,
        'items.colors',
        source,
      );
    current.colors.push({
      color,
      meter,
      rolls,
      matchedVariantId: null,
      matchStatus: 'NEW',
      source: { page: source.page, line: source.line, method: source.method },
    });
    if (colorRows > 5000)
      throw new DocumentReadError(
        'TOO_MANY_ROWS',
        'The document contains too many invoice rows.',
      );
  }
  if (
    !inTable ||
    (!items.length && !unassignedRows.length) ||
    !(
      lines.some((l) => prefixLabel(l.text, ['invoice'], true)) ||
      (lines.some((l) => prefixLabel(l.text, ['table'], true)) &&
        containerNumber)
    ) ||
    !(
      containerNumber ||
      (supplier.detectedName &&
        lines.some((l) => prefixLabel(l.text, ['invoice'], true)))
    ) ||
    (!items.some((item) => item.colors.length) && !unassignedRows.length)
  )
    throw new DocumentReadError(
      'UNSUPPORTED_INVOICE',
      'Could not recognize this file as a supported Commercial Invoice. No inventory was changed.',
    );
  for (const item of items) {
    if (!item.description)
      issue(
        'DESCRIPTION_MISSING',
        `Description / Size could not be read for ${item.itemCode}.`,
        'items.description',
      );
    if (!item.colors.length)
      issue(
        'ITEM_WITHOUT_COLORS',
        `No color rows were read for ${item.itemCode}.`,
        'items.colors',
      );
  }
  const readTotal = (key: 'meter' | 'rolls') => {
    const explicit = lines.flatMap((line) => {
      const match = prefixLabel(
        line.text,
        [key === 'rolls' ? 'totalRolls' : 'totalMeter'],
        true,
      );
      return match
        ? [
            parseInvoiceNumber(
              line.text
                .slice(match.end)
                .replace(/^[\s:：]+/, '')
                .split(/[\s|]/)[0],
              key === 'rolls',
            ),
          ]
        : [];
    });
    const values = [...explicit, ...tableTotals.map((total) => total[key])];
    if (
      !values.length ||
      values.some((value) => value === null) ||
      new Set(values).size !== 1
    ) {
      issue(
        'INVOICE_TOTAL_UNCERTAIN',
        `Invoice total ${key === 'rolls' ? 'Rolls' : 'Meter'} is missing, malformed, or conflicting.`,
        `invoiceTotals.${key}`,
      );
      return null;
    }
    return values[0];
  };
  const invoiceTotals = {
    rolls: readTotal('rolls'),
    meter: readTotal('meter'),
  };
  const colors = items.flatMap((item) => item.colors);
  const parsedTotals = {
    rolls: colors.reduce((sum, color) => sum + (color.rolls ?? 0), 0),
    meter: Number(
      colors.reduce((sum, color) => sum + (color.meter ?? 0), 0).toFixed(2),
    ),
  };
  const totalsMatch = {
    rolls:
      invoiceTotals.rolls === null
        ? null
        : !unassignedRows.length &&
          colors.every((color) => color.rolls !== null) &&
          parsedTotals.rolls === invoiceTotals.rolls,
    meter:
      invoiceTotals.meter === null
        ? null
        : !unassignedRows.length &&
          colors.every((color) => color.meter !== null) &&
          Math.abs(parsedTotals.meter - invoiceTotals.meter) < 0.005,
  };
  if (totalsMatch.rolls === false)
    issue(
      'ROLLS_TOTAL_MISMATCH',
      'Invoice and safely assigned parsed Rolls totals do not match.',
      'parsedTotals.rolls',
    );
  if (totalsMatch.meter === false)
    issue(
      'METER_TOTAL_MISMATCH',
      'Invoice and safely assigned parsed Meter totals do not match.',
      'parsedTotals.meter',
    );
  const date = extractInvoiceDate(lines);
  if (date.uncertain) issue('INVOICE_DATE_UNCERTAIN', 'Invoice date is malformed, conflicting or uncertain. Enter a verified Purchase Date.', 'purchasedAt');
  return {
    purchasedAt: date.purchasedAt,
    parserVersion: INVOICE_PARSER_VERSION,
    draftId,
    parsingMethod: document.method,
    supplier,
    containerNumber,
    items,
    unassignedRows,
    invoiceTotals,
    parsedTotals,
    totalsMatch,
    validationPassed:
      !warnings.length &&
      totalsMatch.rolls === true &&
      totalsMatch.meter === true,
    warnings,
  };
}
