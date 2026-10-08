import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import type { FinanceEntryDetail } from "@afia/contracts";
import { FinanceDocument } from "./finance-detail-page";
import { cashMoney } from "./financial-summary";
const base: FinanceEntryDetail = {
  id: "entry-actual-id",
  type: "EXPENSE",
  direction: "OUT",
  amount: "2000.00",
  method: "CASH",
  occurredAt: "2026-10-08T06:00:00Z",
  expenseType: "Transport",
  reference: "TR-100",
  note: "Delivery cost",
  createdBy: "owner",
  creatorName: "Shop Owner",
  createdAt: "2026-10-08T06:00:00Z",
  supplierName: null,
  purchaseNumber: null,
  containerNumber: null,
  voidedAt: null,
  voidReason: null,
  voiderName: null,
};
describe("Money documents", () => {
  it.each([
    ["OTHER_IN", "Money In Receipt", "IN"],
    ["EXPENSE", "Expense Voucher", "OUT"],
    ["SUPPLIER_PAYMENT", "Supplier Payment", "OUT"],
    ["OTHER_OUT", "Payment Voucher", "OUT"],
  ] as const)(
    "%s has its own document and correct direction",
    (type, title, direction) => {
      const html = renderToStaticMarkup(
        createElement(FinanceDocument, {
          entry: {
            ...base,
            type,
            direction,
            expenseType: type === "EXPENSE" ? "Transport" : undefined,
            supplierName:
              type === "SUPPLIER_PAYMENT" ? "Leather Supplier" : null,
          },
        }),
      );
      expect(html).toContain(title);
      expect(html).toContain(
        direction === "IN" ? "Money Received" : "Money Paid",
      );
      expect(html).toContain("৳2,000.00");
      expect(html).toContain("entry-actual-id");
      expect(html).not.toContain("Invoice No");
    },
  );
  it("preserves void status, note, supplier and relational document references", () => {
    const html = renderToStaticMarkup(
      createElement(FinanceDocument, {
        entry: {
          ...base,
          type: "SUPPLIER_PAYMENT",
          supplierName: "Leather Supplier",
          purchaseNumber: "PUR-100",
          containerNumber: "CON-100",
          voidedAt: "2026-10-08",
          voidReason: "Wrong amount",
        },
      }),
    );
    for (const label of [
      "VOIDED",
      "Wrong amount",
      "Leather Supplier",
      "PUR-100",
      "CON-100",
      "TR-100",
      "Delivery cost",
    ])
      expect(html).toContain(label);
  });
  it("prints user text safely without HTML injection", () => {
    const html = renderToStaticMarkup(
      createElement(FinanceDocument, {
        entry: { ...base, note: "<script>bad()</script>" },
      }),
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
  it("formats cents and large aggregate values without float rounding or lost negative sign", () => {
    expect(cashMoney("-0.50")).toBe("৳-0.50");
    expect(cashMoney("9007199254740993.01")).toBe("৳9,007,199,254,740,993.01");
  });
});
