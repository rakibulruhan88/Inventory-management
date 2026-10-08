import { lazy, Suspense } from "react";
import { useQuery, useQueryClient, useIsFetching } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Banknote, BookOpen, ChartNoAxesCombined, Package, PackagePlus, ReceiptText, RefreshCw, Scale } from "lucide-react";
import type { FinanceSummary } from "@afia/contracts";
import { Button } from "@/components/ui/button";
import { getFinance } from "@/lib/api";
import { cashMoney } from "@/features/finance/financial-summary";
import { OverviewError, OverviewLink, OverviewLoading, OverviewPanel } from "./dashboard-components";
import { financeLink, overviewKey, overviewPeriods, overviewPrevious, overviewQuery, overviewRangeLabel, overviewWindow, type OverviewPeriod } from "./dashboard-data";
import { StockReview, StockSnapshot, useOverviewStock } from "./dashboard-stock";
import { CustomerDue, RecentRecords } from "./dashboard-records";
import "./dashboard.css";

const DashboardTrend = lazy(() => import("./dashboard-trend").then((module) => ({ default: module.DashboardTrend })));

function FinancialMetrics({ summary, previous, previousError, comparisonBusy }: { summary: FinanceSummary; previous?: FinanceSummary; previousError: boolean; comparisonBusy: boolean }) {
  const metrics = [
    { key: "sales", label: "Total Sales", description: "Completed invoice totals", icon: ReceiptText },
    { key: "moneyIn", label: "Money In", description: "Recorded money received", icon: ArrowDownLeft },
    { key: "moneyOut", label: "Money Out", description: "Recorded money paid", icon: ArrowUpRight },
    { key: "netMoney", label: "Net Money", description: "Money In minus Money Out", icon: Scale },
  ] as const;
  return <dl className="overview-financial-metrics" aria-label="Selected period financial totals">{metrics.map(({ key, label, description, icon: Icon }) => {
    const delta = previous ? Number(summary[key]) - Number(previous[key]) : null;
    const base = previous ? Number(previous[key]) : 0;
    const change = delta === null ? null : delta === 0 ? "No change" : base === 0 ? `${cashMoney(Math.abs(delta).toFixed(2))} ${delta > 0 ? "more" : "less"}` : `${Math.abs(delta / Math.abs(base) * 100).toLocaleString("en-BD", { maximumFractionDigits: 1 })}% ${delta > 0 ? "higher" : "lower"}`;
    return <div key={key} className={`overview-financial-metric ${key}`}><dt>{label}<Icon size={17} aria-hidden="true" /></dt><dd><strong>{cashMoney(summary[key])}</strong><span className="overview-metric-change">{delta !== null && delta !== 0 && (delta > 0 ? <ArrowUpRight size={13} aria-hidden="true" /> : <ArrowDownLeft size={13} aria-hidden="true" />)}{previousError ? "Comparison unavailable" : comparisonBusy && !previous ? "Loading comparison…" : change ?? "—"}</span><p>{description}</p></dd></div>;
  })}</dl>;
}

function CollectionMix({ summary, range }: { summary: FinanceSummary; range: ReturnType<typeof overviewWindow> }) {
  const incoming = Number(summary.moneyIn);
  const types = [
    { type: "SALE_PAYMENT", label: "Sale Payments", color: "var(--success)" },
    { type: "DUE_PAYMENT", label: "Customer Due Payments", color: "var(--primary)" },
    { type: "OTHER_IN", label: "Other Money In", color: "var(--warning)" },
    ...(Number(summary.byType.LEGACY_PAYMENT) > 0 ? [{ type: "LEGACY_PAYMENT" as const, label: "Older Payments", color: "var(--muted)" }] : []),
  ] as const;
  return <OverviewPanel title="Money received" description={`Sources of Money In · ${overviewRangeLabel(range)}`} action={<OverviewLink to={financeLink("/cashbook/money-in", range)}>Details</OverviewLink>} className="overview-collection-mix">
    <dl className="overview-mix-list">{types.map((source) => {
      const amount = summary.byType[source.type];
      const share = incoming > 0 ? Number(amount) / incoming * 100 : 0;
      return <div key={source.type}><dt><i style={{ background: source.color }} />{source.label}</dt><dd><strong>{cashMoney(amount)}</strong><div className="overview-mix-progress" role="meter" aria-label={`${source.label} share of Money In`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, share)} aria-valuetext={incoming > 0 ? `${share.toFixed(1)} percent` : "No Money In recorded"}><span style={{ width: `${Math.min(100, share)}%`, background: source.color }} /></div><span>{incoming > 0 ? `${share.toLocaleString("en-BD", { maximumFractionDigits: 1 })}%` : "—"}</span></dd></div>;
    })}</dl>
    <div className="overview-old-due"><span>Old Due Collected</span><strong>{cashMoney(summary.oldDue)}</strong></div><p className="overview-panel-footnote">Old Due Collected is part of Money In. Customer Due Payments shows full receipts.</p>
  </OverviewPanel>;
}

