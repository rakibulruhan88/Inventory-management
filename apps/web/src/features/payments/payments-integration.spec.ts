import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { CustomerAccount, PaymentReceipt } from "@afia/contracts";
import { CustomerDetailPage } from "@/features/records/customer-account-page";
import { PaymentReceiptPage } from "@/features/records/payment-receipt-page";
import {
  OutstandingCustomerLedger,
  RecentReceiptLedger,
} from "./payments-ledgers";
const receipt: PaymentReceipt = {
  id: "r1",
  receiptNumber: "PAY-20261007-000001",
  customerId: "c1",
  customerName: "Rahim Traders",
  customerPhone: "01711111111",
  totalAmount: 6000,
  method: "CASH",
  reference: null,
  notes: null,
  paidAt: "2026-10-07T06:00:00Z",
  createdAt: "2026-10-07T06:00:00Z",
  outstandingBefore: 8000,
  outstandingAfter: 2000,
  allocations: [
    {
      saleId: "s1",
      invoiceNumber: "AF-1001",
      soldAt: "2026-10-01",
      amount: 5000,
      previousDue: 5000,
      remainingDue: 0,
    },
    {
      saleId: "s2",
      invoiceNumber: "AF-1002",
      soldAt: "2026-10-02",
      amount: 1000,
      previousDue: 3000,
      remainingDue: 2000,
    },
  ],
};
function account(totalDue = 2000): CustomerAccount {
  return {
    id: "c1",
    name: receipt.customerName,
    phone: receipt.customerPhone,
    email: null,
    address: null,
    totalSales: 8000,
    totalPaid: 8000 - totalDue,
    totalDue,
    sales: { items: [], page: 1, pageSize: 25, total: 0 },
    outstandingInvoices: { items: [], page: 1, pageSize: 25, total: 0 },
    payments: {
      page: 1,
      pageSize: 25,
      total: 2,
      items: [
        {
          id: receipt.id,
          receiptId: receipt.id,
          receiptNumber: receipt.receiptNumber,
          receivedAt: receipt.paidAt,
          amount: receipt.totalAmount,
          method: receipt.method,
          reference: null,
          notes: null,
          saleId: null,
          invoiceNumber: null,
          allocations: receipt.allocations,
        },
        {
          id: "legacy",
          receivedAt: "2026-10-01",
          amount: 100,
          method: "BANK",
          reference: null,
          notes: null,
          saleId: "old",
          invoiceNumber: "OLD-1",
        },
      ],
    },
  };
}
function page(
  path: string,
  pattern: string,
  element: ReturnType<typeof createElement>,
  key: unknown[],
  data: unknown,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(key, data);
  const result = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        MemoryRouter,
        { initialEntries: [path] },
        createElement(
          Routes,
          null,
          createElement(Route, { path: pattern, element }),
        ),
      ),
    ),
  );
  client.clear();
  return result;
}
const ledger = (element: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, element));
describe("Payments and Customer Account UI route integration without browser automation", () => {
  it("routes an outstanding row to the existing payment flow and account on desktop/mobile", () => {
    const html = ledger(
      createElement(OutstandingCustomerLedger, {
        rows: [
          {
            id: "c1",
            name: "Rahim Traders",
            phone: "01711111111",
            totalDue: 2000,
            oldestDueInvoice: {
              id: "s2",
              invoiceNumber: "AF-1002",
              sourceKind: "SALE",
              soldAt: "2026-10-02",
            },
            lastSoldAt: "2026-10-02",
          },
        ],
      }),
    );
    expect(html.match(/href="\/customers\/c1\/receive-payment"/g)).toHaveLength(
      2,
    );
    expect(html).toContain('href="/customers/c1"');
    expect(html).toContain('href="/sales/s2/invoice"');
    expect(html).toContain("৳2,000.00");
  });
  it("renders a multi-invoice receipt once per responsive view rather than flattening allocations", () => {
    const html = ledger(
      createElement(RecentReceiptLedger, { rows: [receipt] }),
    );
    expect(html.match(/href="\/customers\/c1\/receipts\/r1"/g)).toHaveLength(2);
    expect(html).toContain("৳6,000");
    expect(html).not.toContain("AF-1001");
    expect(html).toContain('href="/customers/c1"');
  });
  it("keeps Customer Account payment action and receipt-oriented legacy history", () => {
    const html = page(
      "/customers/c1?tab=payments",
      "/customers/:id",
      createElement(CustomerDetailPage),
      ["customers", "account", "c1", 1],
      account(),
    );
    expect(html).toContain('href="/customers/c1/receive-payment"');
    expect(html.match(/href="\/customers\/c1\/receipts\/r1"/g)).toHaveLength(2);
    expect(html).toContain("Earlier Payment");
    expect(html).toContain("AF-1001");
    expect(html).toContain("AF-1002");
  });
  it("disables receiving payment from a settled account", () => {
    const html = page(
      "/customers/c1",
      "/customers/:id",
      createElement(CustomerDetailPage),
      ["customers", "account", "c1", 1],
      account(0),
    );
    expect(html).toContain("No due to pay");
    expect(html).not.toContain('href="/customers/c1/receive-payment"');
  });
  it("connects Receipt Detail to Payments, customer account and both allocated invoices", () => {
    const html = page(
      "/customers/c1/receipts/r1",
      "/customers/:id/receipts/:receiptId",
      createElement(PaymentReceiptPage),
      ["customers", "receipt", "c1", "r1"],
      receipt,
    );
    expect(html).toContain('href="/payments?view=receipts"');
    expect(html).toContain('href="/customers/c1"');
    expect(html).toContain('href="/sales/s1/invoice"');
    expect(html).toContain('href="/sales/s2/invoice"');
    expect(html).toContain("৳6,000");
  });
});
describe("Opening Due UI integration", () => {
  const old = {
    id: "o1",
    originalAmount: 5000,
    paidAmount: 1000,
    remainingDue: 4000,
    balanceAsOf: "2026-01-01",
    note: "Before this system",
    createdAt: "2026-10-07",
  };
  it("renders an opening-only due customer without inventing a sale link", () => {
    const html = ledger(
      createElement(OutstandingCustomerLedger, {
        rows: [
          {
            id: "c1",
            name: "Karim",
            phone: null,
            totalDue: 4000,
            oldestDueInvoice: {
              id: "o1",
              invoiceNumber: null,
              sourceKind: "OPENING",
              soldAt: "2026-01-01",
            },
            lastSoldAt: null,
          },
        ],
      }),
    );
    expect(html).toContain("Opening Due");
    expect(html).toContain('href="/customers/c1/receive-payment"');
    expect(html).not.toContain("/sales/o1");
  });
  it("shows the opening event and separate sales, received money and total due", () => {
    const html = page(
      "/customers/c1",
      "/customers/:id",
      createElement(CustomerDetailPage),
      ["customers", "account", "c1", 1],
      { ...account(4000), totalSales: 0, totalPaid: 1000, openingDue: old },
    );
    expect(html).toContain("Account History");
    expect(html).toContain("Opening Due");
    expect(html).toContain("Payments Received");
    expect(html).toContain("Total Due");
    expect(html).not.toContain("Add Old Due");
  });
  it("receipt labels both paid sources with simple wording and no fake opening invoice", () => {
    const mixed = {
      ...receipt,
      allocations: [
        {
          saleId: null,
          openingBalanceId: "o1",
          sourceKind: "OPENING" as const,
          invoiceNumber: null,
          soldAt: "2026-01-01",
          amount: 5000,
          previousDue: 5000,
          remainingDue: 0,
        },
        receipt.allocations[1],
      ],
    };
    const html = page(
      "/customers/c1/receipts/r1",
      "/customers/:id/receipts/:receiptId",
      createElement(PaymentReceiptPage),
      ["customers", "receipt", "c1", "r1"],
      mixed,
    );
    expect(html).toContain("Paid Against");
    expect(html).toContain("Opening Due");
    expect(html).toContain("/sales/s2/invoice");
    expect(html).not.toContain("/sales/null");
    expect(html).not.toMatch(/Allocations|Outstanding|Receivable|Settlement/);
  });
});
