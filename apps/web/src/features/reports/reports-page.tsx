import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { ArrowDownLeft, ArrowUpRight, ArrowRight, CalendarDays, Check, Download, RefreshCw, ReceiptText, Scale } from "lucide-react";
import type { FinanceQuery, FinanceSummary } from "@afia/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchablePicker } from "@/components/searchable-picker";
import { getFinance } from "@/lib/api";
import { cashMoney } from "@/features/finance/financial-summary";
import { BreakdownTable, ComparisonChart, MethodChart, MoneyBreakdown, ReportPanel, RoundProgress } from "./report-charts";
import { exportReport, percent, periods, previousWindow, reportColors, reportWindow, windowLabel, type ReportPeriod } from "./report-data";
import "./reports.css";

function Change({ value, previous }: { value: string; previous: string }) {
  const change = Number(value) - Number(previous);
  const base = Number(previous);
  if (change === 0) return <span className="report-change">No change</span>;
  return <span className="report-change">{change > 0 ? <ArrowUpRight size={13} aria-hidden="true" /> : <ArrowDownLeft size={13} aria-hidden="true" />}{base === 0 ? `${cashMoney(Math.abs(change).toFixed(2))} ${change > 0 ? "more" : "less"}` : `${Math.abs(change / Math.abs(base) * 100).toLocaleString("en-BD", { maximumFractionDigits: 1 })}% ${change > 0 ? "higher" : "lower"}`}</span>;
}
function SummaryMetrics({ summary, previous, ledgerUrl }: { summary: FinanceSummary; previous?: FinanceSummary; ledgerUrl: string }) {
  const metrics = [
    { key: "sales", label: "Total Sales", detail: "Completed invoice totals", icon: ReceiptText },
    { key: "moneyIn", label: "Money In", detail: "All recorded money received", icon: ArrowDownLeft },
    { key: "moneyOut", label: "Money Out", detail: "All recorded money paid", icon: ArrowUpRight },
    { key: "netMoney", label: "Net Money", detail: "Money In minus Money Out", icon: Scale },
  ] as const;
  return <dl className="report-metrics" aria-label="Financial totals">{metrics.map(({ key, label, detail, icon: Icon }) => <div key={key} className={`report-metric ${key}`}><dt><span>{label}</span><Icon size={17} aria-hidden="true" /></dt><dd><strong>{cashMoney(summary[key])}</strong>{previous && <Change value={summary[key]} previous={previous[key]} />}<p>{detail}</p>{key === "netMoney" && <Link to={ledgerUrl} className="report-metric-link">View money records <ArrowRight size={13} aria-hidden="true" /></Link>}</dd></div>)}</dl>;
}
function ReportLoading() {
  return <div className="report-loading" role="status"><span className="sr-only">Loading financial report…</span><div className="report-loading-metrics">{[0, 1, 2, 3].map((item) => <div key={item}><span /><strong /><span /></div>)}</div><div className="report-loading-panels"><div /><div /></div></div>;
}

