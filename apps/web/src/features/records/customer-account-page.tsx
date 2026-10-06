import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import type { PaymentHistory } from "@afia/contracts";
import { Button } from "@/components/ui/button";
import { getCustomerAccount } from "@/lib/api";
import {
  formatLedgerDate,
  formatMoney,
  ledgerLink,
  LedgerError,
  LedgerLoading,
  LedgerPagination,
  SalesLedger,
} from "@/features/sales/ledger-components";

function PaymentHistoryRows({ rows }: { rows: PaymentHistory[] }) {
  const invoice = (p: PaymentHistory) =>
    p.saleId && p.invoiceNumber ? (
      <Link className={ledgerLink} to={`/sales/${p.saleId}/invoice`}>
        {p.invoiceNumber}
      </Link>
    ) : (
      <span className="text-[var(--muted)]">Not linked</span>
    );
  return (
    <>
      <table className="hidden w-full table-fixed text-left text-sm md:table">
        <caption className="sr-only">Customer payment history</caption>
        <thead className="border-b border-[var(--border)] bg-[var(--surface-muted)] text-xs text-[var(--muted)]">
          <tr>
            {[
              "Payment Date",
              "Amount",
              "Method",
              "Reference",
              "Related Invoice",
              "Notes",
            ].map((label) => (
              <th
                key={label}
                className={`px-4 py-3 font-medium ${label === "Amount" ? "text-right" : ""}`}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr
              key={p.id}
              className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--page)]"
            >
              <td className="px-4 py-3">{formatLedgerDate(p.receivedAt)}</td>
              <td className="break-words px-4 py-3 text-right tabular-nums">
                {formatMoney(p.amount)}
              </td>
              <td className="px-4 py-3">{p.method.replaceAll("_", " ")}</td>
              <td className="break-words px-4 py-3">{p.reference || "—"}</td>
              <td className="break-words px-4 py-3">{invoice(p)}</td>
              <td className="break-words px-4 py-3">{p.notes || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="md:hidden">
        {rows.map((p) => (
          <li
            key={p.id}
            className="border-b border-[var(--border)] px-4 py-3 text-sm last:border-0"
          >
            <div className="flex justify-between gap-3">
              <span className="text-xs text-[var(--muted)]">
                {formatLedgerDate(p.receivedAt)}
              </span>
              <strong className="tabular-nums">{formatMoney(p.amount)}</strong>
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {p.method.replaceAll("_", " ")}
            </p>
            <div className="mt-2 text-xs">Invoice: {invoice(p)}</div>
            {p.reference && (
              <p className="mt-1 break-words text-xs">
                Reference: {p.reference}
              </p>
            )}
            {p.notes && (
              <p className="mt-1 break-words text-xs text-[var(--muted)]">
                {p.notes}
              </p>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
const tabs = [
  ["sales", "Sales history"],
  ["outstanding", "Due by Invoice"],
  ["payments", "Payment history"],
] as const;
export function CustomerDetailPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab =
    params.get("tab") === "outstanding"
      ? "outstanding"
      : params.get("tab") === "payments"
        ? "payments"
        : "sales";
  const parsedPage = Number(params.get("page") ?? 1);
  const page = Number.isFinite(parsedPage)
    ? Math.max(1, Math.floor(parsedPage))
    : 1;
  const q = useQuery({
    queryKey: ["customers", "account", id, page],
    queryFn: () => getCustomerAccount(id, page),
    enabled: !!id,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === id ? previous : undefined,
  });
  const c = q.data;
  const data = c
    ? tab === "sales"
      ? c.sales
      : tab === "outstanding"
        ? c.outstandingInvoices
        : c.payments
    : undefined;
  return (
    <div className="mx-auto max-w-350 px-4 pb-28 pt-6 md:px-7 lg:px-8 lg:pb-10">
      <Link
        className={`${ledgerLink} inline-flex min-h-11 items-center gap-2 text-sm`}
        to="/customers"
      >
        <ArrowLeft className="size-4" /> Customers
      </Link>
      {q.isError ? (
        <LedgerError message={q.error.message} retry={() => void q.refetch()} />
      ) : !c ? (
        <LedgerLoading />
      ) : (
        <>
          <header className="mt-3">
            <p className="text-xs text-[var(--muted)]">
              Customer account · Read-only
            </p>
            <h1 className="mt-1 break-words text-2xl font-semibold tracking-tight">
              {c.name}
            </h1>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-[var(--muted)]">
              {c.phone && <p className="break-words">{c.phone}</p>}
              {c.email && <p className="min-w-0 break-all">{c.email}</p>}
              {!c.phone && !c.email && <p>No phone or email recorded</p>}
            </div>
            {c.address && (
              <p className="mt-1 break-words text-sm text-[var(--muted)]">
                {c.address}
              </p>
            )}
          </header>
          <dl className="mt-5 grid divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-[var(--surface)] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {[
              ["Total Sales", c.totalSales],
              ["Total Paid", c.totalPaid],
              ["Customer Outstanding", c.totalDue],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-3 px-4 py-4 sm:block"
              >
                <dt className="text-xs text-[var(--muted)]">{label}</dt>
                <dd className="break-words text-base font-semibold tabular-nums sm:mt-2">
                  {formatMoney(Number(value))}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Account totals cover all completed invoices. Invoice Due is the
            balance of one invoice; Customer Outstanding is the full account
            balance.
          </p>
          <nav
            aria-label="Customer history"
            className="mt-6 flex flex-wrap gap-1 border-b border-[var(--border)]"
          >
            {tabs.map(([key, label]) => (
              <Button
                key={key}
                variant="ghost"
                aria-current={tab === key ? "page" : undefined}
                className={`rounded-none border-b-2 px-3 ${tab === key ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-[var(--muted)]"}`}
                onClick={() => setParams({ tab: key, page: "1" })}
              >
                {label}
                {key === "outstanding" && (
                  <span className="text-xs">
                    ({c.outstandingInvoices.total})
                  </span>
                )}
              </Button>
            ))}
          </nav>
          <div className="py-3">
            <h2 className="text-sm font-semibold">
              {tabs.find((t) => t[0] === tab)![1]}
            </h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {tab === "outstanding"
                ? "Completed invoices with a remaining balance. Original totals and recorded payments are shown below."
                : tab === "payments"
                  ? "Existing non-voided payment records, including their invoice links when known. A receipt applied across invoices appears as separate records."
                  : "All invoices, newest sale date first. Voided invoices do not contribute to Customer Outstanding."}
            </p>
          </div>
          <section
            aria-label={tabs.find((t) => t[0] === tab)![1]}
            aria-busy={q.isFetching}
            className="overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface)]"
          >
            {data!.items.length ? (
              tab === "payments" ? (
                <PaymentHistoryRows rows={c.payments.items} />
              ) : (
                <SalesLedger
                  rows={
                    tab === "sales"
                      ? c.sales.items
                      : c.outstandingInvoices.items
                  }
                  customer={false}
                  outstanding={tab === "outstanding"}
                />
              )
            ) : (
              <div className="p-5">
                <h3 className="text-sm font-semibold">
                  {tab === "outstanding"
                    ? "No outstanding invoices"
                    : tab === "payments"
                      ? "No payment records"
                      : "No sales recorded"}
                </h3>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {page > 1
                    ? "This page is empty. Return to the previous page."
                    : tab === "outstanding"
                      ? "This customer has no completed invoices with a remaining balance."
                      : "Records will appear here when available."}
                </p>
              </div>
            )}
            <LedgerPagination
              data={data!}
              busy={q.isFetching}
              onPage={(next) => setParams({ tab, page: String(next) })}
            />
          </section>
        </>
      )}
    </div>
  );
}
