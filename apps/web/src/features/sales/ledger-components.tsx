import type { LedgerPage, SalesLedgerRow } from "@afia/contracts";
import { SALES_BUSINESS_TIMEZONE } from "@afia/contracts";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export const ledgerLink =
  "rounded-sm text-[var(--accent)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]";
export const formatLedgerDate = (value: string) =>
  new Intl.DateTimeFormat("en-BD", {
    timeZone: SALES_BUSINESS_TIMEZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
export const formatMoney = (value: number) =>
  `৳${value.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function SaleStatus({ sale }: { sale: SalesLedgerRow }) {
  const status =
    sale.status === "VOIDED"
      ? "Voided"
      : sale.status !== "COMPLETED"
        ? sale.status
        : sale.dueAmount <= 0
          ? "Paid"
          : sale.paidAmount > 0
            ? "Partial"
            : "Unpaid";
  return (
    <span
      className={`text-xs font-medium ${status === "Voided" ? "text-[var(--danger)]" : status === "Partial" || status === "Unpaid" ? "text-[var(--warning)]" : "text-[var(--muted)]"}`}
    >
      {status}
    </span>
  );
}
export function SalesLedger({
  rows,
  customer = true,
  outstanding = false,
}: {
  rows: SalesLedgerRow[];
  customer?: boolean;
  outstanding?: boolean;
}) {
  return (
    <>
      <div className="hidden md:block">
        <table className="w-full table-fixed text-left text-sm">
          <caption className="sr-only">
            {outstanding ? "Outstanding invoices" : "Sales ledger"}
          </caption>
          <thead className="border-b border-[var(--border)] bg-[var(--surface-muted)] text-xs text-[var(--muted)]">
            <tr>
              {customer && (
                <th className="w-[27%] px-4 py-3 font-medium">Customer</th>
              )}
              <th className="px-4 py-3 font-medium">Invoice / Sale Date</th>
              {[
                outstanding ? "Original Invoice Total" : "Invoice Total",
                "Invoice Paid",
                "Invoice Due",
              ].map((label) => (
                <th key={label} className="px-3 py-3 text-right font-medium">
                  {label}
                </th>
              ))}
              <th className="w-20 px-3 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr
                key={s.id}
                className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--page)]"
              >
                {customer && (
                  <td className="px-4 py-3 align-top">
                    <Link
                      className={`${ledgerLink} break-words font-semibold text-[var(--ink)]`}
                      to={`/customers/${s.customerId}`}
                    >
                      {s.customerName}
                    </Link>
                    {s.customerPhone && (
                      <p className="mt-1 break-words text-xs text-[var(--muted)]">
                        {s.customerPhone}
                      </p>
                    )}
                  </td>
                )}
                <td className="px-4 py-3 align-top">
                  <Link
                    className={`${ledgerLink} break-words text-xs font-medium`}
                    aria-label={`View invoice ${s.invoiceNumber}`}
                    to={`/sales/${s.id}/invoice`}
                  >
                    {s.invoiceNumber}
                  </Link>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {formatLedgerDate(s.soldAt)}
                  </p>
                </td>
                <td className="break-words px-3 py-3 text-right tabular-nums">
                  {formatMoney(s.totalAmount)}
                </td>
                <td className="break-words px-3 py-3 text-right tabular-nums">
                  {formatMoney(s.paidAmount)}
                </td>
                <td className="break-words px-3 py-3 text-right font-medium tabular-nums">
                  {s.status === "COMPLETED" ? formatMoney(s.dueAmount) : "—"}
                </td>
                <td className="px-3 py-3">
                  <SaleStatus sale={s} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="md:hidden">
        {rows.map((s) => (
          <li
            key={s.id}
            className="border-b border-[var(--border)] px-4 py-3 last:border-0"
          >
            <div className="flex items-start justify-between gap-3">
              {customer ? (
                <Link
                  className={`${ledgerLink} min-w-0 break-words text-sm font-semibold text-[var(--ink)]`}
                  to={`/customers/${s.customerId}`}
                >
                  {s.customerName}
                </Link>
              ) : (
                <Link
                  className={`${ledgerLink} break-words text-sm font-medium`}
                  to={`/sales/${s.id}/invoice`}
                >
                  {s.invoiceNumber}
                </Link>
              )}
              <SaleStatus sale={s} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-[var(--muted)]">
              {customer && (
                <Link
                  className={ledgerLink}
                  aria-label={`View invoice ${s.invoiceNumber}`}
                  to={`/sales/${s.id}/invoice`}
                >
                  {s.invoiceNumber}
                </Link>
              )}
              <span>{formatLedgerDate(s.soldAt)}</span>
            </div>
            <dl
              className={`mt-2 grid ${customer ? "grid-cols-2" : "grid-cols-3"} gap-2 text-xs`}
            >
              <div>
                <dt className="text-[var(--muted)]">Invoice Total</dt>
                <dd className="mt-0.5 break-words font-medium tabular-nums">
                  {formatMoney(s.totalAmount)}
                </dd>
              </div>
              {!customer && (
                <div>
                  <dt className="text-[var(--muted)]">Invoice Paid</dt>
                  <dd className="mt-0.5 break-words tabular-nums">
                    {formatMoney(s.paidAmount)}
                  </dd>
                </div>
              )}
              <div className="text-right">
                <dt className="text-[var(--muted)]">Invoice Due</dt>
                <dd className="mt-0.5 break-words font-semibold tabular-nums">
                  {s.status === "COMPLETED" ? formatMoney(s.dueAmount) : "—"}
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
export function LedgerPagination({
  data,
  onPage,
  busy,
}: {
  data: Pick<LedgerPage<unknown>, "page" | "pageSize" | "total">;
  onPage: (page: number) => void;
  busy: boolean;
}) {
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--muted)]">
      <p aria-live="polite">
        {data.total.toLocaleString()} records · Page {data.page} of {pages}
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={busy || data.page <= 1}
          onClick={() => onPage(data.page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          disabled={busy || data.page >= pages}
          onClick={() => onPage(data.page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
export function LedgerLoading() {
  return (
    <div role="status" className="divide-y divide-[var(--border)]">
      <span className="sr-only">Loading records…</span>
      {[1, 2, 3, 4, 5].map((n) => (
        <div
          key={n}
          aria-hidden="true"
          className="flex h-16 items-center justify-between px-4"
        >
          <div className="h-3 w-1/3 animate-pulse rounded-sm bg-[var(--surface-muted)]" />
          <div className="h-3 w-20 animate-pulse rounded-sm bg-[var(--surface-muted)]" />
        </div>
      ))}
    </div>
  );
}
export function LedgerError({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}) {
  return (
    <div role="alert" className="p-5">
      <h2 className="text-sm font-semibold">Records unavailable</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">{message}</p>
      <Button className="mt-3" variant="outline" onClick={retry}>
        Try again
      </Button>
    </div>
  );
}
