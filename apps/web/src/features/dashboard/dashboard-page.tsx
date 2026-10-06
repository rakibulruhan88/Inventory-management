import { useQuery } from "@tanstack/react-query";
import { ArrowRight, PackagePlus, ReceiptText } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  getInventoryItems, getInventorySummary, getPurchases, getSales, getSettings,
} from "@/lib/api";

const number = (value: number) => value.toLocaleString("en-BD");
const money = (value: number) => `৳${number(value)}`;

function SectionLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to} className="inline-flex min-h-11 shrink-0 items-center gap-2 text-xs font-semibold text-[var(--primary)] transition-colors hover:text-[var(--primary-strong)]">{children}<ArrowRight aria-hidden="true" className="size-3.5" /></Link>;
}

function LoadingRows() {
  return (
    <div role="status" className="px-4 sm:px-5">
      <span className="sr-only">Loading records…</span>
      {[0, 1, 2, 3].map((row) => (
        <div key={row} aria-hidden="true" className="flex min-h-18 items-center justify-between gap-4 border-t border-[var(--border)]">
          <div className="w-1/2 space-y-2"><div className="h-3 w-2/3 rounded-sm bg-[var(--surface-muted)]" /><div className="h-3 w-full rounded-sm bg-[var(--surface-muted)]" /></div>
          <div className="h-4 w-16 rounded-sm bg-[var(--surface-muted)]" />
        </div>
      ))}
    </div>
  );
}

function QueryError({ title, retry, busy }: { title: string; retry: () => void; busy: boolean }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-6 sm:px-5">
      <div><p className="text-sm font-medium">{title}</p><p className="mt-1 text-xs text-[var(--muted)]">Check your connection and try again.</p></div>
      <Button variant="outline" disabled={busy} onClick={retry}>{busy ? "Retrying…" : "Try again"}</Button>
    </div>
  );
}

function EmptyRecords({ title, detail, to, action }: { title: string; detail: string; to: string; action: string }) {
  return (
    <div className="border-t border-[var(--border)] px-4 py-6 sm:px-5">
      <p className="text-sm font-medium">{title}</p><p className="mt-1 text-sm text-[var(--muted)]">{detail}</p>
      <div className="mt-2"><SectionLink to={to}>{action}</SectionLink></div>
    </div>
  );
}

function LedgerPanel({ title, detail, to, action, children }: { title: string; detail: string; to: string; action: string; children: ReactNode }) {
  return (
    <section className="min-w-0 border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-center justify-between gap-x-3 px-4 py-3 sm:px-5">
        <div><h2 className="text-base font-semibold">{title}</h2><p className="mt-1 text-xs text-[var(--muted)]">{detail}</p></div>
        <SectionLink to={to}>{action}</SectionLink>
      </div>
      {children}
    </section>
  );
}

