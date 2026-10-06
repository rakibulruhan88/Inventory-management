import { BadRequestException } from '@nestjs/common';
import type {
  InvoiceImportIssue,
  InvoiceImportReview,
  InvoiceImportReviewInput,
} from '@afia/contracts';
import { validPurchaseDate } from '@afia/contracts';
import { normalizeCode } from '../common/normalize.js';

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

// Validate without conversion, and reject every key outside the review allowlist.
export function validateReviewInput(value: unknown): InvoiceImportReviewInput {
  const errors: InvoiceImportIssue[] = [];
  const error = (field: string, message: string) =>
    errors.push({ code: 'INVALID_FIELD', field, message });
  function object(
    v: unknown,
    keys: string[],
    field: string,
  ): v is Record<string, unknown> {
    if (!record(v)) {
      error(field, 'Expected an object.');
      return false;
    }
    for (const key of Object.keys(v))
      if (!keys.includes(key))
        error(
          `${field ? field + '.' : ''}${key}`,
          'This field cannot be edited.',
        );
    return true;
  }
  function text(v: unknown, field: string, required: boolean, max = 200) {
    if (!required && v === null) return;
    if (
      typeof v !== 'string' ||
      v.length > max ||
      /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v) ||
      (required && !v.trim())
    )
      error(
        field,
        required
          ? 'Enter a nonblank value within the supported length.'
          : 'Enter text within the supported length, or leave blank.',
      );
  }
  if (
    object(
      value,
      ['supplier', 'containerNumber', 'items', 'purchasedAt', 'purchaseNumber'],
      '',
    )
  ) {
    if (
      object(
        value.supplier,
        ['name', 'phone', 'fax', 'address', 'contactPerson'],
        'supplier',
      )
    ) {
      text(value.supplier.name, 'supplier.name', true);
      for (const key of ['phone', 'fax', 'address', 'contactPerson'])
        text(
          value.supplier[key],
          `supplier.${key}`,
          false,
          key === 'address' ? 1000 : 200,
        );
    }
    text(value.containerNumber, 'containerNumber', true);
    if (
      value.purchasedAt !== undefined &&
      value.purchasedAt !== null &&
      !validPurchaseDate(value.purchasedAt)
    )
      error('purchasedAt', 'Enter a valid Purchase Date (YYYY-MM-DD).');
    if (value.purchaseNumber !== undefined && value.purchaseNumber !== null)
      text(value.purchaseNumber, 'purchaseNumber', true);
    if (
      !Array.isArray(value.items) ||
      !value.items.length ||
      value.items.length > 5000
    )
      error('items', 'Include at least one item (maximum 5,000).');
    else {
      let rows = 0;
      value.items.forEach((item: unknown, i: number) => {
        const path = `items.${i}`;
        if (!object(item, ['itemCode', 'description', 'colors'], path)) return;
        text(item.itemCode, `${path}.itemCode`, true);
        text(item.description, `${path}.description`, false, 500);
        if (
          !Array.isArray(item.colors) ||
          !item.colors.length ||
          item.colors.length > 5000
        )
          error(
            `${path}.colors`,
            'Include at least one color (maximum 5,000).',
          );
        else
          item.colors.forEach((color: unknown, j: number) => {
            rows++;
            const cp = `${path}.colors.${j}`;
            if (!object(color, ['color', 'rolls', 'meter', 'sourceRow'], cp))
              return;
            text(color.color, `${cp}.color`, true);
            if (
              typeof color.rolls !== 'number' ||
              !Number.isSafeInteger(color.rolls) ||
              color.rolls <= 0 ||
              color.rolls > 2147483647
            )
              error(`${cp}.rolls`, 'Rolls must be a positive whole number.');
            if (
              color.meter !== null &&
              (typeof color.meter !== 'number' ||
                !Number.isFinite(color.meter) ||
                color.meter < 0 ||
                color.meter > 9999999999.99 ||
                Math.abs(color.meter * 100 - Math.round(color.meter * 100)) >
                  0.0001)
            )
              error(
                `${cp}.meter`,
                'Meter must be zero or greater, with at most two decimal places, or blank.',
              );
            if (
              color.sourceRow !== undefined &&
              object(color.sourceRow, ['item', 'color'], `${cp}.sourceRow`)
            ) {
              for (const key of ['item', 'color'])
                if (
                  !Number.isSafeInteger(color.sourceRow[key]) ||
                  (color.sourceRow[key] as number) < 0
                )
                  error(
                    `${cp}.sourceRow.${key}`,
                    'Invalid extraction reference.',
                  );
            }
          });
      });
      if (rows > 5000)
        error('items', 'An import supports at most 5,000 color rows.');
    }
  }
  if (errors.length)
    throw new BadRequestException({
      message: 'Check the highlighted review fields.',
      fieldErrors: errors,
    });
  const input = value as InvoiceImportReviewInput;
  const problems = fieldIssues(input);
  if (problems.length)
    throw new BadRequestException({
      message: 'Check the highlighted review fields.',
      fieldErrors: problems,
    });
  return input;
}

