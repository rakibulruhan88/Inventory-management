import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useLocation, useSearchParams } from "react-router-dom";
import {
  ArrowDownLeft,
  ArrowUpRight,
  SlidersHorizontal,
  Plus,
} from "lucide-react";
import {
  financeLabels,
  financeTypes,
  type FinanceQuery,
  type FinanceRow,
} from "@afia/contracts";
import { SearchablePicker } from "@/components/searchable-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/features/auth/auth-context";
import { getFinance } from "@/lib/api";
import {
  cashMoney,
  FinancialSummary,
  SectionFinancialSummary,
  methodNames,
} from "./financial-summary";
import { cashDate } from "./finance-entry-detail";
import {
  FinanceNavigation,
  financeNewPaths,
  financeSections,
} from "./finance-navigation";
import "./finance.css";
const dates = [
  { value: "all", label: "All Dates" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "specific", label: "Specific Date" },
  { value: "range", label: "Custom Dates" },
];
function Source({ row: r }: { row: FinanceRow }) {
  return (
    <Link
      className="finance-source"
      to={
        r.id.startsWith("entry:")
          ? `/cashbook/entries/${r.sourceId}`
          : r.sourceUrl
      }
    >
      {r.details}
    </Link>
  );
}
type LedgerMode = "all" | "income" | "expenses" | "suppliers" | "out";
function Ledger({ rows, mode }: { rows: FinanceRow[]; mode: LedgerMode }) {
  const all = mode === "all";
  const showType = all || mode === "income";
  const detailLabel =
    mode === "expenses"
      ? "Expense / Note"
      : mode === "suppliers"
        ? "Supplier"
        : mode === "income"
          ? "Received From"
          : "Details";
  const amountLabel =
    mode === "expenses"
      ? "Expense Amount"
      : mode === "suppliers"
        ? "Amount Paid"
        : mode === "income"
          ? "Amount Received"
          : "Amount Paid";
  return (
    <>
      <div className="finance-table">
        <table>
          <colgroup>
            <col style={{ width: all ? "14%" : "18%" }} />
            {showType && <col style={{ width: "14%" }} />}
            <col style={{ width: all ? "26%" : showType ? "26%" : "35%" }} />
            <col style={{ width: all ? "12%" : "15%" }} />
            <col style={{ width: all ? "12%" : "17%" }} />
            {all && <col style={{ width: "12%" }} />}
            <col style={{ width: all ? "10%" : "15%" }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Date / Time</th>
              {showType && <th scope="col">Payment Type</th>}
              <th scope="col">{detailLabel}</th>
              <th scope="col">Method</th>
              {all ? (
                <>
                  <th scope="col" className="number">
                    Money In
                  </th>
                  <th scope="col" className="number">
                    Money Out
                  </th>
                </>
              ) : (
                <th scope="col" className="number">
                  {amountLabel}
                </th>
              )}
              <th scope="col">Reference</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.voidedAt ? "finance-voided" : ""}>
                <td className="finance-date">{cashDate(r.occurredAt)}</td>
                {showType && <td>{financeLabels[r.type]}</td>}
                <td>
                  <Source row={r} />
                  {r.voidedAt && <span className="finance-status">Voided</span>}
                  {r.note && (
                    <p className="finance-row-note" title={r.note}>
                      {r.note}
                    </p>
                  )}
                </td>
                <td>{methodNames[r.method]}</td>
                {all ? (
                  <>
                    <td className="number">
                      {r.direction === "IN" ? cashMoney(r.amount) : "—"}
                    </td>
                    <td className="number">
                      {r.direction === "OUT" ? cashMoney(r.amount) : "—"}
                    </td>
                  </>
                ) : (
                  <td className="number">{cashMoney(r.amount)}</td>
                )}
                <td>{r.reference || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="finance-mobile-list">
        {rows.map((r) => (
          <article key={r.id} className={r.voidedAt ? "finance-voided" : ""}>
            <div className="finance-mobile-row">
              <div className="min-w-0">
                <p className="finance-row-kind">
                  {financeLabels[r.type]}
                  {r.voidedAt && <span className="finance-status">Voided</span>}
                </p>
                <Source row={r} />
              </div>
              <div
                className={`finance-row-amount ${r.direction === "IN" ? "is-in" : "is-out"}`}
              >
                <span>
                  {r.direction === "IN" ? (
                    <ArrowDownLeft size={13} />
                  ) : (
                    <ArrowUpRight size={13} />
                  )}
                  {all
                    ? `Money ${r.direction === "IN" ? "In" : "Out"}`
                    : amountLabel}
                </span>
                <strong>{cashMoney(r.amount)}</strong>
              </div>
            </div>
            <p className="finance-row-meta">
              {cashDate(r.occurredAt)}
              <span>·</span>
              {methodNames[r.method]}
            </p>
            {r.note && (
              <p className="finance-row-note" title={r.note}>
                {r.note}
              </p>
            )}
            {r.reference && (
              <p className="finance-row-reference">{r.reference}</p>
            )}
          </article>
        ))}
      </div>
    </>
  );
}
export function CashbookPage({ report = false }: { report?: boolean }) {
  const [params, setParams] = useSearchParams();
  const path = useLocation().pathname;
  const section = financeSections.find((s) => s.path === path);
  const isMoneyIn = path === "/cashbook/money-in";
  const sectionType = section && "type" in section ? section.type : undefined;
  const title = report
    ? "Financial Summary"
    : path === "/cashbook"
      ? "Cashbook"
      : (section?.label ?? "Cashbook");
  const canWrite = useAuth().user?.role === "OWNER";
  const [filtersOpen, setFiltersOpen] = useState(false);
  const selectedDate = params.get("date") ?? (report ? "month" : "all");
  const fixedType = isMoneyIn ? undefined : sectionType;
  const selectedType = financeTypes.find(
    (t) =>
      t === params.get("type") &&
      (!isMoneyIn ||
        ["SALE_PAYMENT", "DUE_PAYMENT", "OTHER_IN", "LEGACY_PAYMENT"].includes(
          t,
        )),
  );
  const mode: LedgerMode = isMoneyIn
    ? "income"
    : fixedType === "EXPENSE"
      ? "expenses"
      : fixedType === "SUPPLIER_PAYMENT"
        ? "suppliers"
        : fixedType === "OTHER_OUT"
          ? "out"
          : "all";
  const description =
    mode === "expenses"
      ? "Track operating costs, expense notes and vouchers."
      : mode === "suppliers"
        ? "Payments to suppliers, with purchase and container references."
        : mode === "income"
          ? "Sale payments, old due collected and other money received."
          : mode === "out"
            ? "Record other outgoing payments and their purpose."
            : "See what came in, what went out, and why.";
  const historyTitle =
    mode === "expenses"
      ? "Expense Records"
      : mode === "suppliers"
        ? "Supplier Payment History"
        : mode === "income"
          ? "Money Received"
          : mode === "out"
            ? "Outgoing Payments"
            : "All Transactions";
  const searchPlaceholder =
    mode === "expenses"
      ? "Expense, reference, note…"
      : mode === "suppliers"
        ? "Supplier, purchase, reference…"
        : mode === "out"
          ? "Purpose, reference, note…"
          : "Invoice, customer, reference…";
  const query: FinanceQuery = {
    date:
      selectedDate === "all"
        ? undefined
        : (selectedDate as FinanceQuery["date"]),
    from:
      selectedDate === "all" ? undefined : (params.get("from") ?? undefined),
    to: selectedDate === "all" ? undefined : (params.get("to") ?? undefined),
    type: report ? undefined : (fixedType ?? selectedType),
    direction: isMoneyIn ? "IN" : undefined,
    method: report
      ? undefined
      : ((params.get("method") || undefined) as FinanceQuery["method"]),
    status: report
      ? "active"
      : ((params.get("status") ?? "active") as FinanceQuery["status"]),
    search: report ? undefined : (params.get("search") ?? undefined),
    page: Number(params.get("page")) || 1,
    pageSize: 25,
  };
  const needsDate =
    (query.date === "specific" || query.date === "range") &&
    (!query.from || (query.date === "range" && !query.to));
  const q = useQuery({
    queryKey: ["finance", query],
    queryFn: () => getFinance(query),
    enabled: !needsDate,
  });
  const apply = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next, { replace: key === "search" });
  };
  const entryId = params.get("entry");
  if (entryId)
    return (
      <Navigate
        to={`/cashbook/entries/${encodeURIComponent(entryId)}`}
        replace
      />
    );
  const filtered = !!(
    (!fixedType && query.type) ||
    query.method ||
    query.search ||
    query.status !== "active"
  );
  return (
    <div className="finance-page">
      <header className="finance-page-header">
        <div>
          <p className="finance-eyebrow">Afia Leather · Money records</p>
          <h1>{title}</h1>
          <p className="finance-subtitle">
            {report ? "Sales, payments and expenses by date." : description}
          </p>
        </div>
        {!report && (
          <div className="finance-header-actions">
            {(mode === "all" || mode === "income") && (
              <Button asChild variant="outline">
                <Link to="/cashbook/receive-payment">Receive Payment</Link>
              </Button>
            )}
            {canWrite && (
              <Button asChild>
                <Link to={financeNewPaths[sectionType ?? "OTHER_IN"]}>
                  <Plus size={16} />
                  {sectionType
                    ? sectionType === "SUPPLIER_PAYMENT"
                      ? "Add Payment"
                      : sectionType === "EXPENSE"
                        ? "Add Expense"
                        : sectionType === "OTHER_OUT"
                          ? "Add Money Out"
                          : "Add Money In"
                    : "Add Money In"}
                </Link>
              </Button>
            )}
          </div>
        )}
      </header>
      {!report && <FinanceNavigation />}
      <div className="finance-period-toolbar">
        <div className="finance-date-picker">
          <SearchablePicker
            label="Date"
            placeholder="Date"
            value={selectedDate}
            options={dates}
            onChange={(v) => apply("date", v)}
            purchasePresentation
          />
        </div>
        {!report && (
          <Button
            variant="outline"
            onClick={() => setFiltersOpen(!filtersOpen)}
            aria-expanded={filtersOpen}
            aria-controls="cashbook-filters"
          >
            <SlidersHorizontal size={16} />
            Filters{filtered && <span className="finance-filter-dot" />}
          </Button>
        )}
        <p className="finance-period-note">
          Newest added first · Bangladesh time
        </p>
      </div>
      {(query.date === "specific" || query.date === "range") && (
        <div className="finance-custom-dates">
          <label>
            {query.date === "range" ? "From Date" : "Date"}
            <Input
              type="date"
              value={query.from ?? ""}
              onChange={(e) => apply("from", e.target.value)}
            />
          </label>
          {query.date === "range" && (
            <label>
              To Date
              <Input
                type="date"
                value={query.to ?? ""}
                onChange={(e) => apply("to", e.target.value)}
              />
            </label>
          )}
        </div>
      )}
      {!report && (
        <div
          id="cashbook-filters"
          className={`finance-filters ${fixedType ? "is-scoped" : ""} ${filtersOpen ? "is-open" : ""}`}
        >
          {!fixedType && (
            <label>
              Type
              <SearchablePicker
                label="Type"
                placeholder="All Types"
                value={query.type ?? ""}
                options={[
                  { value: "", label: "All Types" },
                  ...financeTypes
                    .filter(
                      (t) =>
                        !isMoneyIn ||
                        [
                          "SALE_PAYMENT",
                          "DUE_PAYMENT",
                          "OTHER_IN",
                          "LEGACY_PAYMENT",
                        ].includes(t),
                    )
                    .map((t) => ({ value: t, label: financeLabels[t] })),
                ]}
                onChange={(v) => apply("type", v)}
                purchasePresentation
              />
            </label>
          )}
          <label>
            Method
            <SearchablePicker
              label="Method"
              placeholder="All Methods"
              value={query.method ?? ""}
              options={[
                { value: "", label: "All Methods" },
                ...Object.entries(methodNames).map(([value, label]) => ({
                  value,
                  label,
                })),
              ]}
              onChange={(v) => apply("method", v)}
              purchasePresentation
            />
          </label>
          <label>
            Status
            <SearchablePicker
              label="Status"
              placeholder="Saved entries"
              value={query.status}
              options={[
                { value: "active", label: "Saved entries" },
                { value: "all", label: "All entries" },
                { value: "voided", label: "Voided entries" },
              ]}
              onChange={(v) => apply("status", v)}
              purchasePresentation
            />
          </label>
          <label>
            Search
            <Input
              placeholder={searchPlaceholder}
              value={query.search ?? ""}
              maxLength={200}
              onChange={(e) => apply("search", e.target.value)}
            />
          </label>
        </div>
      )}
      {needsDate ? (
        <div className="finance-feedback">
          Choose dates to see your records.
        </div>
      ) : q.isPending ? (
        <div className="finance-feedback" role="status">
          Loading money records…
        </div>
      ) : q.isError ? (
        <div className="finance-feedback" role="alert">
          <p>{q.error.message}</p>
          <Button variant="outline" onClick={() => q.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        q.data && (
          <>
            {report || mode === "all" ? (
              <FinancialSummary summary={q.data.summary} expanded={report} />
            ) : (
              <SectionFinancialSummary
                summary={q.data.summary}
                mode={mode}
                total={q.data.total}
              />
            )}
            {!report && (
              <>
                <div className="finance-list-heading">
                  <h2>{historyTitle}</h2>
                  <p>
                    {q.data.total} records{q.isFetching ? " · Updating…" : ""}
                  </p>
                  {canWrite && !sectionType && (
                    <div className="finance-quick-actions">
                      <Link to={financeNewPaths.EXPENSE}>+ Expense</Link>
                      <Link to={financeNewPaths.SUPPLIER_PAYMENT}>
                        + Supplier Payment
                      </Link>
                      <Link to={financeNewPaths.OTHER_OUT}>+ Money Out</Link>
                    </div>
                  )}
                </div>
                <section
                  className="finance-ledger"
                  aria-label="Money records"
                  aria-busy={q.isFetching}
                >
                  {q.data.items.length ? (
                    <Ledger rows={q.data.items} mode={mode} />
                  ) : (
                    <div className="finance-feedback">
                      <h3>
                        No{" "}
                        {mode === "expenses"
                          ? "expenses"
                          : mode === "suppliers"
                            ? "supplier payments"
                            : mode === "income"
                              ? "money received"
                              : "records"}{" "}
                        found
                      </h3>
                      <p>Choose another date or change the filters.</p>
                    </div>
                  )}
                  <footer className="finance-pagination">
                    <p>
                      Page {q.data.page} /{" "}
                      {Math.max(1, Math.ceil(q.data.total / 25))}
                    </p>
                    <div>
                      <Button
                        variant="outline"
                        disabled={q.data.page <= 1 || q.isFetching}
                        onClick={() => apply("page", String(q.data.page - 1))}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        disabled={
                          q.data.page * 25 >= q.data.total || q.isFetching
                        }
                        onClick={() => apply("page", String(q.data.page + 1))}
                      >
                        Next
                      </Button>
                    </div>
                  </footer>
                </section>
              </>
            )}
            {(report || mode === "all") && (
              <p className="finance-footnote">
                Sales is the invoice total for these dates. Net Money is money
                in minus money out.
              </p>
            )}
            {query.status !== "active" && (
              <p className="finance-footnote">
                Totals exclude voided entries. Voided records remain in the list
                for reference.
              </p>
            )}
            {mode === "suppliers" && (
              <p className="finance-footnote">
                These are recorded payments to suppliers. Receiving a purchase
                does not automatically record a payment.
              </p>
            )}
          </>
        )
      )}
      {!canWrite && !report && (
        <p className="finance-footnote">
          You can view records. Ask the owner to add or void a payment.
        </p>
      )}
    </div>
  );
}
