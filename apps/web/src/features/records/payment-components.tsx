import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import type { PaymentContext, PaymentReceipt } from "@afia/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  formatLedgerDate,
  formatMoney,
  ledgerLink,
} from "@/features/sales/ledger-components";
import { previewAllocation } from "./payment-allocation";
export const paymentMethods = [
  ["CASH", "Cash"],
  ["BANK", "Bank"],
  ["MOBILE_BANKING", "Mobile Banking"],
  ["OTHER", "Other"],
] as const;
type AllocationRows = ReturnType<typeof previewAllocation>;

export function PaymentSuccess({
  receipt,
  onAnother,
}: {
  receipt: PaymentReceipt;
  onAnother: () => void;
}) {
  const id = receipt.customerId;
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-semibold" role="status">
        Payment received
      </h1>
      <dl className="my-6 grid gap-4 border-y border-[var(--border)] py-5 text-sm">
        <div>
          <dt className="text-[var(--muted)]">Receipt</dt>
          <dd className="font-semibold">{receipt.receiptNumber}</dd>
        </div>
        <div>
          <dt>Paid Now</dt>
          <dd className="font-semibold tabular-nums">
            {formatMoney(receipt.totalAmount)}
          </dd>
        </div>
        <div>
          <dt>Due After Payment</dt>
          <dd className="font-semibold tabular-nums">
            {formatMoney(receipt.outstandingAfter)}
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link to={`/customers/${id}/receipts/${receipt.id}`}>
            View Receipt
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to={`/customers/${id}`}>Back to Customer</Link>
        </Button>
        <Button
          variant="ghost"
          disabled={receipt.outstandingAfter <= 0}
          onClick={onAnother}
        >
          Receive Another Payment
        </Button>
      </div>
    </div>
  );
}

export function PaymentConfirmation({
  c,
  cents,
  method,
  rows,
  busy,
  onConfirm,
  onEdit,
}: {
  c: PaymentContext;
  cents: number;
  method: string;
  rows: AllocationRows;
  busy: boolean;
  onConfirm: () => void;
  onEdit: () => void;
}) {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus();
  }, []);
  return (
    <section className="mt-5 border-y border-[var(--border)] py-5">
      <h2 ref={title} tabIndex={-1} className="text-lg font-semibold">
        Confirm Payment
      </h2>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <dt>Customer</dt>
        <dd className="break-words">{c.customerName}</dd>
        <dt>Paid Now</dt>
        <dd>{formatMoney(cents / 100)}</dd>
        <dt>Method</dt>
        <dd>{paymentMethods.find((m) => m[0] === method)?.[1]}</dd>
        <dt>Items paid</dt>
        <dd>{rows.filter((r) => (r.cents ?? 0) > 0).length}</dd>
        <dt>Due Before</dt>
        <dd>{formatMoney(c.outstanding)}</dd>
        <dt>Due After Payment</dt>
        <dd>{formatMoney(c.outstanding - cents / 100)}</dd>
      </dl>
      <ul className="my-4 space-y-2 text-sm">
        {rows
          .filter((r) => (r.cents ?? 0) > 0)
          .map((r) => (
            <li key={r.invoice.id}>
              {r.invoice.invoiceNumber ?? "Opening Due"} →{" "}
              {formatMoney((r.cents ?? 0) / 100)}
            </li>
          ))}
      </ul>
      <div className="flex gap-3">
        <Button disabled={busy} onClick={onConfirm}>
          Confirm Payment
        </Button>
        <Button variant="outline" onClick={onEdit}>
          Edit Payment
        </Button>
      </div>
    </section>
  );
}

export function PaymentAllocationRows({
  rows,
  mode,
  manual,
  onManual,
}: {
  rows: AllocationRows;
  mode: "AUTO" | "MANUAL";
  manual: Record<string, string>;
  onManual: (saleId: string, value: string) => void;
}) {
  return (
    <section
      aria-label="Pay Against"
      className="border-y border-[var(--border)]"
    >
      <div className="hidden grid-cols-[1.3fr_1fr_1fr_1fr_1fr_1fr] gap-3 bg-[var(--surface-muted)] px-3 py-3 text-xs text-[var(--muted)] md:grid">
        <span>Pay Against</span>
        <span>Date</span>
        <span>Total</span>
        <span>Already Paid</span>
        <span>Due Left</span>
        <span>Pay Now</span>
      </div>
      {rows.map((r) => (
        <div
          key={r.invoice.id}
          className="grid grid-cols-2 items-center gap-3 border-b border-[var(--border)] p-3 text-sm last:border-0 md:grid-cols-[1.3fr_1fr_1fr_1fr_1fr_1fr]"
        >
          {r.invoice.sourceKind === "OPENING" ? (
            <span className="font-medium">Opening Due</span>
          ) : (
            <Link className={ledgerLink} to={`/sales/${r.invoice.id}/invoice`}>
              {r.invoice.invoiceNumber}
            </Link>
          )}
          <span className="text-xs text-[var(--muted)]">
            {formatLedgerDate(r.invoice.soldAt)}
          </span>
          <span className="tabular-nums">
            <span className="mr-1 text-xs md:hidden">Total</span>
            {formatMoney(r.invoice.totalAmount)}
          </span>
          <span className="tabular-nums">
            <span className="mr-1 text-xs md:hidden">Paid</span>
            {formatMoney(r.invoice.paidAmount)}
          </span>
          <strong className="tabular-nums">
            <span className="mr-1 text-xs font-normal md:hidden">Due</span>
            {formatMoney(r.invoice.dueAmount)}
          </strong>
          {mode === "MANUAL" ? (
            <label>
              <span className="text-xs md:sr-only">
                Pay now · {r.invoice.invoiceNumber ?? "Opening Due"}
              </span>
              <Input
                inputMode="decimal"
                aria-invalid={!r.valid}
                value={manual[r.invoice.id] ?? ""}
                onChange={(e) => onManual(r.invoice.id, e.target.value)}
              />
              {!r.valid && (
                <span className="text-xs text-[var(--danger)]">
                  Enter 0 to {formatMoney(r.invoice.dueAmount)}
                </span>
              )}
            </label>
          ) : (
            <span className="tabular-nums">
              <span className="mr-1 text-xs md:hidden">Pay</span>
              {formatMoney((r.cents ?? 0) / 100)}
            </span>
          )}
        </div>
      ))}
    </section>
  );
}
