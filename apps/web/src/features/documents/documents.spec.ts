/// <reference types="node" />
import { readFileSync } from "node:fs";
import invoiceSource from "../sales/sale-invoice-page.tsx?raw";
import receiptSource from "../records/payment-receipt-page.tsx?raw";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { PaymentReceipt, SaleInvoice } from "@afia/contracts";
import { InvoicePayments, InvoiceSheet } from "../sales/sale-invoice-page";
import { ReceiptSheet } from "../records/payment-receipt-page";
import { documentMoney, invoiceAmounts, paymentMethod } from "./document-data";

const invoice: SaleInvoice = {
  id: "sale1", invoiceNumber: "AF-1001", customerId: "c1", soldAt: "2026-10-07T00:00:00Z", status: "COMPLETED",
  voidedAt: null, voidReason: null, currentCustomerEmail: null, lastEmailedAt: null, notes: null,
  customer: { name: "Shop Customer", phone: "01712345678", email: null, address: null },
  previousOutstandingBeforeSale: 10000, outstandingAfterSale: 20000,
  subtotal: 15000, discountAmount: 0, totalAmount: 15000, receivedAmount: 5000, changeAmount: 0, paidAmount: 7000, dueAmount: 8000,
  lines: [
    { id: "l1", itemCode: "F1212", itemName: null, description: '1.2mm*54"*36.5m', color: "F07124#Beige", rollsSold: 2, meterSold: 70, unitPricePerRoll: 4500, lineTotal: 9000 },
    { id: "l2", itemCode: "F1212", itemName: null, description: '1.2mm*54"*36.5m', color: "F07124#Beige", rollsSold: 1, meterSold: null, unitPricePerRoll: 6000, lineTotal: 6000 },
  ],
  payments: [{ id: "p1", receiptId: "receipt1", receiptNumber: "PAY-001", receivedAt: "2026-10-08T00:00:00Z", amount: 2000, method: "CASH", reference: null, notes: null, saleId: "sale1", invoiceNumber: "AF-1001" }],
  settings: { storeName: "Afia Leather", logoUrl: null, faviconUrl: null, storePhone: null, storeEmail: null, storeAddress: null, currency: "BDT", currencySymbol: "৳", invoicePrefix: "AF", defaultPaymentMethod: "CASH", lowStockRollThreshold: 1, lowStockMeterThreshold: 1, brandAccent: "#895332" },
};
const receipt: PaymentReceipt = {
  id: "receipt1", receiptNumber: "PAY-001", customerId: "c1", customerName: "Shop Customer", customerPhone: null,
  paidAt: "2026-10-08T00:00:00Z", createdAt: "2026-10-08T00:00:00Z", totalAmount: 6000, method: "MOBILE_BANKING", reference: null, notes: null,
  outstandingBefore: 28000, outstandingAfter: 22000,
  allocations: [
    { openingBalanceId: "opening1", saleId: null, invoiceNumber: null, sourceKind: "OPENING", soldAt: "2026-10-01", previousDue: 10000, amount: 3000, remainingDue: 7000 },
    { saleId: "sale1", invoiceNumber: "AF-1001", soldAt: "2026-10-07", previousDue: 8000, amount: 2000, remainingDue: 6000 },
    { saleId: "sale2", invoiceNumber: "AF-1002", soldAt: "2026-10-07", previousDue: 10000, amount: 1000, remainingDue: 9000 },
  ],
};
const invoiceHtml = (value = invoice) => renderToStaticMarkup(createElement(InvoiceSheet, { invoice: value }));
const receiptHtml = (value = receipt) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ReceiptSheet, { receipt: value, settings: invoice.settings })));
function amount(html: string, label: string, value: number | null) {
  expect(html).toContain(`<dt>${label}</dt><dd>${documentMoney(value)}</dd>`);
}

