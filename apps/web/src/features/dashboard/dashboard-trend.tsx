import { useId, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getFinance } from "@/lib/api";
import { cashMoney } from "@/features/finance/financial-summary";
import { OverviewEmpty, OverviewError, OverviewLink, OverviewLoading, OverviewPanel } from "./dashboard-components";
import { chartMoney, financeLink, overviewKey, overviewQuery, overviewRangeLabel, trendWindows, type OverviewWindow } from "./dashboard-data";

export function DashboardTrend({ range }: { range: OverviewWindow }) {
  const [view, setView] = useState<"sales" | "money">("sales");
  const fillId = useId().replaceAll(":", "");
  const windows = trendWindows(range);
  const queries = useQueries({ queries: windows.map((window) => ({
    queryKey: overviewKey(window), queryFn: () => getFinance(overviewQuery(window)), staleTime: 60000,
  })) });
  const pending = queries.some((query) => query.isPending);
  const error = queries.some((query) => query.isError);
  const busy = queries.some((query) => query.isFetching);
  const data = windows.map((window, index) => ({
    name: window.label, dates: overviewRangeLabel(window),
    sales: Number(queries[index].data?.summary.sales ?? 0),
    incoming: Number(queries[index].data?.summary.moneyIn ?? 0),
    outgoing: Number(queries[index].data?.summary.moneyOut ?? 0),
  }));
  const hasActivity = data.some((row) => view === "sales" ? row.sales > 0 : row.incoming > 0 || row.outgoing > 0);
  const tooltipStyle = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, color: "var(--foreground)" };
  const common = { data, margin: { top: 16, right: 20, left: 0, bottom: 0 }, accessibilityLayer: true };
  const axes = <><CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 5" /><XAxis dataKey="name" axisLine={false} tickLine={false} minTickGap={20} tick={{ fill: "var(--muted)", fontSize: 11 }} dy={8} /><YAxis width={68} axisLine={false} tickLine={false} tickFormatter={chartMoney} tick={{ fill: "var(--muted)", fontSize: 11 }} /><Tooltip contentStyle={tooltipStyle} formatter={(value) => cashMoney(Number(value).toFixed(2))} /></>;

  return <OverviewPanel title="Business performance" description={`${overviewRangeLabel(range)} · ${windows.length > 1 ? windows[0].from === windows[0].to ? "Daily totals" : "Grouped date totals" : "Day total"} · BDT`} action={<div className="overview-segment" role="group" aria-label="Performance chart"><button type="button" aria-pressed={view === "sales"} onClick={() => setView("sales")}>Sales</button><button type="button" aria-pressed={view === "money"} onClick={() => setView("money")}>Money movement</button></div>} className="overview-trend">
    <div className="overview-chart-meta"><div className="overview-legend">{view === "sales" ? <span><i className="sales" />Completed sales</span> : <><span><i className="in" />Money In</span><span><i className="out" />Money Out</span></>}</div><OverviewLink to={financeLink("/reports", range)}>Full report</OverviewLink></div>
    {error ? <OverviewError title="Performance chart could not be updated" busy={busy} retry={() => queries.forEach((query) => { void query.refetch(); })} /> : pending ? <OverviewLoading chart /> : !hasActivity ? <OverviewEmpty title={view === "sales" ? "No completed sales in this period" : "No money movement in this period"} detail="Try another period or open your records." to={financeLink("/cashbook", range)} action="View records" /> : <div className="overview-chart" aria-busy={busy}><ResponsiveContainer width="100%" height="100%">
      {view === "money" || data.length === 1 ? <BarChart {...common} barGap={4}>{axes}{view === "sales" ? <Bar dataKey="sales" name="Sales" fill="var(--primary)" radius={[3, 3, 0, 0]} maxBarSize={56} isAnimationActive={false} /> : <><Bar dataKey="incoming" name="Money In" fill="var(--success)" radius={[3, 3, 0, 0]} maxBarSize={32} isAnimationActive={false} /><Bar dataKey="outgoing" name="Money Out" fill="var(--primary)" radius={[3, 3, 0, 0]} maxBarSize={32} isAnimationActive={false} /></>}</BarChart> : <AreaChart {...common}><defs><linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--primary)" stopOpacity={0.15} /><stop offset="100%" stopColor="var(--primary)" stopOpacity={0.01} /></linearGradient></defs>{axes}<Area type="linear" dataKey="sales" name="Sales" stroke="var(--primary)" fill={`url(#${fillId})`} strokeWidth={2.5} dot={{ r: 3, fill: "var(--surface)", stroke: "var(--primary)", strokeWidth: 2 }} activeDot={{ r: 5 }} isAnimationActive={false} /></AreaChart>}
    </ResponsiveContainer></div>}
    {!error && !pending && <details className="overview-chart-details"><summary>View exact amounts</summary><div className="overview-table-scroll"><table><caption className="sr-only">Performance totals for each date group in BDT</caption><thead><tr><th scope="col">Dates</th><th scope="col">Sales</th><th scope="col">Money In</th><th scope="col">Money Out</th></tr></thead><tbody>{data.map((row) => <tr key={row.dates}><th scope="row">{row.dates}</th><td>{cashMoney(row.sales.toFixed(2))}</td><td>{cashMoney(row.incoming.toFixed(2))}</td><td>{cashMoney(row.outgoing.toFixed(2))}</td></tr>)}</tbody></table></div></details>}
  </OverviewPanel>;
}