export function fieldIssues(
  input: InvoiceImportReviewInput,
): InvoiceImportIssue[] {
  const issues: InvoiceImportIssue[] = [];
  const add = (field: string, message: string) =>
    issues.push({ code: 'REVIEW_INVALID', field, message });
  if (!input.supplier.name.trim())
    add('supplier.name', 'Supplier name is required.');
  if (!input.containerNumber.trim())
    add('containerNumber', 'Container Number is required.');
  if (!input.items.length) add('items', 'At least one item is required.');
  const items = new Set<string>();
  input.items.forEach((item, i) => {
    const path = `items.${i}`;
    if (!item.itemCode.trim())
      add(`${path}.itemCode`, 'Item Code is required.');
    const code = normalizeCode(item.itemCode);
    if (items.has(code))
      add(`${path}.itemCode`, 'Item Code is duplicated in this import.');
    items.add(code);
    if (!item.colors.length)
      add(`${path}.colors`, 'At least one color is required.');
    const colors = new Set<string>();
    item.colors.forEach((color, j) => {
      const cp = `${path}.colors.${j}`;
      if (!color.color.trim()) add(`${cp}.color`, 'Color Code is required.');
      const code = normalizeCode(color.color);
      if (colors.has(code))
        add(`${cp}.color`, 'Color Code is duplicated within this item.');
      colors.add(code);
      if (
        color.rolls === null ||
        !Number.isSafeInteger(color.rolls) ||
        color.rolls <= 0
      )
        add(`${cp}.rolls`, 'Rolls must be a positive whole number.');
      if (
        color.meter !== null &&
        (!Number.isFinite(color.meter) || color.meter < 0)
      )
        add(`${cp}.meter`, 'Meter must be zero or greater, or blank.');
    });
  });
  return issues;
}

export function reviewInput(
  review: InvoiceImportReview,
): InvoiceImportReviewInput {
  return {
    purchasedAt: review.purchasedAt ?? null,
    purchaseNumber: review.purchaseNumber ?? null,
    supplier: {
      name: review.supplier.detectedName ?? '',
      phone: review.supplier.phone,
      fax: review.supplier.fax,
      address: review.supplier.address,
      contactPerson: review.supplier.contactPerson,
    },
    containerNumber: review.containerNumber ?? '',
    items: review.items.map((item) => ({
      itemCode: item.itemCode,
      description: item.description,
      colors: item.colors.map((color) => ({
        color: color.color,
        rolls: color.rolls,
        meter: color.meter,
      })),
    })),
  };
}

