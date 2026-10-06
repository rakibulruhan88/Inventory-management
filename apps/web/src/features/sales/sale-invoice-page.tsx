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
import type { SaleInvoice } from "@afia/contracts";
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

function money(invoice: SaleInvoice, value: number) {
  return `${invoice.settings.currencySymbol}${value.toLocaleString("en-BD", { minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

function InvoiceSheet({ invoice }: { invoice: SaleInvoice }) {
  const settings = invoice.settings;
  const mark = settings.logoUrl || settings.faviconUrl;
  return (
    <article className="invoice-sheet mx-auto min-h-[297mm] w-full max-w-[210mm] bg-white p-6 shadow-sm sm:p-10 lg:p-14">
      <header className="flex flex-col justify-between gap-8 border-b border-[var(--border)] pb-8 sm:flex-row">
        <div className="flex gap-4">
          {mark ? (
            <img
              src={mark}
              alt={`${settings.storeName} logo`}
              className="size-20 object-contain sm:size-30"
            />
          ) : (
            <div className="grid size-16 place-items-center rounded-xl bg-[var(--primary)] text-2xl font-bold text-white sm:size-20">
              {settings.storeName[0]}
            </div>
          )}
          <div>
            {/* <h1 className="text-2xl font-semibold">{settings.storeName}</h1> */}
            <div className="mt-2 space-y-0.5 text-sm text-[var(--muted)]">
              {settings.storeAddress && <p>{settings.storeAddress}</p>}
              {settings.storePhone && <p>{settings.storePhone}</p>}
              {settings.storeEmail && <p>{settings.storeEmail}</p>}
            </div>
          </div>
        </div>
        <div className="sm:text-right">
          <p className="text-3xl font-bold tracking-wide text-[var(--primary-strong)]">
            INVOICE
          </p>
          <p className="mt-2 font-semibold">{invoice.invoiceNumber}</p>
          <p className="text-sm text-[var(--muted)]">
            {format(new Date(invoice.soldAt), "dd MMMM yyyy")}
          </p>
          {invoice.status === "VOIDED" && (
            <span className="mt-3 inline-block rounded-lg bg-[var(--danger-soft)] px-4 py-2 font-bold text-[var(--danger)]">
              VOID
            </span>
          )}
        </div>
      </header>
      <section className="mt-8 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-5">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
          Bill To
        </p>
        <h2 className="mt-2 text-lg font-semibold">{invoice.customer.name}</h2>
        {invoice.customer.phone && (
          <p className="mt-1 text-sm text-[var(--muted)]">
            {invoice.customer.phone}
          </p>
        )}
        {invoice.customer.email && (
          <p className="text-sm text-[var(--muted)]">
            {invoice.customer.email}
          </p>
        )}
        {invoice.customer.address && (
          <p className="text-sm text-[var(--muted)]">
            {invoice.customer.address}
          </p>
        )}
      </section>
      <div className="mt-8 overflow-hidden rounded-xl border border-[var(--border)]">
        <div className="grid grid-cols-[minmax(0,2fr)_1fr_.55fr_.7fr_1fr] gap-2 bg-[var(--ink)] px-4 py-3 text-xs font-semibold text-white">
          <span>Item</span>
          <span>Color</span>
          <span className="text-right">Rolls</span>
          <span className="text-right">Meter</span>
          <span className="text-right">Amount</span>
        </div>
        {invoice.lines.map((line) => (
          <div
            key={line.id}
            className="invoice-row grid grid-cols-[minmax(0,2fr)_1fr_.55fr_.7fr_1fr] gap-2 border-b border-[var(--border)] px-4 py-4 text-sm last:border-0"
          >
            <div>
              <strong>{line.itemCode}</strong>
              {(line.description || line.itemName) && (
                <p className="mt-0.5 text-xs text-[var(--muted)]">
                  {line.description || line.itemName}
                </p>
              )}
            </div>
            <div className="flex items-start gap-2">
              {line.color}
            </div>
            <span className="text-right font-medium">{line.rollsSold}</span>
            <span className="text-right">
              {line.meterSold?.toLocaleString() ?? "—"}
            </span>
            <strong className="text-right">
              {money(invoice, line.lineTotal)}
            </strong>
          </div>
        ))}
      </div>
      <div className="invoice-totals mt-8 flex justify-end">
        <div className="w-full max-w-sm space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-[var(--muted)]">Subtotal</span>
            <span>{money(invoice, invoice.subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--muted)]">Discount</span>
            <span>{money(invoice, invoice.discountAmount)}</span>
          </div>
          <div className="flex justify-between border-y border-[var(--primary)] py-3 text-lg font-semibold text-[var(--primary-strong)]">
            <span>Grand Total</span>
            <span>{money(invoice, invoice.totalAmount)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--muted)]">Received at Sale</span>
            <span>{money(invoice, invoice.receivedAmount)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--muted)]">Total Paid</span>
            <span>{money(invoice, invoice.paidAmount)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--muted)]">Due</span>
            <strong className="text-[var(--warning)]">
              {money(invoice, invoice.dueAmount)}
            </strong>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--muted)]">Change Returned</span>
            <span>{money(invoice, invoice.changeAmount)}</span>
          </div>
        </div>
      </div>
      {invoice.notes && (
        <section className="mt-8 rounded-xl bg-[var(--surface-subtle)] p-4 text-sm">
          <strong>Notes</strong>
          <p className="mt-1 text-[var(--muted)]">{invoice.notes}</p>
        </section>
      )}
      {invoice.payments.length > 0 && (
        <section className="mt-8 rounded-xl bg-[var(--surface-subtle)] p-4 text-sm">
          <strong>Payment History</strong>
          <div className="mt-2 space-y-1">
            {invoice.payments.map((payment) => (
              <div className="flex justify-between" key={payment.id}>
                <span className="text-[var(--muted)]">
                  {format(new Date(payment.receivedAt), "dd MMM yyyy")} ·{" "}
                  {payment.method.replace("_", " ")}
                </span>
                <span>{money(invoice, payment.amount)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {invoice.status === "VOIDED" && (
        <section className="mt-8 rounded-xl border border-red-200 bg-[var(--danger-soft)] p-4 text-sm text-[var(--danger)]">
          <strong>This invoice is void.</strong>
          <p className="mt-1">{invoice.voidReason}</p>
        </section>
      )}
      <footer className="mt-16 border-t border-[var(--border)] pt-5 text-center text-sm text-[var(--muted)]">
        <p>Thank you for your business.</p>
        <p className="mt-1">
          {[settings.storeName, settings.storePhone, settings.storeEmail]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </footer>
    </article>
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
      <div className="grid min-h-80 place-items-center">
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
            <Button
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
            </Button>
          ) : (
            <Button asChild variant="outline">
              <Link
                to={`/customers?search=${encodeURIComponent(invoice.customer.name)}`}
              >
                Add customer email
              </Link>
            </Button>
          )}
          {invoice.status === "COMPLETED" && (
            <Button
              variant="outline"
              className="text-[var(--danger)]"
              onClick={() => setVoidOpen(true)}
            >
              <Ban className="size-4" /> Void Sale
            </Button>
          )}
          <Button variant="outline" onClick={() => print()}>
            <Printer className="size-4" /> Print
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
      <div ref={printable}>
        <InvoiceSheet invoice={invoice} />
      </div>
      <Drawer.Root open={voidOpen} onOpenChange={setVoidOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-[2px]" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-[var(--border)] bg-white p-5 shadow-[var(--shadow-float)]">
            <div className="mx-auto max-w-lg">
              <Drawer.Title className="text-lg font-semibold">
                Void Invoice {invoice.invoiceNumber}?
              </Drawer.Title>
              <Drawer.Description className="mt-2 text-sm text-[var(--muted)]">
                This restores the sold stock, reverses invoice payments, and
                keeps a permanent audit record.
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
