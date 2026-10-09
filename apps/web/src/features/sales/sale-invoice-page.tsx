import { Permit } from "@/features/auth/permit";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ArrowLeft,
  Ban,
  Download,
  LoaderCircle,
  Mail,
  Printer,
  ReceiptText,
} from "lucide-react";
import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useReactToPrint } from "react-to-print";
import { invoiceSummaryRows, type SaleInvoice } from "@afia/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  downloadSaleInvoicePdf,
  emailSaleInvoice,
  getSaleDetails,
  voidSale,
} from "@/lib/api";
import { toast } from "sonner";
import { Drawer } from "vaul";
import {
  AmountRow,
  DocumentCustomer,
  DocumentHeader,
  DocumentSignatures,
} from "@/features/documents/document-components";
import {
  documentMoney,
  invoiceAmounts,
  paymentMethod,
} from "@/features/documents/document-data";
import { formatLedgerDate } from "./ledger-components";

function money(invoice: SaleInvoice, value: number) {
  return `${invoice.settings.currencySymbol}${value.toLocaleString("en-BD", { minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

export function InvoiceSheet({ invoice }: { invoice: SaleInvoice }) {
  const amounts = invoiceAmounts(invoice);
  const ungrouped = invoice.payments.filter((p) => !p.receiptId);
  const salePayment =
    ungrouped.length === 1 && ungrouped[0].amount === amounts.paidAtSale
      ? ungrouped[0]
      : undefined;
  return (
    <article className="document-sheet invoice-sheet">
      <DocumentHeader
        settings={invoice.settings}
        title="Invoice"
        number={invoice.invoiceNumber}
        date={invoice.soldAt}
        creatorName={invoice.creatorName}
      />
      {invoice.status === "VOIDED" && (
        <p className="document-void">
          <strong>VOID · This invoice is void.</strong> {invoice.voidReason}
        </p>
      )}
      <DocumentCustomer {...invoice.customer} />
      <table className="document-table invoice-items">
        <caption className="sr-only">Invoice items</caption>
        <colgroup>
          <col style={{ width: "12%" }} />
          <col style={{ width: "22%" }} />
          <col style={{ width: "20%" }} />
          <col style={{ width: "7%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "15%" }} />
          <col style={{ width: "15%" }} />
        </colgroup>
        <thead>
          <tr>
            {[
              "Item",
              "Description / Size",
              "Color",
              "Rolls",
              "Meter",
              invoice.lines.some((line) => line.mode === "BY_METER") ? "Unit Price" : "Unit Price / Roll",
              "Amount",
            ].map((label, i) => (
              <th key={label} scope="col" className={i > 2 ? "number" : ""}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((line) => (
            <tr key={line.id} className="invoice-row">
              <td className="item-code">
                <strong>{line.itemCode}</strong>
                <span className="block text-xs">Sell By: {line.mode === "BY_METER" ? "Meter" : "Roll"}</span>
              </td>
              <td className="item-description">
                {line.description || line.itemName || "—"}
              </td>
              <td className="item-color">{line.color}</td>
              <td className="number item-rolls" data-label="Rolls">
                {line.rollsSold}
              </td>
              <td className="number item-meter" data-label="Meter">
                {line.meterSold?.toLocaleString("en-BD") ?? "—"}
              </td>
              <td className="number item-price" data-label={line.mode === "BY_METER" ? "Unit Price / Meter" : "Unit Price / Roll"}>
                {documentMoney(
                  line.mode === "BY_METER" ? line.unitPricePerMeter ?? null : line.unitPricePerRoll,
                  invoice.settings.currencySymbol,
                )}
              </td>
              <td className="number item-amount" data-label="Amount">
                <strong>{money(invoice, line.lineTotal)}</strong>
                {line.mode === "BY_METER" && line.unitPricePerMeter != null && (
                  <span className="block text-xs">{line.meterSold?.toLocaleString("en-BD")} Meter × {money(invoice, line.unitPricePerMeter)} = {money(invoice, line.lineTotal)}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!invoice.lines.length && (
        <p className="document-note">No items recorded.</p>
      )}
      <div className="document-summary">
        <section className="document-due">
          <h2>Customer Due</h2>
          <p className="document-caption">When this sale was made</p>
          <dl>
            <AmountRow label="Previous Due">
              {documentMoney(
                amounts.previousDue,
                invoice.settings.currencySymbol,
              )}
            </AmountRow>
            <AmountRow label="This Invoice Due">
              {money(invoice, amounts.dueAtSale)}
            </AmountRow>
            <AmountRow label="Total Due After Sale" strong>
              {documentMoney(
                amounts.totalDueAfterSale,
                invoice.settings.currencySymbol,
              )}
            </AmountRow>
          </dl>
          {(amounts.previousDue == null ||
            amounts.totalDueAfterSale == null) && (
            <p className="document-caption">
              Previous customer due was not saved for this invoice.
            </p>
          )}
        </section>
        <section className="invoice-totals">
          <h2>Current Sale</h2>
          <dl>
            {invoiceSummaryRows(invoice).map((row) => (
              <AmountRow key={row.label} label={row.label} strong={row.strong}>
                {money(invoice, row.value)}
              </AmountRow>
            ))}
          </dl>
          {salePayment && (
            <div className="document-payment">
              <p>Payment Method: {paymentMethod(salePayment.method)}</p>
              {salePayment.reference && (
                <p>Reference: {salePayment.reference}</p>
              )}
            </div>
          )}
        </section>
      </div>
      {invoice.notes && (
        <section className="document-note">
          <h2>Notes</h2>
          <p>{invoice.notes}</p>
        </section>
      )}
      <DocumentSignatures />
      <footer className="document-footer">Thank you for your business.</footer>
    </article>
  );
}

export function InvoicePayments({ invoice }: { invoice: SaleInvoice }) {
  return (
    <section
      className="invoice-actions mx-auto mt-5 max-w-[210mm] border-y border-[var(--border)] py-4 text-sm"
      aria-label="Payments"
    >
      <h2 className="font-semibold">Payments</h2>
      {invoice.payments.length ? (
        <ul className="mt-2 space-y-2">
          {invoice.payments.map((p) => (
            <li key={p.id} className="flex flex-wrap justify-between gap-2">
              <span>
                {formatLedgerDate(p.receivedAt)} ·{" "}
                {p.receiptId ? (
                  <Link
                    className="rounded-sm text-[var(--accent)] underline focus-visible:outline-2"
                    to={`/customers/${invoice.customerId}/receipts/${p.receiptId}`}
                  >
                    {p.receiptNumber || "Receipt"}
                  </Link>
                ) : (
                  "Payment"
                )}{" "}
                · {paymentMethod(p.method)}
              </span>
              <strong className="tabular-nums">
                {money(invoice, p.amount)}
              </strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[var(--muted)]">No payments recorded.</p>
      )}
      {invoice.payments.some((p) => p.receiptId) && (
        <p className="mt-3 text-xs text-[var(--muted)]">
          This invoice has payment receipts and cannot be voided.
        </p>
      )}
    </section>
  );
}

export function SaleInvoicePage() {
  const { id = "" } = useParams();
  const printable = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const [voidOpen, setVoidOpen] = useState(false);
  const [reason, setReason] = useState("");
  const query = useQuery({
    queryKey: ["sale", id],
    queryFn: () => getSaleDetails(id),
    enabled: !!id,
  });
  const print = useReactToPrint({
    contentRef: printable,
    documentTitle: query.data?.invoiceNumber ?? "Invoice",
  });
  const email = useMutation({
    mutationFn: () => emailSaleInvoice(id),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["sale", id] });
      toast.success(`Invoice sent to ${result.recipient}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const download = useMutation({
    mutationFn: () => downloadSaleInvoicePdf(id),
    onSuccess: ({ blob, filename }) => {
      const fallback = query.data
        ? `${query.data.settings.storeName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}-${query.data.invoiceNumber}.pdf`
        : "invoice.pdf";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename || fallback;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const voidMutation = useMutation({
    mutationFn: () => voidSale(id, { reason }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sale", id] }),
        queryClient.invalidateQueries({ queryKey: ["inventory"] }),
        queryClient.invalidateQueries({ queryKey: ["sales"] }),
        queryClient.invalidateQueries({ queryKey: ["customers"] }),
      ]);
      setVoidOpen(false);
      toast.success("Sale voided and stock restored");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  if (query.isLoading)
    return (
      <div role="status" className="grid min-h-80 place-items-center">
        <span className="sr-only">Loading invoice…</span>
        <LoaderCircle className="size-6 animate-spin text-[var(--accent)]" />
      </div>
    );
  if (!query.data)
    return (
      <div className="mx-auto max-w-lg p-8 text-center">
        <ReceiptText className="mx-auto size-8 text-[var(--accent)]" />
        <h1 className="mt-3 text-xl font-semibold">Invoice unavailable</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {query.error instanceof Error
            ? query.error.message
            : "This sale could not be found."}
        </p>
        <Button
          variant="outline"
          className="mt-5 mr-2"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          Try again
        </Button>
        <Button asChild variant="outline" className="mt-5">
          <Link to="/sales">Back to Sales</Link>
        </Button>
      </div>
    );
  const invoice = query.data;
  return (
    <div className="invoice-page px-4 pb-28 pt-5 md:px-7 lg:px-10">
      <div className="invoice-actions mx-auto mb-5 flex max-w-[210mm] flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost">
          <Link to="/sales">
            <ArrowLeft className="size-4" /> Sales
          </Link>
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to={`/customers/${invoice.customerId}`}>
              Customer account
            </Link>
          </Button>
          {invoice.currentCustomerEmail ? (
            <Permit permission="sales.email"><Button
              variant="outline"
              disabled={email.isPending}
              onClick={() => email.mutate()}
            >
              <Mail className="size-4" />{" "}
              {email.isPending
                ? "Sending…"
                : invoice.lastEmailedAt
                  ? "Resend Email"
                  : "Email Invoice"}
            </Button></Permit>
          ) : (
            <Permit permission="customers.manage"><Button asChild variant="outline">
              <Link
                to={`/customers?search=${encodeURIComponent(invoice.customer.name)}`}
              >
                Add customer email
              </Link>
            </Button></Permit>
          )}
          {invoice.status === "COMPLETED" && (
            <Permit permission="sales.void"><Button
              variant="outline"
              className="text-[var(--danger)]"
              disabled={invoice.payments.some((p) => p.receiptId)}
              onClick={() => setVoidOpen(true)}
            >
              <Ban className="size-4" /> Void Sale
            </Button></Permit>
          )}
          <Button variant="outline" onClick={() => print()}>
            <Printer className="size-4" /> Print Invoice
          </Button>
          <Button variant="outline" onClick={() => print()}>
            <Download className="size-4" /> Save as PDF
          </Button>
          <Button
            disabled={download.isPending}
            onClick={() => download.mutate()}
          >
            <Download className="size-4" />{" "}
            {download.isPending ? "Preparing…" : "Download PDF"}
          </Button>
        </div>
      </div>
      {invoice.lastEmailedAt && (
        <p className="invoice-actions mx-auto mb-3 max-w-[210mm] text-right text-xs text-[var(--muted)]">
          Last emailed:{" "}
          {format(new Date(invoice.lastEmailedAt), "d MMM yyyy, h:mm a")}
        </p>
      )}
      <p className="invoice-actions mx-auto mb-4 max-w-[210mm] text-xs text-[var(--muted)]">
        Save as PDF: choose “Save as PDF” in the print window. Download PDF and
        Email Invoice include the same sale details.
      </p>
      <div ref={printable}>
        <InvoiceSheet invoice={invoice} />
      </div>
      <InvoicePayments invoice={invoice} />
      <Drawer.Root open={voidOpen} onOpenChange={setVoidOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-[2px]" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-[var(--border)] bg-white p-5 shadow-[var(--shadow-float)]">
            <div className="mx-auto max-w-lg">
              <Drawer.Title className="text-lg font-semibold">
                Void Invoice {invoice.invoiceNumber}?
              </Drawer.Title>
              <Drawer.Description className="mt-2 text-sm text-[var(--muted)]">
                This returns the sold stock and cancels invoice payments. The
                sale stays in history.
              </Drawer.Description>
              <label className="mt-4 block text-sm font-medium">
                Cancellation Reason *
                <Input
                  className="mt-2"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <Button variant="outline" onClick={() => setVoidOpen(false)}>
                  Keep Sale
                </Button>
                <Button
                  variant="danger"
                  disabled={reason.trim().length < 2 || voidMutation.isPending}
                  onClick={() => voidMutation.mutate()}
                >
                  Void & Restore Stock
                </Button>
              </div>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  );
}
