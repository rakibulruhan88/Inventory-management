import { describe, expect, it } from "vitest";
import type { PaymentContext } from "@afia/contracts";
import { moneyCents, previewAllocation } from "./payment-allocation";
const context: PaymentContext = {
  customerId: "c1",
  customerName: "Sattar",
  customerPhone: null,
  outstanding: 8000,
  invoices: [
    {
      id: "a",
      invoiceNumber: "AF-1",
      customerName: "Sattar",
      soldAt: "2026-10-01",
      status: "COMPLETED",
      totalAmount: 10000,
      paidAmount: 5000,
      dueAmount: 5000,
    },
    {
      id: "b",
      invoiceNumber: "AF-2",
      customerName: "Sattar",
      soldAt: "2026-10-02",
      status: "COMPLETED",
      totalAmount: 3000,
      paidAmount: 0,
      dueAmount: 3000,
    },
  ],
};
describe("payment allocation preview", () => {
  it("previews the partial final invoice in backend order", () => {
    expect(
      previewAllocation(context, 600000, "AUTO", {}).map((r) => r.cents),
    ).toEqual([500000, 100000]);
  });
  it("supports manual allocation and zero on an unselected invoice", () => {
    expect(
      previewAllocation(context, 200000, "MANUAL", { b: "2000" }).map(
        (r) => r.cents,
      ),
    ).toEqual([0, 200000]);
  });
  it("flags manual over-allocation and invalid decimal input", () => {
    expect(
      previewAllocation(context, 100000, "MANUAL", {
        a: "5001",
        b: "1.001",
      }).every((r) => !r.valid),
    ).toBe(true);
  });
  it("keeps decimal cents exact", () => {
    expect(moneyCents("0.29")).toBe(29);
    expect(moneyCents("6000.01")).toBe(600001);
  });
  it.each(["", "-1", "NaN", "Infinity", "1.001", "1e3", "9999999999999"])(
    "rejects unsupported amount %s",
    (value) => expect(moneyCents(value)).toBeNull(),
  );
});
describe("Opening Due preview", () => {
  const mixed: PaymentContext = {
    ...context,
    sources: [
      {
        id: "opening",
        sourceKind: "OPENING",
        saleId: null,
        openingBalanceId: "opening",
        invoiceNumber: null,
        soldAt: "2026-01-01",
        totalAmount: 5000,
        paidAmount: 0,
        dueAmount: 5000,
      },
      {
        id: "sale",
        sourceKind: "SALE",
        saleId: "sale",
        openingBalanceId: null,
        invoiceNumber: "AF-1",
        soldAt: "2026-10-01",
        totalAmount: 3000,
        paidAmount: 0,
        dueAmount: 3000,
      },
    ],
  };
  it("uses actual due sources instead of the compatibility invoices list", () => {
    const rows = previewAllocation(mixed, 600000, "AUTO", {});
    expect(rows.map((r) => r.cents)).toEqual([500000, 100000]);
    expect(rows[0].invoice.invoiceNumber).toBeNull();
    expect(rows[0].invoice.sourceKind).toBe("OPENING");
  });
  it("lets Choose Invoices skip Opening Due", () => {
    expect(
      previewAllocation(mixed, 200000, "MANUAL", { sale: "2000" }).map(
        (r) => r.cents,
      ),
    ).toEqual([0, 200000]);
  });
  it("flags overpaying Opening Due", () => {
    expect(
      previewAllocation(mixed, 600000, "MANUAL", { opening: "6000" })[0].valid,
    ).toBe(false);
  });
});
