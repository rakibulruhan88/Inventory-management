import { Permit } from "@/features/auth/permit";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  formatLedgerDate,
  formatMoney,
  ledgerLink,
} from "@/features/sales/ledger-components";
import { paymentMethods } from "@/features/records/payment-components";
import type {
  OutstandingCustomerRow,
  ReceiptLedgerRow,
} from "./payments-types";
import {
  customerAccountPath,
  receivePaymentPath,
  receiptDetailPath,
} from "./payments-navigation";
const cell = "px-4 py-3";
const heading = `${cell} font-medium`;
export function OutstandingCustomerLedger({
  rows,
}: {
  rows: OutstandingCustomerRow[];
}) {
  return (
    <>
      <table className="hidden w-full table-fixed text-left text-sm lg:table">
        <caption className="sr-only">Customers With Due</caption>
        <thead className="border-b border-[var(--border)] bg-[var(--surface-muted)] text-xs text-[var(--muted)]">
          <tr>
            <th className={`${heading} w-[24%]`} scope="col">
              Customer
            </th>
            <th className={heading} scope="col">
              Phone
            </th>
            <th className={`${heading} text-right`} scope="col">
              Total Due
            </th>
            <th className={heading} scope="col">
              Oldest Due
            </th>
            <th className={heading} scope="col">
              Last Sale
            </th>
            <th className={`${heading} w-44`} scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr
              key={c.id}
              className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--page)]"
            >
              <td className={`${cell} break-words font-medium`}>
                <Link className={ledgerLink} to={customerAccountPath(c.id)}>
                  {c.name}
                </Link>
              </td>
              <td className={`${cell} break-words text-[var(--muted)]`}>
                {c.phone || "—"}
              </td>
              <td
                className={`${cell} break-words text-right font-semibold text-[var(--primary-strong)] tabular-nums`}
              >
                {formatMoney(c.totalDue)}
              </td>
              <td className={cell}>
                <DueInvoice customer={c} />
              </td>
              <td className={`${cell} text-xs text-[var(--muted)]`}>
                {c.lastSoldAt ? formatLedgerDate(c.lastSoldAt) : "—"}
              </td>
              <td className={cell}>
                <Permit permission="payments.receive"><Button
                  asChild
                  variant="outline"
                  className="whitespace-nowrap px-3 text-xs"
                >
                  <Link
                    aria-label={`Receive payment from ${c.name}`}
                    to={receivePaymentPath(c.id)}
                  >
                    Receive Payment
                  </Link>
                </Button></Permit>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="lg:hidden">
        {rows.map((c) => (
          <li
            key={c.id}
            className="border-b border-[var(--border)] p-4 last:border-0"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Link
                  className={`${ledgerLink} break-words text-sm font-semibold`}
                  to={customerAccountPath(c.id)}
                >
                  {c.name}
                </Link>
                <p className="mt-1 break-words text-xs text-[var(--muted)]">
                  {c.phone || "No phone recorded"}
                </p>
              </div>
            </div>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-xs text-[var(--muted)]">Total Due</dt>
                <dd className="min-w-0 break-words text-right font-semibold text-[var(--primary-strong)] tabular-nums">
                  {formatMoney(c.totalDue)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-xs text-[var(--muted)]">Oldest Due</dt>
                <dd className="min-w-0 text-right">
                  <DueInvoice customer={c} />
                </dd>
              </div>
            </dl>
            <Permit permission="payments.receive"><Button asChild variant="outline" className="mt-3 w-full sm:w-auto">
              <Link
                aria-label={`Receive payment from ${c.name}`}
                to={receivePaymentPath(c.id)}
              >
                Receive Payment
              </Link>
            </Button></Permit>
          </li>
        ))}
      </ul>
    </>
  );
}
function DueInvoice({ customer: c }: { customer: OutstandingCustomerRow }) {
  return (
    <>
      {c.oldestDueInvoice.sourceKind === "OPENING" ? (
        <span className="text-xs font-medium">Opening Due</span>
      ) : (
        <Link
          className={`${ledgerLink} break-words text-xs`}
          to={`/sales/${encodeURIComponent(c.oldestDueInvoice.id)}/invoice`}
        >
          {c.oldestDueInvoice.invoiceNumber}
        </Link>
      )}
      <span className="mt-1 block text-[11px] text-[var(--muted)]">
        {formatLedgerDate(c.oldestDueInvoice.soldAt)}
      </span>
    </>
  );
}
export function RecentReceiptLedger({ rows }: { rows: ReceiptLedgerRow[] }) {
  const method = (value: string) =>
    paymentMethods.find((m) => m[0] === value)?.[1] ??
    value.replaceAll("_", " ");
  return (
    <>
      <table className="hidden w-full table-fixed text-left text-sm md:table">
        <caption className="sr-only">
          Recent payment receipts, one row per receipt
        </caption>
        <thead className="border-b border-[var(--border)] bg-[var(--surface-muted)] text-xs text-[var(--muted)]">
          <tr>
            {["Receipt", "Customer", "Date", "Method", "Amount"].map(
              (label) => (
                <th
                  className={`${heading} ${label === "Amount" ? "text-right" : ""}`}
                  scope="col"
                  key={label}
                >
                  {label}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--page)]"
            >
              <td className={`${cell} break-words font-medium`}>
                <Link
                  className={ledgerLink}
                  to={receiptDetailPath(r.customerId, r.id)}
                >
                  {r.receiptNumber}
                </Link>
              </td>
              <td className={`${cell} break-words`}>
                <Link
                  className={ledgerLink}
                  to={customerAccountPath(r.customerId)}
                >
                  {r.customerName}
                </Link>
                {r.customerPhone && (
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {r.customerPhone}
                  </p>
                )}
              </td>
              <td className={`${cell} text-xs`}>
                {formatLedgerDate(r.paidAt)}
              </td>
              <td className={`${cell} break-words text-xs`}>
                {method(r.method)}
              </td>
              <td
                className={`${cell} break-words text-right font-semibold tabular-nums`}
              >
                {formatMoney(r.totalAmount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="md:hidden">
        {rows.map((r) => (
          <li
            key={r.id}
            className="border-b border-[var(--border)] p-4 last:border-0"
          >
            <div className="flex justify-between gap-3">
              <Link
                className={`${ledgerLink} min-w-0 break-words text-sm font-semibold`}
                to={receiptDetailPath(r.customerId, r.id)}
              >
                {r.receiptNumber}
              </Link>
              <strong className="min-w-0 break-words text-right text-sm tabular-nums">
                {formatMoney(r.totalAmount)}
              </strong>
            </div>
            <Link
              className={`${ledgerLink} mt-2 block break-words text-sm`}
              to={customerAccountPath(r.customerId)}
            >
              {r.customerName}
            </Link>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {formatLedgerDate(r.paidAt)} · {method(r.method)}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}