export function buildReviewedData(
  original: InvoiceImportReview,
  input: InvoiceImportReviewInput,
): InvoiceImportReview {
  const review = structuredClone(original);
  review.purchasedAt = input.purchasedAt ?? null;
  review.purchaseNumber = input.purchaseNumber?.trim() || null;
  review.supplier = {
    detectedName: input.supplier.name.trim(),
    phone: input.supplier.phone?.trim() || null,
    fax: input.supplier.fax?.trim() || null,
    address: input.supplier.address?.trim() || null,
    contactPerson: input.supplier.contactPerson?.trim() || null,
    matchedSupplierId: null,
    matchStatus: 'NEW',
  };
  review.containerNumber = input.containerNumber.trim();
  review.warnings = original.warnings.filter(
    (w) => w.code === 'INVOICE_TOTAL_UNCERTAIN',
  );
  const references = new Set<string>();
  review.items = input.items.map((item, i) => ({
    itemCode: item.itemCode.trim(),
    description: item.description?.trim() || null,
    matchedProductId: null,
    existingDescription: null,
    matchStatus: 'NEW',
    descriptionMissingInExisting: false,
    colors: item.colors.map((color, j) => {
      let source = null;
      if (color.sourceRow) {
        const key = `${color.sourceRow.item}:${color.sourceRow.color}`;
        const extracted =
          original.items[color.sourceRow.item]?.colors[color.sourceRow.color];
        if (!extracted || references.has(key))
          throw new BadRequestException({
            message: 'Invalid extraction reference.',
            fieldErrors: [
              {
                code: 'SOURCE_INVALID',
                field: `items.${i}.colors.${j}.sourceRow`,
                message: 'Extraction reference is invalid or duplicated.',
              },
            ],
          });
        references.add(key);
        source = extracted.source;
      }
      return {
        color: color.color.trim(),
        rolls: color.rolls,
        meter: color.meter,
        source,
        matchedVariantId: null,
        matchStatus: 'NEW',
      };
    }),
  }));
  recalculate(review);
  return review;
}

// Keep actionable source uncertainty only while the implicated value is unchanged.
// Original warnings always remain in parsedData, including after row removal/correction.
export function currentSourceIssues(
  original: InvoiceImportReview,
  review: InvoiceImportReview,
): InvoiceImportIssue[] {
  const issues: InvoiceImportIssue[] = [];
  for (const warning of original.warnings) {
    if (
      ['INVOICE_TOTAL_UNCERTAIN', 'ROW_LAYOUT_UNAVAILABLE'].includes(
        warning.code,
      )
    ) {
      issues.push(warning);
      continue;
    }
    if (
      ![
        'COLOR_CODE_UNCERTAIN',
        'OCR_FIELD_UNCERTAIN',
        'METER_INVALID',
        'ROLLS_INVALID',
        'ITEM_DESCRIPTION_INCONSISTENT',
      ].includes(warning.code)
    )
      continue;
    for (const originalItem of original.items)
      for (const extracted of originalItem.colors) {
        if (
          !extracted.source ||
          extracted.source.page !== warning.page ||
          extracted.source.line !== warning.line
        )
          continue;
        const rawKey = warning.field?.split('.').at(-1);
        const key = rawKey === 'item' ? 'itemCode' : rawKey;
        review.items.forEach((item, i) =>
          item.colors.forEach((color, j) => {
            const sameSource =
              color.source &&
              color.source.page === extracted.source!.page &&
              color.source.line === extracted.source!.line &&
              color.source.method === extracted.source!.method;
            const sameIdentity =
              normalizeCode(item.itemCode) ===
                normalizeCode(originalItem.itemCode) &&
              normalizeCode(color.color) === normalizeCode(extracted.color);
            if (!sameSource && !sameIdentity) return;
            const unchanged =
              key === 'itemCode'
                ? item.itemCode === originalItem.itemCode
                : key === 'description'
                  ? item.description === originalItem.description
                  : key === 'color'
                    ? color.color === extracted.color
                    : key === 'rolls'
                      ? color.rolls === extracted.rolls
                      : key === 'meter'
                        ? color.meter === extracted.meter
                        : false;
            if (unchanged)
              issues.push({
                ...warning,
                code: 'REVIEW_SOURCE_UNCERTAIN',
                field:
                  key === 'itemCode' || key === 'description'
                    ? `items.${i}.${key}`
                    : `items.${i}.colors.${j}.${key}`,
                message: `Verify and correct this unchanged source field: ${warning.message}`,
              });
          }),
        );
      }
  }
  return issues;
}

