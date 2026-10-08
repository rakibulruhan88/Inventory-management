import { describe, it, expect } from "vitest";
import { saleLineAmount } from "@afia/contracts";
import {
  addColorRow,
  removeColorRow,
  previewAmount,
  previewSubtotal,
  remainingBeforeRow,
  stockErrors,
  colorOptions,
  saleInputNumber,
} from "./new-sale-domain";
import { newSaleSchema } from "./new-sale-form";

const stock = [
  {
    variantId: "black",
    color: "1#Black",
    availableRolls: 3,
    availableMeter: 1050,
  },
];
const row = {
  entryKey: "first",
  variantId: "black",
  rollsSold: 1,
  meterSold: 500,
  unitPricePerRoll: 1000,
};
const draft = {
  customer: { name: "Rahim", email: "", phone: "", address: "" },
  soldAt: "2026-10-07",
  discountAmount: 0,
  receivedAmount: 0,
  paymentMethod: "CASH",
  emailInvoice: false,
  items: [{ productId: "p1", colors: [row] }],
};
describe("New Sale repeated-row and per-roll domain", () => {
  it.each([2, 3])("accepts %i repeated colors in the form schema", (count) => {
    expect(
      newSaleSchema.safeParse({
        ...draft,
        items: [
          {
            productId: "p1",
            colors: Array.from({ length: count }, () => ({ ...row })),
          },
        ],
      }).success,
    ).toBe(true);
  });
  it("keeps the existing duplicate-item group rule", () => {
    expect(
      newSaleSchema.safeParse({
        ...draft,
        items: [...draft.items, ...draft.items],
      }).success,
    ).toBe(false);
  });
  it("adds and removes one intentional row without merging repeated colors", () => {
    const different = { ...row, meterSold: 550, unitPricePerRoll: 2000 };
    const rows = addColorRow([row], different);
    expect(rows).toEqual([row, different]);
    expect(removeColorRow(rows, 0)).toEqual([different]);
    expect(rows).toHaveLength(2);
  });
  it("keeps a selected color in the picker even when the draft consumes every Roll", () => {
    expect(colorOptions(stock)).toEqual(
      expect.arrayContaining([expect.objectContaining({ value: "black" })]),
    );
    expect(
      remainingBeforeRow(stock[0], [{ ...row, rollsSold: 3, meterSold: 1050 }]),
    ).toEqual({ rolls: 0, meter: 0, repeated: true });
    expect(colorOptions(stock)[0].value).toBe("black");
  });
  it("shows remaining stock before a repeated row and ignores different variants", () => {
    expect(
      remainingBeforeRow(stock[0], [row, { ...row, variantId: "red" }]),
    ).toEqual({ rolls: 2, meter: 550, repeated: true });
    expect(remainingBeforeRow(stock[0], [])).toEqual({
      rolls: 3,
      meter: 1050,
      repeated: false,
    });
  });
  it("accepts aggregate stock at the exact limits", () => {
    expect(stockErrors([row, { ...row, meterSold: 550 }], stock).size).toBe(0);
  });
  it("validates combined Rolls and Meter across every repeated row", () => {
    const errors = stockErrors(
      [
        { ...row, rollsSold: 2, meterSold: 600 },
        { ...row, rollsSold: 2, meterSold: 600 },
      ],
      stock,
    );
    expect(errors.get("black")).toEqual({
      rolls: "Only 3 Rolls are available across all 1#Black rows.",
      meter: "Only 1,050 Meter is available across all 1#Black rows.",
    });
  });
  it("removing an offending row clears aggregate oversell", () => {
    const rows = [row, { ...row, rollsSold: 3, meterSold: 600 }];
    expect(stockErrors(rows, stock).size).toBe(1);
    expect(stockErrors(removeColorRow(rows, 1), stock).size).toBe(0);
  });
  it.each([
    [1, 1000, 1000],
    [2, 1000, 2000],
    [3, 0.1, 0.3],
    [2, 1000.25, 2000.5],
  ])("previews %i × %s as %s", (rollsSold, unitPricePerRoll, amount) => {
    expect(previewAmount({ ...row, rollsSold, unitPricePerRoll })).toBe(amount);
    expect(saleLineAmount(rollsSold, unitPricePerRoll)).toBe(amount);
  });
  it("ignores Meter for price and sums different repeated-row prices exactly", () => {
    expect(previewAmount({ ...row, meterSold: 1050 })).toBe(1000);
    expect(
      previewSubtotal([
        { ...row, unitPricePerRoll: 0.1 },
        { ...row, unitPricePerRoll: 0.2 },
      ]),
    ).toBe(0.3);
  });
  it.each([0, -1, 1.001, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid unit price %s",
    (unitPricePerRoll) => {
      expect(
        newSaleSchema.safeParse({
          ...draft,
          items: [{ productId: "p1", colors: [{ ...row, unitPricePerRoll }] }],
        }).success,
      ).toBe(false);
      expect(previewAmount({ ...row, unitPricePerRoll })).toBe(0);
    },
  );
  it("validates Meter precision without changing optional-zero behavior", () => {
    expect(
      newSaleSchema.safeParse({
        ...draft,
        items: [{ productId: "p1", colors: [{ ...row, meterSold: 0.001 }] }],
      }).success,
    ).toBe(false);
    expect(
      newSaleSchema.safeParse({
        ...draft,
        items: [{ productId: "p1", colors: [{ ...row, meterSold: 0 }] }],
      }).success,
    ).toBe(true);
  });
  it("parses decimal keyboard entry and rejects non-decimal notation", () => {
    expect(saleInputNumber("1000.25")).toBe(1000.25);
    expect(saleInputNumber("")).toBe(0);
    expect(saleInputNumber("0x10")).toBeNaN();
    expect(saleInputNumber("1e3")).toBeNaN();
  });
});

describe("Meter sale draft", () => {
  const meterStock = [{ ...stock[0], availableRolls: 0, availableMeter: 200 }];
  const meterRow = { variantId: "black", mode: "BY_METER" as const, rollsSold: 0, meterSold: 50, unitPricePerMeter: 120 };
  it("keeps Meter-only stock selectable and previews 50 Meter × 120", () => {
    expect(colorOptions(meterStock)[0].value).toBe("black");
    expect(previewAmount(meterRow)).toBe(6000);
    expect(remainingBeforeRow(meterStock[0], [meterRow])).toEqual({ rolls: 0, meter: 150, repeated: true });
    expect(newSaleSchema.safeParse({ ...draft, items: [{ productId: "p1", colors: [meterRow] }] }).success).toBe(true);
  });
  it("aggregates repeated Meter rows and mixed rows", () => {
    expect(stockErrors([meterRow, { ...meterRow, meterSold: 151 }], meterStock).get("black")?.meter).toContain("Only 200 Meter");
    expect(previewSubtotal([row, meterRow])).toBe(7000);
    expect(stockErrors([row, meterRow], stock).size).toBe(0);
  });
  it("rejects zero Meter and fractional Rolls", () => {
    for (const change of [{ meterSold: 0 }, { rollsSold: 0.5 }, { unitPricePerMeter: 1.001 }]) {
      expect(newSaleSchema.safeParse({ ...draft, items: [{ productId: "p1", colors: [{ ...meterRow, ...change }] }] }).success).toBe(false);
    }
  });
});
