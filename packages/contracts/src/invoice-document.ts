import type { SaleInvoice } from "./index.js";

// Received and change are creation-time fields. paidAmount/dueAmount include later payments.
// Never reconstruct missing customer snapshots from today's account or payment rows.
export function invoiceAmounts(invoice: SaleInvoice) {
  const paidAtSale =
    Math.round((invoice.receivedAmount - invoice.changeAmount) * 100) / 100;
  return {
    paidAtSale,
    dueAtSale: Math.round((invoice.totalAmount - paidAtSale) * 100) / 100,
    previousDue: invoice.previousOutstandingBeforeSale ?? null,
    totalDueAfterSale: invoice.outstandingAfterSale ?? null,
    laterPaid: Math.round((invoice.paidAmount - paidAtSale) * 100) / 100,
  };
}

/** The same rows are rendered on screen, in downloaded PDFs and email attachments. */
export function invoiceSummaryRows(invoice: SaleInvoice) {
  const amounts = invoiceAmounts(invoice);
  const rows: { label: string; value: number; strong?: boolean }[] = [
    { label: "Subtotal", value: invoice.subtotal },
    { label: "Discount", value: invoice.discountAmount },
    { label: "Invoice Total", value: invoice.totalAmount, strong: true },
    { label: "Received at Sale", value: invoice.receivedAmount },
    { label: "Paid at Sale", value: amounts.paidAtSale },
  ];
  if (amounts.laterPaid > 0)
    rows.push({ label: "Later Payments", value: amounts.laterPaid });
  rows.push(
    { label: "Paid", value: invoice.paidAmount },
    { label: "Invoice Due", value: invoice.dueAmount, strong: true },
  );
  if (invoice.changeAmount > 0)
    rows.push({ label: "Change Returned", value: invoice.changeAmount });
  return rows;
}