describe("Invoice presentation", () => {
  it("keeps previous due, including recorded opening due, separate from invoice total", () => {
    const html = invoiceHtml();
    amount(html, "Previous Due", 10000); amount(html, "Invoice Total", 15000);
    amount(html, "This Invoice Due", 10000); amount(html, "Total Due After Sale", 20000);
    expect(html).not.toContain("৳25,000");
  });
  it("preserves sale-time values when later payments change current due", () => {
    const html = invoiceHtml({ ...invoice, paidAmount: 13000, dueAmount: 2000 });
    amount(html, "Paid at Sale", 5000); amount(html, "Later Payments", 8000);
    amount(html, "Invoice Due", 2000); amount(html, "Total Due After Sale", 20000);
    amount(html, "Previous Due", 10000);
  });
  it("uses received less returned change, rather than mutable paid total", () => {
    expect(invoiceAmounts({ ...invoice, receivedAmount: 16000, changeAmount: 1000, paidAmount: 15000 }).paidAtSale).toBe(15000);
  });
  it("keeps legacy null snapshots and unit prices readable without guessing", () => {
    const html = invoiceHtml({ ...invoice, previousOutstandingBeforeSale: null, outstandingAfterSale: null, lines: [{ ...invoice.lines[0], unitPricePerRoll: null }] });
    amount(html, "Previous Due", null); amount(html, "Total Due After Sale", null);
    expect(html).toContain('data-label="Unit Price / Roll">—');
    amount(html, "Invoice Total", 15000);
  });
  it("preserves repeated supplier colors, rolls, optional meter, stored price and amount", () => {
    const html = invoiceHtml();
    expect(html.match(/class="invoice-row"/g)).toHaveLength(2);
    expect(html.match(/F07124#Beige/g)).toHaveLength(2);
    expect(html).toContain('data-label="Rolls">2'); expect(html).toContain('data-label="Meter">70');
    expect(html).toContain('data-label="Meter">—'); expect(html).toContain('data-label="Unit Price / Roll">৳4,500');
    expect(html).toContain('data-label="Amount"><strong>৳9,000');
  });
  it("links an applied payment to the same receipt from each invoice", () => {
    for (const saleId of ["sale1", "sale2"]) {
      const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(InvoicePayments, { invoice: { ...invoice, id: saleId } })));
      expect(html).toContain('href="/customers/c1/receipts/receipt1"'); expect(html).toContain("PAY-001");
    }
  });
});
describe("Receipt presentation", () => {
  it.each(["opening", "sale", "mixed"])("prints one receipt for %s sources using stored snapshots", kind => {
    const allocations = kind === "opening" ? receipt.allocations.slice(0, 1) : kind === "sale" ? receipt.allocations.slice(1) : receipt.allocations;
    const html = receiptHtml({ ...receipt, allocations });
    expect(html.match(/<article/g)).toHaveLength(1);
    expect(html).toContain("Paid Against");
    amount(html, "Total Due Before", 28000); amount(html, "Total Paid", 6000); amount(html, "Due After Payment", 22000);
    for (const a of allocations) {
      expect(html).toContain(a.saleId ? `href="/sales/${a.saleId}/invoice"` : "Opening Due");
      expect(html).toContain(documentMoney(a.previousDue)); expect(html).toContain(documentMoney(a.remainingDue));
    }
    for (const label of ["Due Before", "Paid Now", "Due Left"]) expect(html).toContain(label);
    for (const label of ["Allocation", "Receivable", "Settlement"]) expect(html).not.toContain(label);
    expect(html).not.toContain("Reference:");
  });
  it("omits unavailable legacy historical receipt values rather than summing rows", () => {
    const html = receiptHtml({ ...receipt, outstandingBefore: null, outstandingAfter: null } as unknown as PaymentReceipt);
    amount(html, "Total Due Before", null); amount(html, "Due After Payment", null);
  });
  it("uses simple payment method names", () => {
    expect(paymentMethod("MOBILE_BANKING")).toBe("Mobile Banking"); expect(paymentMethod("BANK")).toBe("Bank");
  });
});
describe("Print and mobile structure", () => {
  it("shares the document, repeats table headers, avoids split rows, excludes navigation and actions", () => {
    const css = readFileSync(new URL("./documents.css", import.meta.url), "utf8");
    expect(css).toContain("size: A4 portrait; margin: 12mm");
    expect(css).toContain(".app-chrome, .invoice-actions { display: none !important; }");
    expect(css).toContain("display: table-header-group"); expect(css).toContain("break-inside: avoid");
    expect(css).toContain("@media screen and (max-width: 767px)"); expect(css).toContain('content: attr(data-label)');
    expect(invoiceHtml()).not.toContain("<button"); expect(receiptHtml()).not.toContain("<button");
    const source = invoiceSource;
    expect(source).toContain("contentRef: printable"); expect(source).toContain("Print Invoice");
    expect(receiptSource).toContain("Print Receipt");
  });
});

it("prints Meter mode, amount and price basis", () => {
  const html = invoiceHtml({ ...invoice, lines: [{ ...invoice.lines[0], mode: "BY_METER", rollsSold: 0, meterSold: 50, unitPricePerRoll: null, unitPricePerMeter: 120, lineTotal: 6000 }] });
  expect(html).toContain("Sell By: Meter");
  expect(html).toContain('data-label="Unit Price / Meter">৳120');
  expect(html).toContain("50 Meter × ৳120 = ৳6,000");
});
