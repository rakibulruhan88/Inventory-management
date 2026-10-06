import { defaultPurchaseNumber } from "@afia/contracts";
import type {
  InvoiceImportReview,
  InvoiceImportReviewInput,
} from "@afia/contracts";

export type EditableColor = {
  color: string;
  rolls: string;
  meter: string;
  sourceRow?: { item: number; color: number };
};
export type EditableReview = Omit<InvoiceImportReviewInput, "items"> & {
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
  return {
    ...edit,
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