export function DashboardPage() {
  const [params, setParams] = useSearchParams();
  const period: OverviewPeriod = overviewPeriods.find((item) => item.value === params.get("period"))?.value ?? "week";
  const range = overviewWindow(period);
  const previousRange = overviewPrevious(period, range);
  const finance = useQuery({ queryKey: overviewKey(range), queryFn: () => getFinance(overviewQuery(range)), staleTime: 60000 });
  const previous = useQuery({ queryKey: overviewKey(previousRange), queryFn: () => getFinance(overviewQuery(previousRange)), staleTime: 60000 });
  const stockData = useOverviewStock();
  const queryClient = useQueryClient();
  const isOverviewQuery = (key: readonly unknown[]) => key.includes("dashboard") || key[0] === "inventory-summary" || key[0] === "settings";
  const busy = useIsFetching({ predicate: (query) => isOverviewQuery(query.queryKey) }) > 0;
  const refresh = () => { void queryClient.refetchQueries({ predicate: (query) => isOverviewQuery(query.queryKey), type: "active" }); };
  const updatePeriod = (value: OverviewPeriod) => { const next = new URLSearchParams(params); next.set("period", value); setParams(next); };
  const dateLabel = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dhaka" }).format(new Date());
  const timestamp = finance.dataUpdatedAt ? new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Dhaka" }).format(finance.dataUpdatedAt) : null;

  return <div className="overview-page">
    <header className="overview-header"><div><p className="overview-eyebrow">AFIA LEATHER / OVERVIEW</p><h1>Store overview</h1><p>{dateLabel}<span>Bangladesh time</span></p></div><div className="overview-header-actions"><Button variant="outline" size="icon" onClick={refresh} disabled={busy} aria-label={busy ? "Updating overview" : "Refresh overview"}><RefreshCw size={16} aria-hidden="true" /></Button><Button asChild variant="outline"><Link to="/purchases/new"><PackagePlus size={16} aria-hidden="true" />New Purchase</Link></Button><Button asChild><Link to="/sales/new"><ReceiptText size={16} aria-hidden="true" />New Sale</Link></Button></div></header>
    <nav className="overview-quick-actions" aria-label="Shop shortcuts">{[
      { to: "/cashbook/receive-payment", title: "Receive Payment", detail: "Collect customer due", icon: Banknote },
      { to: "/inventory", title: "Inventory", detail: "Items, colors & containers", icon: Package },
      { to: "/cashbook", title: "Cashbook", detail: "Money records & expenses", icon: BookOpen },
      { to: "/reports", title: "Reports", detail: "Explore business numbers", icon: ChartNoAxesCombined },
    ].map(({ to, title, detail, icon: Icon }) => <Link key={to} to={to}><Icon size={18} aria-hidden="true" /><div><strong>{title}</strong><span>{detail}</span></div><ArrowUpRight size={15} aria-hidden="true" /></Link>)}</nav>
    <section className="overview-performance-section" aria-label="Period financial summary"><div className="overview-period-toolbar"><div><h2>Your business at a glance</h2><p>{overviewRangeLabel(range)}<span>Compare: {overviewRangeLabel(previousRange)}</span></p></div><div className="overview-segment" role="group" aria-label="Overview financial period">{overviewPeriods.map((item) => <button type="button" key={item.value} aria-pressed={period === item.value} onClick={() => updatePeriod(item.value)}>{item.label}</button>)}</div></div>
      {finance.isError ? <OverviewError title="Financial totals could not be updated" busy={finance.isFetching} retry={() => void finance.refetch()} /> : finance.isPending ? <OverviewLoading rows={4} /> : finance.data && <FinancialMetrics summary={finance.data.summary} previous={previous.isError ? undefined : previous.data?.summary} previousError={previous.isError} comparisonBusy={previous.isPending} />}
      <div className="overview-period-note"><p>{period === "month" ? "Whole calendar months, including future dated records." : "Complete days in Bangladesh time."} Net Money is not profit or a cash balance.</p><span role="status">{busy ? "Updating…" : timestamp ? `Updated ${timestamp}` : ""}</span>{previous.isError && <Button variant="ghost" disabled={previous.isFetching} onClick={() => void previous.refetch()}>Retry comparison</Button>}</div>
    </section>
    <div className="overview-main-grid"><Suspense fallback={<OverviewPanel title="Business performance" description="Loading sales and money movement"><OverviewLoading chart /></OverviewPanel>}><DashboardTrend range={range} /></Suspense><StockSnapshot data={stockData} /></div>
    <div className="overview-section-heading"><div><h2>Needs your attention</h2><p>Current stock and unpaid customer balances.</p></div>{!stockData.pending && !stockData.error && <span className={`overview-attention-label ${stockData.review.length ? "warning" : "success"}`}>{stockData.review.length ? `${stockData.review.length} stock variants to review` : stockData.variants.length ? "Stock above review limits" : "No inventory yet"}</span>}</div>
    <div className="overview-attention-grid"><StockReview data={stockData} /><CustomerDue /></div>
    <div className="overview-bottom-grid"><RecentRecords />{finance.isError ? <OverviewPanel title="Money received" description="Sources of Money In"><OverviewError title="Collection totals could not be updated" retry={() => void finance.refetch()} busy={finance.isFetching} /></OverviewPanel> : finance.isPending ? <OverviewPanel title="Money received" description="Sources of Money In"><OverviewLoading /></OverviewPanel> : finance.data && <CollectionMix summary={finance.data.summary} range={range} />}</div>
    <footer className="overview-footer"><p>Stock and customer due show current balances. Performance follows your selected dates; latest records show all dates.</p><Link to={financeLink("/reports", range)}>Explore Financial Summary <ArrowRight size={14} aria-hidden="true" /></Link></footer>
  </div>;
}
