import type { SaleInvoice } from "@afia/contracts";

export const paymentMethod = (method: string) => ({
  CASH: "Cash", BANK: "Bank", MOBILE_BANKING: "Mobile Banking", OTHER: "Other",
}[method] ?? method.replaceAll("_", " "));

export const documentMoney = (value: number | null | undefined, symbol = "৳") =>
  value == null ? "—" : `${symbol}${value.toLocaleString("en-BD", { minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

// Received and change are creation-time fields. paidAmount/dueAmount include later payments.
// Never reconstruct missing customer snapshots from today's account or payment rows.
export function invoiceAmounts(invoice: SaleInvoice) {
  const paidAtSale = Math.round((invoice.receivedAmount - invoice.changeAmount) * 100) / 100;
  return {
    paidAtSale,
    dueAtSale: Math.round((invoice.totalAmount - paidAtSale) * 100) / 100,
    previousDue: invoice.previousOutstandingBeforeSale ?? null,
    totalDueAfterSale: invoice.outstandingAfterSale ?? null,
    laterPaid: Math.round((invoice.paidAmount - paidAtSale) * 100) / 100,
  };
}
