import { Permit } from "@/features/auth/permit";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { getOutstandingCustomers, getRecentPaymentReceipts } from "@/lib/api";
import {
  formatMoney,
  LedgerError,
  LedgerLoading,
  LedgerPagination,
} from "@/features/sales/ledger-components";
import {
  OutstandingCustomerLedger,
  RecentReceiptLedger,
} from "./payments-ledgers";
import { PaymentCustomerSearch } from "./payment-customer-search";
import { readPaymentsParams } from "./payments-navigation";
import { FinanceNavigation } from "@/features/finance/finance-navigation";
import "@/features/finance/finance.css";
export function PaymentsPage({ cashbook = false }: { cashbook?: boolean }) {
  const [params, setParams] = useSearchParams();
  const { view, search, page } = readPaymentsParams(params);
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false);
  const term = useDebouncedValue(search, 250);
  const request = { search: term, page, pageSize: 25 };
  const outstanding = useQuery({
    queryKey: ["customers", "payments", "outstanding", request],
    queryFn: () => getOutstandingCustomers(request),
    enabled: view === "outstanding",
  });
  const receipts = useQuery({
    queryKey: ["customers", "payments", "receipts", request],
    queryFn: () => getRecentPaymentReceipts(request),
    enabled: view === "receipts",
  });
  const q = view === "outstanding" ? outstanding : receipts;
  const changingSearch = search !== term;
  const apply = (next: Partial<ReturnType<typeof readPaymentsParams>>) => {
    const values = { view, search, page, ...next };
    const p = new URLSearchParams();
    if (values.view !== "outstanding") p.set("view", values.view);
    if (values.search) p.set("search", values.search);
    if (values.page > 1) p.set("page", String(values.page));
    setParams(p, { replace: true });
  };
  return (
    <div
      className={
        cashbook
          ? "finance-page"
          : "mx-auto max-w-350 px-4 pb-28 pt-6 md:px-7 lg:px-8 lg:pb-10"
      }
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {cashbook && (
            <p className="finance-eyebrow">Afia Leather · Customer payments</p>
          )}
          <h1 className="text-2xl font-semibold tracking-tight">
            {cashbook ? "Receive Payment" : "Payments"}
          </h1>
          {cashbook && (
            <p className="finance-subtitle">
              Choose a customer below to receive old due, or view payment
              receipts.
            </p>
          )}
          {view === "outstanding" &&
            outstanding.data &&
            !outstanding.isError && (
              <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                <span className="text-[var(--muted)]">Total Due</span>
                <strong className="text-lg font-semibold text-[var(--primary-strong)] tabular-nums">
                  {formatMoney(outstanding.data.totalOutstanding)}
                </strong>
              </p>
            )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Permit permission="payments.opening"><Button asChild variant={cashbook ? "primary" : "outline"}>
            <Link
              to={
                cashbook
                  ? "/cashbook/receive-payment/add-old-customer"
                  : "/payments/add-customer"
              }
            >
              <Plus aria-hidden="true" className="size-4" />
              Add Old Customer
            </Link>
          </Button></Permit>
          {!cashbook && (
            <Permit permission="payments.receive"><Button
              onClick={() => setCustomerSearchOpen(true)}
              className="shrink-0"
            >
              <Plus aria-hidden="true" className="size-4" />
              Receive Payment
            </Button></Permit>
          )}
        </div>
      </header>
      {cashbook && (
        <div className="mt-6">
          <FinanceNavigation />
        </div>
      )}
      <nav
        aria-label="Payment views"
        className="mt-6 flex gap-4 border-b border-[var(--border)]"
      >
        {[
          ["outstanding", "Customers With Due"],
          ["receipts", "Receipts"],
        ].map(([key, label]) => (
          <Button
            key={key}
            variant="ghost"
            aria-current={view === key ? "page" : undefined}
            className={`rounded-none border-b-2 px-1 ${view === key ? "border-[var(--accent)] text-[var(--accent)]" : "border-transparent text-[var(--muted)]"}`}
            onClick={() =>
              apply({ view: key as typeof view, page: 1, search: "" })
            }
          >
            {label}
          </Button>
        ))}
      </nav>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">
          {view === "outstanding" ? "Customers With Due" : "Recent Receipts"}
        </h2>
        <label className="relative w-full min-w-0 sm:w-80">
          <span className="sr-only">
            {view === "outstanding"
              ? "Search customer or phone"
              : "Search receipt, customer or phone"}
          </span>
          <Search
            aria-hidden="true"
            className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]"
          />
          <Input
            type="search"
            className="min-w-0 pl-9 pr-10"
            maxLength={200}
            value={search}
            onChange={(e) => apply({ search: e.target.value, page: 1 })}
            placeholder={
              view === "outstanding"
                ? "Customer or phone…"
                : "Receipt, customer or phone…"
            }
          />
          {search && (
            <button
              type="button"
              aria-label="Clear payments search"
              onClick={() => apply({ search: "", page: 1 })}
              className="absolute right-1 top-0 flex size-11 items-center justify-center rounded-md text-[var(--muted)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          )}
        </label>
      </div>
      <section
        aria-label={
          view === "outstanding" ? "Customers With Due" : "Recent Receipts"
        }
        aria-busy={q.isFetching || changingSearch}
        className="mt-3 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface)]"
      >
        {q.isError ? (
          <LedgerError
            message={q.error.message}
            retry={() => void q.refetch()}
          />
        ) : q.isPending || changingSearch ? (
          <LedgerLoading />
        ) : q.data.items.length ? (
          view === "outstanding" ? (
            <OutstandingCustomerLedger rows={outstanding.data!.items} />
          ) : (
            <RecentReceiptLedger rows={receipts.data!.items} />
          )
        ) : (
          <div className="p-5">
            <h3 className="text-sm font-semibold">
              {view === "outstanding"
                ? search
                  ? "No matching customers"
                  : "No due to pay"
                : search
                  ? "No matching receipts"
                  : "No payment receipts yet"}
            </h3>
            <p className="mt-2 text-sm text-[var(--muted)]">
              {search
                ? "Try another customer name or phone."
                : view === "outstanding"
                  ? "No customers have due left."
                  : "Receipts appear here after a due payment is received."}
            </p>
            {search ? (
              <Button
                variant="outline"
                className="mt-3"
                onClick={() => apply({ search: "", page: 1 })}
              >
                Clear Search
              </Button>
            ) : view === "receipts" ? (
              <Button
                variant="outline"
                className="mt-3"
                onClick={() =>
                  cashbook
                    ? apply({ view: "outstanding", search: "", page: 1 })
                    : setCustomerSearchOpen(true)
                }
              >
                Receive Payment
              </Button>
            ) : (
              <Button asChild variant="outline" className="mt-3">
                <Link to="/customers">View Customers</Link>
              </Button>
            )}
          </div>
        )}
        {q.data && !q.isError && !changingSearch && (
          <LedgerPagination
            data={q.data}
            busy={q.isFetching}
            onPage={(next) => apply({ page: next })}
          />
        )}
      </section>
      <PaymentCustomerSearch
        open={customerSearchOpen}
        onOpenChange={setCustomerSearchOpen}
      />
    </div>
  );
}