export function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [showDetails, setShowDetails] = useState(false);
  const selected = params.get("date") ?? "month";
  const period: ReportPeriod = periods.find((item) => item.value === selected)?.value ?? "month";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const range = reportWindow(period, from, to);
  const previousRange = previousWindow(period, range);
  const custom = period === "specific" || period === "range";
  const invalid = custom && !range;
  const comparisonEnabled = params.get("compare") !== "off" && !!previousRange;
  // Request authoritative aggregates across the whole period; chart data never comes from paginated rows.
  const query: FinanceQuery = { ...(range ? { date: "range", ...range } : {}), status: "active", page: 1, pageSize: 1 };
  const report = useQuery({ queryKey: ["finance", "report", query], queryFn: () => getFinance(query), enabled: !invalid });
  const previousQuery: FinanceQuery = { date: "range", from: previousRange?.from, to: previousRange?.to, status: "active", page: 1, pageSize: 1 };
  const comparison = useQuery({ queryKey: ["finance", "report", previousQuery], queryFn: () => getFinance(previousQuery), enabled: comparisonEnabled && !invalid });
  const previous = comparisonEnabled && !comparison.isError ? comparison.data?.summary : undefined;
  const apply = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    if (key === "date") { next.delete("from"); next.delete("to"); }
    next.delete("page");
    setParams(next);
  };
  const ledgerUrl = (type?: string) => {
    const filters = new URLSearchParams({ status: "active" });
    if (range) { filters.set("date", "range"); filters.set("from", range.from); filters.set("to", range.to); } else filters.set("date", "all");
    if (type) filters.set("type", type);
    return `/cashbook?${filters}`;
  };
  const refresh = () => { void report.refetch(); if (comparisonEnabled) void comparison.refetch(); };
  const busy = report.isFetching || (comparisonEnabled && comparison.isFetching);
  const canExport = !!report.data && !invalid && !busy && !report.isError && !(comparisonEnabled && comparison.isError);
  const entry = params.get("entry");
  if (entry) return <Navigate to={`/cashbook/entries/${encodeURIComponent(entry)}`} replace />;

  return <div className="reports-page">
    <header className="reports-header"><div><p className="report-eyebrow">Afia Leather / Reports</p><h1>Financial Summary</h1><p>Follow your sales, collections and spending.</p></div><div className="reports-header-actions"><Button variant="outline" disabled={invalid || busy} onClick={refresh} aria-label="Refresh report"><RefreshCw size={15} aria-hidden="true" />{busy ? "Updating…" : "Refresh"}</Button><Button disabled={!canExport} onClick={() => report.data && exportReport(report.data.summary, range, previous, previousRange)}><Download size={15} aria-hidden="true" />Export CSV</Button></div></header>
    <section className="report-toolbar" aria-label="Report period"><div className="report-toolbar-main"><div className="report-date-control"><SearchablePicker label="Report period" placeholder="Choose period" options={[...periods]} value={period} onChange={(value) => apply("date", value)} purchasePresentation triggerClassName="report-period-picker" triggerContent={<><CalendarDays size={16} aria-hidden="true" /><span>{periods.find((item) => item.value === period)?.label}</span><span className="report-picker-arrow">⌄</span></>} /></div><div className="report-period-shortcuts" role="group" aria-label="Quick periods">{(["today", "week", "month"] as const).map((value) => <button type="button" key={value} aria-pressed={period === value} onClick={() => apply("date", value)}>{value === "today" ? "Today" : value === "week" ? "Week" : "Month"}</button>)}</div><Button variant="ghost" className="report-compare-button" disabled={!previousRange} aria-pressed={comparisonEnabled} onClick={() => apply("compare", comparisonEnabled ? "off" : "on")}><span className={`report-checkbox ${comparisonEnabled ? "checked" : ""}`} aria-hidden="true">{comparisonEnabled && <Check size={12} />}</span>Compare previous period</Button></div>
      {custom && <div className="report-custom-dates"><label htmlFor="report-from">{period === "range" ? "From Date" : "Date"}<Input id="report-from" type="date" value={from} aria-invalid={invalid && !!from} aria-describedby={invalid ? "report-date-help" : undefined} onChange={(event) => apply("from", event.target.value)} /></label>{period === "range" && <label htmlFor="report-to">To Date<Input id="report-to" type="date" value={to} min={from || undefined} aria-invalid={invalid && !!to} aria-describedby={invalid ? "report-date-help" : undefined} onChange={(event) => apply("to", event.target.value)} /></label>}</div>}
      <div className="report-period-caption"><p>{invalid ? "Choose your report dates" : windowLabel(range)}<span>Bangladesh time</span></p>{comparisonEnabled && <p>Compared with {windowLabel(previousRange)}</p>}</div>
    </section>
    {invalid ? <div className="report-feedback" id="report-date-help"><h2>Choose valid dates</h2><p>{from && to && from > to ? "To Date must be on or after From Date." : "Select a date or a complete date range to see your report."}</p></div> : report.isPending ? <ReportLoading /> : report.isError ? <div className="report-feedback" role="alert"><h2>Report could not be loaded</h2><p>{report.error.message}</p><Button variant="outline" onClick={refresh} disabled={busy}>Try again</Button></div> : report.data && <div className="report-content" aria-busy={busy}>
      {comparisonEnabled && <div className="report-comparison-status" role={comparison.isError ? "alert" : "status"}>{comparison.isPending ? "Loading previous period…" : comparison.isError ? <><span>Previous period could not be loaded. Current totals are available.</span><Button variant="ghost" onClick={() => void comparison.refetch()} disabled={comparison.isFetching}>Retry comparison</Button></> : <span>Comparison uses complete periods. {period === "month" || period === "week" ? "This period includes future dated records." : ""}</span>}</div>}
      <SummaryMetrics summary={report.data.summary} previous={previous} ledgerUrl={ledgerUrl()} />
      {report.data.total === 0 && Number(report.data.summary.sales) === 0 && <div className="report-empty-notice"><div><h2>No records in this period</h2><p>Choose another period or review your cashbook.</p></div><Button asChild variant="outline"><Link to={ledgerUrl()}>Open cashbook <ArrowRight size={14} aria-hidden="true" /></Link></Button></div>}
      <div className="report-main-grid"><ComparisonChart summary={report.data.summary} previous={previous} /><MoneyBreakdown summary={report.data.summary} direction={direction} onDirection={setDirection} ledgerUrl={ledgerUrl} /></div>
      <div className="report-secondary-grid"><MethodChart summary={report.data.summary} ledgerUrl={ledgerUrl()} /><ReportPanel title="Collection & spending" description="Shares based on recorded money movement" className="report-insights">
        <RoundProgress value={percent(Number(report.data.summary.oldDue), Number(report.data.summary.moneyIn))} label="Old Due Collected" detail="Share of Money In from old due" /><div className="report-insight-amount"><span>Old Due Collected</span><strong>{cashMoney(report.data.summary.oldDue)}</strong></div>
        <RoundProgress value={percent(Number(report.data.summary.byType.EXPENSE), Number(report.data.summary.moneyOut))} label="Expense share" detail="Operating expenses as a share of Money Out" color={reportColors.out} /><div className="report-insight-amount"><span>Recorded expenses</span><strong>{cashMoney(report.data.summary.byType.EXPENSE)}</strong></div>
        <div className="report-insight-footer"><span>Money records in this period</span><strong>{report.data.total.toLocaleString("en-BD")}</strong></div>
      </ReportPanel></div>
      <div className="report-details-toolbar"><div><h2>Explore the numbers</h2><p>Payment types, exact amounts and their source records.</p></div><Button variant="outline" onClick={() => setShowDetails(!showDetails)} aria-expanded={showDetails} aria-controls="report-detailed-breakdown">{showDetails ? "Hide" : "Show"} detailed breakdown</Button></div>
      <div id="report-detailed-breakdown" hidden={!showDetails}>{showDetails && <BreakdownTable summary={report.data.summary} ledgerUrl={ledgerUrl} />}</div>
      <footer className="report-footer"><p>Sales are completed invoice totals. Money In includes sale payments, customer due payments and other receipts.</p><p>Net Money is Money In minus Money Out. It is not profit or a cash balance. Voided entries are excluded.</p></footer>
    </div>}
  </div>;
}
