import type { InvoiceImportIssue, InvoiceImportReview } from "@afia/contracts";
import type { EditableReview } from "./invoice-review-form";

export type ReviewIssueTarget = { path: string; label: string };
export type ReviewIssueSelection = {
  issue: InvoiceImportIssue;
  index: number;
  target: ReviewIssueTarget;
  current?: boolean;
};

export const reviewTargetId = (path: string) =>
  `review-${path.replaceAll(".", "-")}`;

const labels: Record<string, string> = {
  purchasedAt: "Purchase Date",
  purchaseNumber: "Purchase Reference",
  containerNumber: "Container Number",
  name: "Supplier name",
  phone: "Phone",
  fax: "Fax",
  address: "Address",
  contactPerson: "Contact person",
  item: "Item Code",
  itemCode: "Item Code",
  description: "Description / Size",
  color: "Color Code",
  rolls: "Rolls",
  meter: "Meter",
};

export function issueCopy(issue: InvoiceImportIssue) {
  const field =
    labels[issue.field?.split(".").at(-1) ?? ""] ?? "invoice details";
  if (
    issue.code === "SOURCE_TOTAL_MISSING" ||
    issue.code === "INVOICE_TOTAL_UNCERTAIN" ||
    issue.code === "TOTAL_ROW_LAYOUT_UNCERTAIN"
  )
    return {
      title:
        issue.code === "SOURCE_TOTAL_MISSING"
          ? "The invoice's total Rolls could not be read."
          : `The printed invoice total${field === "Rolls" || field === "Meter" ? ` ${field}` : ""} could not be read clearly.`,
      help: "Enter the verified invoice totals manually, check every item/color, then save and check.",
    };
  if (
    [
      "SOURCE_TOTAL_MISMATCH",
      "ROLLS_TOTAL_MISMATCH",
      "METER_TOTAL_MISMATCH",
    ].includes(issue.code)
  )
    return {
      title: `${field === "invoice details" ? "The item totals" : field} do not match the invoice.`,
      help: "Compare the totals, then check the numbers in each color row.",
    };
  if (
    [
      "ROW_OWNERSHIP",
      "ROW_OWNERSHIP_UNCERTAIN",
      "ROW_LAYOUT_UNAVAILABLE",
      "COLUMN_STRUCTURE_UNCERTAIN",
    ].includes(issue.code)
  )
    return {
      title: "Some invoice rows could not be matched to an item.",
      help: "Check the listed rows against the invoice. A clearer copy may be needed.",
    };
  if (
    [
      "COLOR_CODE_UNCERTAIN",
      "REVIEW_SOURCE_UNCERTAIN",
      "OCR_FIELD_UNCERTAIN",
      "ITEM_DESCRIPTION_INCONSISTENT",
    ].includes(issue.code)
  )
    return {
      title: `Check ${field === "invoice details" ? "this Color Code" : field} against the invoice.`,
      help: "Copy the correct value from the invoice, then save and check again.",
    };
  if (
    issue.code === "DESCRIPTION_CONFLICT" ||
    issue.code === "EXISTING_DESCRIPTION_MISSING"
  )
    return {
      title: "Description / Size needs checking against the saved item.",
      help: "Compare with the existing value shown below. Saved item details can be changed in Inventory.",
    };
  if (
    [
      "ITEM_ARCHIVED",
      "COLOR_ARCHIVED",
      "COLOR_AMBIGUOUS",
      "SUPPLIER_AMBIGUOUS",
    ].includes(issue.code)
  )
    return {
      title: issue.message,
      help: "Check the matching saved record. This may need a correction in Inventory or Suppliers.",
    };
  if (issue.message.includes("duplicated"))
    return {
      title: issue.message,
      help: "Check both entries. Correct the code or remove the extra row if the invoice lists it only once.",
    };
  if (issue.code === "METER_INVALID" || issue.code === "ROLLS_INVALID")
    return {
      title: `Check the ${issue.code === "ROLLS_INVALID" ? "Rolls" : "Meter"} in this color row.`,
      help:
        issue.code === "ROLLS_INVALID"
          ? "Enter the whole number of Rolls printed on the invoice."
          : "Enter the Meter printed on the invoice, with up to two decimal places.",
    };
  return {
    title: issue.message,
    help: "Check this part of the invoice, correct it, then save and check again.",
  };
}