export function recalculate(review: InvoiceImportReview) {
  let rolls = 0,
    cents = 0;
  for (const item of review.items)
    for (const color of item.colors) {
      rolls += color.rolls ?? 0;
      cents += Math.round((color.meter ?? 0) * 100);
    }
  review.parsedTotals = { rolls, meter: cents / 100 };
  review.totalsMatch = {
    rolls:
      review.invoiceTotals.rolls === null
        ? null
        : rolls === review.invoiceTotals.rolls,
    meter:
      review.invoiceTotals.meter === null
        ? null
        : cents === Math.round(review.invoiceTotals.meter * 100),
  };
}

export function blockingIssues(
  review: InvoiceImportReview,
  reviewed: boolean,
): InvoiceImportIssue[] {
  const issues = fieldIssues(reviewInput(review));
  if (!validPurchaseDate(review.purchasedAt))
    issues.push({
      code: 'PURCHASE_DATE_REQUIRED',
      field: 'purchasedAt',
      message: 'Enter a verified Purchase Date before receiving stock.',
    });
  if (!review.purchaseNumber?.trim())
    issues.push({
      code: 'PURCHASE_REFERENCE_REQUIRED',
      field: 'purchaseNumber',
      message: 'Enter a Purchase Reference before receiving stock.',
    });
  for (const key of ['rolls', 'meter'] as const) {
    if (review.totalsMatch[key] === false)
      issues.push({
        code: 'SOURCE_TOTAL_MISMATCH',
        field: `totals.${key}`,
        message: `${key === 'rolls' ? 'Rolls' : 'Meter'} does not match the source invoice.`,
      });
  }
  if (review.invoiceTotals.rolls === null)
    issues.push({
      code: 'SOURCE_TOTAL_MISSING',
      message:
        'Source invoice Rolls total is unavailable. Verify the source before confirmation.',
    });
  if (review.unassignedRows.length)
    issues.push({
      code: 'ROW_OWNERSHIP',
      message: 'Some extracted rows have unresolved item ownership.',
    });
  if (
    review.parsedTotals.rolls > 2147483647 ||
    review.parsedTotals.meter > 9999999999.99
  )
    issues.push({
      code: 'TOTAL_LIMIT',
      message: 'Reviewed totals exceed supported limits.',
    });
  const unsafe = new Set([
    'CONTAINER_EXISTS',
    'DESCRIPTION_CONFLICT',
    'EXISTING_DESCRIPTION_MISSING',
    'ITEM_ARCHIVED',
    'COLOR_ARCHIVED',
    'COLOR_AMBIGUOUS',
    'SUPPLIER_AMBIGUOUS',
    'INVOICE_TOTAL_UNCERTAIN',
    'REVIEW_SOURCE_UNCERTAIN',
    'ROW_LAYOUT_UNAVAILABLE',
  ]);
  const recalculatedOrInformational = new Set([
    'INVOICE_DATE_UNCERTAIN',
    'DESCRIPTION_MISSING',
    'PDF_TEXT_FAILED',
    'SUPPLIER_MISSING',
    'CONTAINER_MISSING',
    'ROLLS_TOTAL_MISMATCH',
    'METER_TOTAL_MISMATCH',
    'ITEM_WITHOUT_COLORS',
    'DUPLICATE_ITEM_GROUP',
    'DUPLICATE_COLOR_ROW',
    'ROW_OWNERSHIP_UNCERTAIN',
  ]);
  issues.push(
    ...review.warnings.filter(
      (w) =>
        !recalculatedOrInformational.has(w.code) &&
        (!reviewed || unsafe.has(w.code)),
    ),
  );
  return issues;
}