function InventorySummary() {
  const summary = useQuery({ queryKey: ["inventory-summary"], queryFn: getInventorySummary });
  const metrics = [
    { label: "Available Rolls", value: summary.data && number(summary.data.totalRolls), detail: "Ready to sell", to: "/inventory" },
    { label: "Available Meter", value: summary.data && number(summary.data.totalMeters), detail: "Tracked stock length", to: "/inventory" },
    { label: "Today’s Sales", value: summary.data && money(summary.data.todaySales), detail: "Sales total for today", to: "/sales" },
    { label: "Customer Due", value: summary.data && money(summary.data.totalCustomerDue), detail: "Outstanding balance", to: "/customers" },
  ];
  return (
    <section aria-label="Store summary" className="border border-[var(--border)] bg-[var(--surface)]">
      {summary.isError && <QueryError title="Store summary could not be updated" retry={() => void summary.refetch()} busy={summary.isFetching} />}
      <dl aria-busy={summary.isPending} className="grid grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric, index) => (
          <div key={metric.label} className={`min-w-0 px-4 py-5 sm:px-5 ${index % 2 ? "border-l border-[var(--border)]" : ""} ${index > 1 ? "border-t border-[var(--border)] xl:border-t-0 xl:border-l" : ""}`}>
            <dt className="text-xs font-medium text-[var(--muted)]">{metric.label}</dt>
            <dd className="mt-2">
              {summary.isPending ? <div role="status" className="my-1 h-7 w-24 max-w-full rounded-sm bg-[var(--surface-muted)]"><span className="sr-only">Loading {metric.label}</span></div> :
                <Link to={metric.to} className="block w-fit max-w-full break-words text-2xl font-semibold tracking-tight tabular-nums transition-colors hover:text-[var(--primary)] sm:text-3xl">{metric.value ?? "—"}</Link>}
              <p className="mt-2 text-xs text-[var(--muted)]">{metric.detail}</p>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function LowStockTable() {
  const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const stock = useQuery({ queryKey: ["inventory", "dashboard"], queryFn: () => getInventoryItems() });
  // Preserve the existing overview's Rolls / Meter threshold behavior.
  const lowStock = (stock.data ?? []).flatMap((item) => item.variants.map((variant) => ({ ...variant, itemCode: item.itemCode })))
    .filter((variant) => variant.totalRolls <= (settings.data?.lowStockRollThreshold ?? 3) || variant.totalMeters <= (settings.data?.lowStockMeterThreshold ?? 500));
  const pending = stock.isPending || settings.isPending;
  const error = stock.isError || settings.isError;
  return (
    <LedgerPanel title="Stock to review" detail="Color variants at or below your low-stock limits" to="/inventory" action="View inventory">
      {error ? <QueryError title="Low-stock records could not be updated" retry={() => { void stock.refetch(); void settings.refetch(); }} busy={stock.isFetching || settings.isFetching} /> : pending ? <LoadingRows /> : lowStock.length ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">Low-stock color variants: showing {Math.min(lowStock.length, 6)} of {lowStock.length}.</caption>
              <thead className="border-y border-[var(--border)] bg-[var(--page)] text-[11px] font-medium text-[var(--muted)]">
                <tr><th scope="col" className="px-4 py-3 sm:px-5">Item / Color</th><th scope="col" className="px-3 py-3 text-right">Rolls</th><th scope="col" className="px-4 py-3 text-right sm:px-5">Meter</th></tr>
              </thead>
              <tbody>
                {lowStock.slice(0, 6).map((variant) => (
                  <tr key={variant.variantId} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--page)]">
                    <td className="px-4 py-3 sm:px-5"><Link className="font-semibold text-[var(--primary)] hover:underline" to={`/inventory?search=${encodeURIComponent(variant.itemCode)}`}>{variant.itemCode}</Link><p className="mt-1 break-words text-xs text-[var(--muted)]">{variant.color}</p></td>
                    <td className="px-3 py-3 text-right font-medium tabular-nums">{number(variant.totalRolls)}</td>
                    <td className="px-4 py-3 text-right tabular-nums sm:px-5">{number(variant.totalMeters)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--muted)] sm:px-5">Showing {Math.min(lowStock.length, 6)} of {number(lowStock.length)} variants · Limits: {number(settings.data?.lowStockRollThreshold ?? 3)} Rolls / {number(settings.data?.lowStockMeterThreshold ?? 500)} Meter</p>
        </>
      ) : <EmptyRecords title="No low-stock variants" detail="All variants are above your current low-stock limits." to="/inventory" action="Review stock" />}
    </LedgerPanel>
  );
}

function RecentSales() {
  const sales = useQuery({ queryKey: ["sales", "recent"], queryFn: () => getSales() });
  return (
    <LedgerPanel title="Recent sales" detail="Latest invoices and customer records" to="/sales" action="All sales">
      {sales.isError ? <QueryError title="Recent sales could not be updated" retry={() => void sales.refetch()} busy={sales.isFetching} /> : sales.isPending ? <LoadingRows /> : sales.data?.length ? (
        <ul className="border-t border-[var(--border)]">
          {sales.data.slice(0, 4).map((sale) => (
            <li key={sale.id} className="border-b border-[var(--border)] last:border-0">
              <Link to={`/sales/${sale.id}/invoice`} className="flex min-h-20 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-[var(--page)] sm:px-5">
                <div className="min-w-0 flex-1 basis-36"><p className="break-words text-sm font-semibold">{sale.invoiceNumber}</p><p className="mt-1 break-words text-xs text-[var(--muted)]">{sale.customerName}</p></div>
                <div className="text-right"><p className="text-sm font-medium tabular-nums">{money(sale.totalAmount)}</p><p className="mt-1 text-xs text-[var(--muted)]">{sale.status === "VOIDED" ? "Voided" : sale.dueAmount > 0 ? `${money(sale.dueAmount)} due` : "Paid"}</p></div>
              </Link>
            </li>
          ))}
        </ul>
      ) : <EmptyRecords title="No sales recorded yet" detail="Create a sale to start your invoice ledger." to="/sales/new" action="New Sale" />}
    </LedgerPanel>
  );
}

function RecentPurchases() {
  const purchases = useQuery({ queryKey: ["purchases", "recent"], queryFn: () => getPurchases() });
  return (
    <LedgerPanel title="Recent purchases" detail="Latest receipts and container records" to="/purchases" action="All purchases">
      {purchases.isError ? <QueryError title="Recent purchases could not be updated" retry={() => void purchases.refetch()} busy={purchases.isFetching} /> : purchases.isPending ? <LoadingRows /> : purchases.data?.length ? (
        <ul className="border-t border-[var(--border)]">
          {purchases.data.slice(0, 4).map((purchase) => (
            <li key={purchase.id} className="border-b border-[var(--border)] last:border-0">
              <Link to={`/purchases?search=${encodeURIComponent(purchase.purchaseNumber)}`} className="flex min-h-20 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-[var(--page)] sm:px-5">
                <div className="min-w-0 flex-1 basis-36"><p className="break-words text-sm font-semibold">{purchase.purchaseNumber}</p><p className="mt-1 break-words text-xs text-[var(--muted)]">{purchase.supplierName} · {purchase.containerNumber}</p></div>
                <div className="text-right"><p className="text-sm font-medium tabular-nums">{number(purchase.totalRolls)} Rolls</p><p className="mt-1 text-xs text-[var(--muted)]">{purchase.status === "REVERSED" ? "Reversed" : `${number(purchase.totalMeters)} Meter`}</p></div>
              </Link>
            </li>
          ))}
        </ul>
      ) : <EmptyRecords title="No purchases recorded yet" detail="Receive a purchase to add stock and container history." to="/purchases/new" action="New Purchase" />}
    </LedgerPanel>
  );
}

export function DashboardPage() {
  return (
    <div className="mx-auto max-w-350 px-4 pt-6 pb-28 md:px-7 lg:px-8 lg:pb-10">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs text-[var(--muted)]">{new Intl.DateTimeFormat("en-BD", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Dhaka" }).format(new Date())}</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Store overview</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">Stock on hand, transactions, and balances.</p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Button asChild variant="outline" className="flex-1 sm:flex-none"><Link to="/purchases/new"><PackagePlus aria-hidden="true" className="size-4" />New Purchase</Link></Button>
          <Button asChild className="flex-1 sm:flex-none"><Link to="/sales/new"><ReceiptText aria-hidden="true" className="size-4" />New Sale</Link></Button>
        </div>
      </div>
      <InventorySummary />
      <div className="mt-6"><LowStockTable /></div>
      <div className="mt-6 grid items-start gap-6 xl:grid-cols-2"><RecentSales /><RecentPurchases /></div>
    </div>
  );
}