function fieldTarget(
  path: string,
  review: InvoiceImportReview,
): ReviewIssueTarget {
  const match = /^items\.(\d+)(?:\.colors\.(\d+))?/.exec(path);
  const field =
    labels[path.split(".").at(-1) ?? ""] ??
    (match?.[2] === undefined ? "Item details" : "Color row");
  if (!match) return { path, label: labels[path] ?? field };
  const item = review.items[Number(match[1])];
  const color =
    match[2] === undefined ? undefined : item?.colors[Number(match[2])];
  return {
    path,
    label: [
      `Item ${item?.itemCode || Number(match[1]) + 1}`,
      color
        ? `Color ${Number(match[2]) + 1}: ${color.color || "not entered"}`
        : undefined,
      field,
    ]
      .filter(Boolean)
      .join(" · "),
  };
}

export function reviewIssueTargets(
  issue: InvoiceImportIssue,
  review: InvoiceImportReview,
): ReviewIssueTarget[] {
  const path = issue.field ?? "";
  if (/^verifiedInvoiceTotals\.(rolls|meter|confirmed)$/.test(path))
    return [
      {
        path,
        label: path.endsWith("confirmed")
          ? "Confirm invoice totals were checked"
          : `Enter verified invoice total ${labels[path.split(".").at(-1)!]}`,
      },
    ];
  if (
    [
      "SOURCE_TOTAL_MISSING",
      "INVOICE_TOTAL_UNCERTAIN",
      "TOTAL_ROW_LAYOUT_UNCERTAIN",
    ].includes(issue.code)
  ) {
    const measure = path.endsWith("meter") ? "meter" : "rolls";
    return [
      {
        path: `verifiedInvoiceTotals.${measure}`,
        label: `Enter verified invoice total ${labels[measure]}`,
      },
    ];
  }
  if (
    /^(invoiceTotals|parsedTotals|totals)(\.|$)/.test(path) ||
    [
      "SOURCE_TOTAL_MISSING",
      "INVOICE_TOTAL_UNCERTAIN",
      "TOTAL_ROW_LAYOUT_UNCERTAIN",
      "TOTAL_LIMIT",
    ].includes(issue.code)
  )
    return [{ path: "totals", label: "Compare invoice totals" }];
  if (
    path === "unassignedRows" ||
    [
      "ROW_OWNERSHIP",
      "ROW_OWNERSHIP_UNCERTAIN",
      "ROW_LAYOUT_UNAVAILABLE",
      "COLUMN_STRUCTURE_UNCERTAIN",
    ].includes(issue.code)
  )
    return [{ path: "unassignedRows", label: "Check unmatched invoice rows" }];
  if (path === "supplier")
    return [{ path: "supplier.name", label: "Supplier name" }];
  if (
    /^(purchasedAt|purchaseNumber|containerNumber|supplier\.(name|phone|fax|address|contactPerson))$/.test(
      path,
    )
  )
    return [fieldTarget(path, review)];
  if (
    /^items\.\d+(\.(itemCode|description|colors)(\.\d+(\.(color|rolls|meter|sourceRow)(\.(item|color))?)?)?)?$/.test(
      path,
    )
  )
    return [
      fieldTarget(
        path.replace(/\.sourceRow(\.(item|color))?$/, ".color"),
        review,
      ),
    ];

  // Parser warnings carry page/line positions instead of editable row indexes.
  const targets: ReviewIssueTarget[] = [];
  review.items.forEach((item, i) => {
    item.colors.forEach((color, j) => {
      if (
        issue.page !== undefined &&
        issue.line !== undefined &&
        color.source?.page === issue.page &&
        color.source.line === issue.line
      ) {
        const key = path.split(".").at(-1);
        targets.push(
          fieldTarget(
            key === "item" || key === "itemCode"
              ? `items.${i}.itemCode`
              : key === "description"
                ? `items.${i}.description`
                : `items.${i}.colors.${j}.${["rolls", "meter"].includes(key ?? "") ? key : "color"}`,
            review,
          ),
        );
      }
    });
  });
  if (targets.length)
    return targets.filter(
      (target, i) =>
        targets.findIndex((other) => other.path === target.path) === i,
    );

  review.items.forEach((item, i) => {
    if (
      issue.code === "DESCRIPTION_CONFLICT" &&
      item.matchStatus === "DESCRIPTION_CONFLICT" &&
      issue.message ===
        `Description / Size differs from the existing item ${item.itemCode}.`
    )
      targets.push(fieldTarget(`items.${i}.description`, review));
    if (
      issue.code === "EXISTING_DESCRIPTION_MISSING" &&
      item.descriptionMissingInExisting &&
      issue.message ===
        `${item.itemCode} has no existing Description / Size. No database value was updated.`
    )
      targets.push(fieldTarget(`items.${i}.description`, review));
    if (
      issue.code === "ITEM_ARCHIVED" &&
      issue.message.startsWith(`${item.itemCode} exists`)
    )
      targets.push(fieldTarget(`items.${i}.itemCode`, review));
    item.colors.forEach((color, j) => {
      if (
        (issue.code === "COLOR_ARCHIVED" &&
          issue.message === `${item.itemCode} / ${color.color} is archived.`) ||
        (issue.code === "COLOR_AMBIGUOUS" &&
          issue.message ===
            `Multiple existing colors match ${item.itemCode} / ${color.color}.`)
      )
        targets.push(fieldTarget(`items.${i}.colors.${j}.color`, review));
    });
  });
  return targets.length
    ? targets
    : [{ path: "items", label: "Check imported items" }];
}

