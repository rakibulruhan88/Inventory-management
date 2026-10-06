import { describe, expect, it } from "vitest";
import type { InvoiceImportReview } from "@afia/contracts";
import {
  editableReview,
  liveTotals,
  reviewPayload,
} from "./invoice-review-form";

const extracted: InvoiceImportReview = {
  parserVersion: 3,
  draftId: "fixture",
  parsingMethod: "OCR",
  supplier: {
    detectedName: "Fixture supplier",
    phone: null,
    fax: null,
    address: null,
    contactPerson: null,
    matchedSupplierId: null,
    matchStatus: "NEW",
  },
  containerNumber: "FIXTURE",
  items: [
    {
      itemCode: "A1",
      description: "Size",
      matchedProductId: null,
      existingDescription: null,
      matchStatus: "NEW",
      descriptionMissingInExisting: false,
      colors: [
        {
          color: "01#Blue",
          rolls: 3,
          meter: 10.1,
          source: { page: 1, line: 3, method: "OCR" },
          matchedVariantId: null,
          matchStatus: "NEW",
        },
        {
          color: "02#Red",
          rolls: 2,
          meter: 0.2,
          source: { page: 1, line: 4, method: "OCR" },
          matchedVariantId: null,
          matchStatus: "NEW",
        },
      ],
    },
  ],
  unassignedRows: [],
  invoiceTotals: { rolls: 5, meter: 10.3 },
  parsedTotals: { rolls: 5, meter: 10.3 },
  totalsMatch: { rolls: true, meter: true },
  validationPassed: true,
  warnings: [],
};

describe("editable invoice review form domain", () => {
  it("makes an independent editor snapshot and explicit payload without declared totals or internal IDs", () => {
    const before = structuredClone(extracted);
    const edit = editableReview(extracted, extracted);
    edit.supplier.name = "Verified supplier";
    edit.supplier.phone = "123";
    edit.containerNumber = "CHANGED";
    edit.items[0].itemCode = "B1";
    edit.items[0].description = "New size";
    edit.items[0].colors[0].color = "Verified blue";
    const payload = reviewPayload(edit);
    expect(extracted).toEqual(before);
    expect(payload).not.toHaveProperty("invoiceTotals");
    expect(payload.items[0]).not.toHaveProperty("matchedProductId");
    expect(payload.items[0].colors[0]).not.toHaveProperty("matchedVariantId");
    expect(payload.items[0].colors[0].sourceRow).toEqual({ item: 0, color: 0 });
    expect(payload.supplier.name).toBe("Verified supplier");
  });
  it("recalculates live totals in cents after edits, additions and removals", () => {
    const edit = editableReview(extracted, extracted);
    expect(liveTotals(edit)).toEqual({ rolls: 5, meter: 10.3, valid: true });
    edit.items[0].colors[0].rolls = "7";
    edit.items[0].colors[0].meter = "10.25";
    edit.items.push({
      itemCode: "B",
      description: "",
      colors: [{ color: "New", rolls: "1", meter: "0.10" }],
    });
    expect(liveTotals(edit)).toEqual({ rolls: 10, meter: 10.55, valid: true });
    edit.items[0].colors.pop();
    edit.items.pop();
    expect(liveTotals(edit)).toEqual({ rolls: 7, meter: 10.25, valid: true });
  });
  it("preserves blank optional Meter and zero Meter distinctly", () => {
    const edit = editableReview(extracted, extracted);
    edit.items[0].colors[0].meter = "";
    edit.items[0].colors[1].meter = "0";
    expect(reviewPayload(edit).items[0].colors.map((c) => c.meter)).toEqual([
      null,
      0,
    ]);
    expect(liveTotals(edit).meter).toBe(0);
  });
  it.each(["", "0", "-1", "1.5", "1.0", "abc", "1e2", "99999999999999999999"])(
    "does not coerce invalid Rolls %s",
    (value) => {
      const edit = editableReview(extracted, extracted);
      edit.items[0].colors[0].rolls = value;
      expect(liveTotals(edit).valid).toBe(false);
      expect(() => reviewPayload(edit)).toThrow();
    },
  );
  it.each(["-1", "abc", "1e2", "1.001", "9".repeat(400)])(
    "does not coerce invalid Meter %s",
    (value) => {
      const edit = editableReview(extracted, extracted);
      edit.items[0].colors[0].meter = value;
      expect(liveTotals(edit).valid).toBe(false);
      expect(() => reviewPayload(edit)).toThrow();
    },
  );
  it("keeps newly added rows without fabricated source locations", () => {
    const edit = editableReview(extracted, extracted);
    edit.items[0].colors.push({ color: "New", rolls: "1", meter: "" });
    expect(reviewPayload(edit).items[0].colors[2].sourceRow).toBeUndefined();
  });
  it("initializes reopening from the saved review and keeps the extraction separate for cancel/reset", () => {
    const saved = structuredClone(extracted);
    saved.items[0].colors[0].meter = 12;
    const edit = editableReview(saved, extracted);
    edit.items[0].colors[0].meter = "99";
    expect(editableReview(saved, extracted).items[0].colors[0].meter).toBe(
      "12",
    );
    expect(editableReview(extracted, extracted).items[0].colors[0].meter).toBe(
      "10.1",
    );
  });
});
