import { defaultPurchaseNumber } from "@afia/contracts";
import type {
  InvoiceImportReview,
  InvoiceImportReviewInput,
  InvoiceImportIssue,
} from "@afia/contracts";

export type EditableColor = {
  color: string;
  rolls: string;
  meter: string;
  sourceRow?: { item: number; color: number };
};
export type EditableReview = Omit<
  InvoiceImportReviewInput,
  "items" | "verifiedInvoiceTotals"
> & {
  verifiedInvoiceTotals: { rolls: string; meter: string; confirmed: boolean };
  items: { itemCode: string; description: string; colors: EditableColor[] }[];
};

export function editableReview(
  review: InvoiceImportReview,
  original: InvoiceImportReview,
): EditableReview {
  return {
    purchasedAt: review.purchasedAt ?? null,
    purchaseNumber: review.purchaseNumber ?? defaultPurchaseNumber(new Date()),
    supplier: {
      name: review.supplier.detectedName ?? "",
      phone: review.supplier.phone,
      fax: review.supplier.fax,
      address: review.supplier.address,
      contactPerson: review.supplier.contactPerson,
    },
    containerNumber: review.containerNumber ?? "",
    verifiedInvoiceTotals: {
      rolls: review.verifiedInvoiceTotals
        ? String(review.verifiedInvoiceTotals.rolls)
        : "",
      meter: review.verifiedInvoiceTotals
        ? String(review.verifiedInvoiceTotals.meter)
        : "",
      confirmed: review.verifiedInvoiceTotals?.confirmed === true,
    },
    items: review.items.map((item) => ({
      itemCode: item.itemCode,
      description: item.description ?? "",
      colors: item.colors.map((color) => {
        let sourceRow: EditableColor["sourceRow"];
        if (color.source)
          original.items.forEach((oi, i) =>
            oi.colors.forEach((oc, j) => {
              if (
                oc.source?.page === color.source?.page &&
                oc.source?.line === color.source?.line &&
                oc.source?.method === color.source?.method
              )
                sourceRow = { item: i, color: j };
            }),
          );
        return {
          color: color.color,
          rolls: color.rolls === null ? "" : String(color.rolls),
          meter: color.meter === null ? "" : String(color.meter),
          ...(sourceRow ? { sourceRow } : {}),
        };
      }),
    })),
  };
}

function parsedNumber(value: string, optional: boolean): number | null {
  if (value === "" && optional) return null;
  const pattern = optional ? /^\d+(?:\.\d{1,2})?$/ : /^\d+$/;
  const number = Number(value);
  if (
    !pattern.test(value) ||
    !Number.isFinite(number) ||
    (!optional &&
      (!Number.isSafeInteger(number) || number <= 0 || number > 2147483647)) ||
    (optional && number > 9999999999.99)
  )
    throw new Error("Enter valid Rolls and Meter before saving.");
  return number;
}
export function reviewPayload(edit: EditableReview): InvoiceImportReviewInput {
  const { verifiedInvoiceTotals, ...fields } = edit;
  const issues = manualTotalIssues(edit);
  if (issues.length) throw new Error(issues[0].message);
  return {
    ...fields,
    ...(verifiedInvoiceTotals.confirmed
      ? {
          verifiedInvoiceTotals: {
            rolls: parsedNumber(verifiedInvoiceTotals.rolls, false)!,
            meter: parsedNumber(verifiedInvoiceTotals.meter, true)!,
            confirmed: true as const,
          },
        }
      : {}),
    purchasedAt: edit.purchasedAt || null,
    purchaseNumber: edit.purchaseNumber?.trim() || null,
    items: edit.items.map((item) => ({
      ...item,
      description: item.description.trim() || null,
      colors: item.colors.map((color) => ({
        ...color,
        rolls: parsedNumber(color.rolls, false),
        meter: parsedNumber(color.meter, true),
      })),
    })),
  };
}

export function manualTotalIssues(edit: EditableReview): InvoiceImportIssue[] {
  const totals = edit.verifiedInvoiceTotals;
  if (!totals.rolls && !totals.meter && !totals.confirmed) return [];
  const issues: InvoiceImportIssue[] = [];
  for (const measure of ["rolls", "meter"] as const) {
    try {
      if (parsedNumber(totals[measure], measure === "meter") === null)
        throw new Error();
    } catch {
      issues.push({
        code: "INVALID_FIELD",
        field: `verifiedInvoiceTotals.${measure}`,
        message:
          measure === "rolls"
            ? "Enter a positive whole-number invoice Rolls total."
            : "Enter an invoice Meter total of zero or greater, with at most two decimals.",
      });
    }
  }
  if (!totals.confirmed)
    issues.push({
      code: "INVALID_FIELD",
      field: "verifiedInvoiceTotals.confirmed",
      message:
        "Confirm that you checked the totals and every item/color against the invoice.",
    });
  return issues;
}

export function liveTotals(edit: EditableReview) {
  let rolls = 0,
    cents = 0,
    valid = true;
  for (const item of edit.items)
    for (const color of item.colors) {
      if (
        !/^\d+$/.test(color.rolls) ||
        Number(color.rolls) <= 0 ||
        !Number.isSafeInteger(Number(color.rolls)) ||
        Number(color.rolls) > 2147483647
      )
        valid = false;
      else rolls += Number(color.rolls);
      if (color.meter !== "") {
        if (
          !/^\d+(?:\.\d{1,2})?$/.test(color.meter) ||
          !Number.isFinite(Number(color.meter)) ||
          Number(color.meter) > 9999999999.99
        )
          valid = false;
        else cents += Math.round(Number(color.meter) * 100);
      }
    }
  return { rolls, meter: cents / 100, valid };
}