// Keep saved issue locations attached to their source row after manual row removal.
export function currentReviewTarget(
  target: ReviewIssueTarget,
  review: InvoiceImportReview,
  original: InvoiceImportReview,
  edit: EditableReview,
  positionsUnchanged = true,
): ReviewIssueTarget {
  const match = /^items\.(\d+)(?:\.colors\.(\d+))?(.*)$/.exec(target.path);
  if (!match) return target;
  const i = Number(match[1]),
    j = match[2] === undefined ? undefined : Number(match[2]);
  const item = review.items[i];
  if (!item) return { path: "items", label: "Check imported items" };
  const source = j === undefined ? undefined : item.colors[j]?.source;
  if (source) {
    for (const [ei, editedItem] of edit.items.entries()) {
      for (const [ej, color] of editedItem.colors.entries()) {
        const ref = color.sourceRow;
        const currentSource = ref
          ? original.items[ref.item]?.colors[ref.color]?.source
          : null;
        if (
          currentSource?.page === source.page &&
          currentSource.line === source.line &&
          currentSource.method === source.method
        )
          return { ...target, path: `items.${ei}.colors.${ej}${match[3]}` };
      }
    }
    return {
      path: "items",
      label: "Row changed or removed · Save and check again",
    };
  }
  const ei = edit.items.findIndex(
    (candidate) =>
      candidate.itemCode === item.itemCode ||
      candidate.colors.some((color) => {
        const ref = color.sourceRow;
        const currentSource = ref
          ? original.items[ref.item]?.colors[ref.color]?.source
          : null;
        return (
          currentSource &&
          item.colors.some(
            (row) =>
              row.source?.page === currentSource.page &&
              row.source.line === currentSource.line &&
              row.source.method === currentSource.method,
          )
        );
      }),
  );
  const currentItem =
    ei >= 0
      ? ei
      : positionsUnchanged && edit.items.length === review.items.length
        ? i
        : -1;
  if (currentItem < 0)
    return {
      path: "items",
      label: "Item changed or removed · Save and check again",
    };
  if (
    j !== undefined &&
    (!positionsUnchanged ||
      edit.items[currentItem].colors.length !== item.colors.length)
  )
    return {
      path: `items.${currentItem}.colors`,
      label: "Color rows changed · Save and check again",
    };
  return {
    ...target,
    path: `items.${currentItem}${j === undefined ? "" : `.colors.${j}`}${match[3]}`,
  };
}
