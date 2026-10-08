import type { CSSProperties, ReactNode } from "react";
import type { FinanceSummary } from "@afia/contracts";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cashMoney, methodNames } from "@/features/finance/financial-summary";
import { compactMoney, moneyGroups, percent, percentage, reportColors } from "./report-data";

export function ReportPanel({ title, description, action, children, className = "" }: { title: string; description: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`report-panel ${className}`}><header className="report-panel-header"><div><h2>{title}</h2><p>{description}</p></div>{action}</header>{children}</section>;
}
const tooltipStyle = { border: "1px solid var(--border)", borderRadius: 6, background: "var(--surface)", fontSize: 12, color: "var(--foreground)" };
const tooltipMoney = (value: unknown) => cashMoney(Number(value).toFixed(2));

export function RoundProgress({ value, label, detail, color = reportColors.in }: { value: number | null; label: string; detail: string; color?: string }) {
  const fill = Math.max(0, Math.min(100, value ?? 0));
  return <div className="report-round-row"><div className="report-round" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={fill} aria-valuetext={value === null ? "No money recorded" : percentage(value)}>
    <svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="41" fill="none" stroke="var(--surface-muted)" strokeWidth="7" /><circle cx="50" cy="50" r="41" fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" pathLength="100" strokeDasharray={`${fill} 100`} transform="rotate(-90 50 50)" /></svg><strong>{percentage(value)}</strong>
  </div><div><h3>{label}</h3><p>{detail}</p></div></div>;
}

export function ComparisonChart({ summary, previous }: { summary: FinanceSummary; previous?: FinanceSummary }) {
  const data = (["sales", "moneyIn", "moneyOut"] as const).map((key, index) => ({ name: ["Sales", "Money In", "Money Out"][index], selected: Number(summary[key]), previous: previous ? Number(previous[key]) : undefined }));
  const hasData = data.some((item) => item.selected > 0 || (item.previous ?? 0) > 0);
  return <ReportPanel title="Period overview" description="Invoice sales and recorded money movement">
    <div className="report-chart-legend"><span><i style={{ background: reportColors.out }} />Selected period</span>{previous && <span><i style={{ background: reportColors.previous }} />Previous period</span>}<span className="report-chart-unit">BDT · ৳</span></div>
    {hasData ? <div className="report-chart report-comparison-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{ top: 20, right: 6, left: 0, bottom: 4 }} barGap={6} accessibilityLayer>
      <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" /><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} dy={8} /><YAxis width={65} tickFormatter={compactMoney} axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} /><Tooltip formatter={tooltipMoney} contentStyle={tooltipStyle} cursor={{ fill: "var(--surface-muted)", opacity: 0.5 }} />
      {previous && <Bar dataKey="previous" name="Previous period" fill={reportColors.previous} radius={[3, 3, 0, 0]} maxBarSize={45} isAnimationActive={false} />}<Bar dataKey="selected" name="Selected period" fill={reportColors.out} radius={[3, 3, 0, 0]} maxBarSize={45} isAnimationActive={false} />
    </BarChart></ResponsiveContainer></div> : <div className="report-chart-empty"><h3>No activity in these dates</h3><p>Choose another period to see sales and money movement.</p></div>}
    <details className="report-data-details"><summary>View exact amounts</summary><div className="report-table-wrap"><table><caption className="sr-only">Period overview in BDT</caption><thead><tr><th scope="col">Metric</th><th scope="col">Selected</th>{previous && <th scope="col">Previous</th>}</tr></thead><tbody>{data.map((item) => <tr key={item.name}><th scope="row">{item.name}</th><td>{cashMoney(item.selected.toFixed(2))}</td>{previous && <td>{cashMoney((item.previous ?? 0).toFixed(2))}</td>}</tr>)}</tbody></table></div></details>
  </ReportPanel>;
}

export function MoneyBreakdown({ summary, direction, onDirection, ledgerUrl }: { summary: FinanceSummary; direction: "in" | "out"; onDirection: (direction: "in" | "out") => void; ledgerUrl: (type?: string) => string }) {
  const groups = moneyGroups(summary, direction);
  const total = direction === "in" ? summary.moneyIn : summary.moneyOut;
  const slices = groups.filter((group) => group.value > 0);
  return <ReportPanel title="Where money moves" description="Share of each payment type" action={<div className="report-switch" role="group" aria-label="Money breakdown direction"><button type="button" aria-pressed={direction === "in"} onClick={() => onDirection("in")}>Money In</button><button type="button" aria-pressed={direction === "out"} onClick={() => onDirection("out")}>Money Out</button></div>}>
    <div className="report-donut-layout"><div className="report-donut" role="img" aria-label={`${direction === "in" ? "Money In" : "Money Out"} breakdown. Total ${cashMoney(total)}. Exact amounts listed below.`}>
      {slices.length ? <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={slices} dataKey="value" nameKey="name" innerRadius="72%" outerRadius="90%" paddingAngle={slices.length > 1 ? 3 : 0} stroke="var(--surface)" isAnimationActive={false}>{slices.map((slice) => <Cell key={slice.type} fill={slice.fill} />)}</Pie><Tooltip formatter={tooltipMoney} contentStyle={tooltipStyle} /></PieChart></ResponsiveContainer> : <svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="40" fill="none" stroke="var(--surface-muted)" strokeWidth="9" /></svg>}
      <div className="report-donut-center"><span>Total {direction === "in" ? "received" : "paid"}</span><strong title={cashMoney(total)}>{compactMoney(Number(total))}</strong><span>{slices.length} active types</span></div>
    </div><div className="report-share-list">{groups.map((group) => <Link to={ledgerUrl(group.type)} key={group.type} className="report-share-item"><div><span><i style={{ background: group.fill }} />{group.name}</span><strong>{cashMoney(group.amount)}</strong></div><div className="report-share-bottom"><div className="report-progress-track" role="meter" aria-label={`${group.name} share`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent(group.value, Number(total)) ?? 0} aria-valuetext={Number(total) > 0 ? percentage(percent(group.value, Number(total))) : "No money recorded"}><span style={{ width: `${Math.min(100, percent(group.value, Number(total)) ?? 0)}%`, background: group.fill }} /></div><span>{percentage(percent(group.value, Number(total)))}</span></div></Link>)}</div></div>
    <p className="report-panel-note">{direction === "in" ? "Customer Due Payments shows entire receipts. Old Due Collected is shown separately below." : "Supplier payments are recorded payments, not a remaining supplier balance."}</p>
  </ReportPanel>;
}

export function MethodChart({ summary, ledgerUrl }: { summary: FinanceSummary; ledgerUrl: string }) {
  const data = Object.entries(methodNames).map(([method, name]) => {
    const row = summary.methods.find((item) => item.method === method);
    return { method, name, incoming: Number(row?.moneyIn ?? 0), outgoing: Number(row?.moneyOut ?? 0) };
  });
  const hasData = data.some((row) => row.incoming > 0 || row.outgoing > 0);
  return <ReportPanel title="Payment methods" description="Compare money received and paid by method" action={<Link className="report-text-link" to={ledgerUrl}>View records <ArrowRight size={14} aria-hidden="true" /></Link>}>
    <div className="report-chart-legend"><span><i style={{ background: reportColors.in }} />Money In</span><span><i style={{ background: reportColors.out }} />Money Out</span><span className="report-chart-unit">BDT · ৳</span></div>
    {hasData ? <div className="report-chart report-method-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={data} layout="vertical" margin={{ top: 8, left: 0, right: 20, bottom: 0 }} barGap={3} accessibilityLayer><CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 4" /><XAxis type="number" axisLine={false} tickLine={false} tickFormatter={compactMoney} tick={{ fill: "var(--muted)", fontSize: 11 }} /><YAxis dataKey="name" type="category" axisLine={false} tickLine={false} width={105} tick={{ fill: "var(--foreground-secondary)", fontSize: 12 }} /><Tooltip formatter={tooltipMoney} contentStyle={tooltipStyle} cursor={{ fill: "var(--surface-muted)", opacity: 0.5 }} /><Bar dataKey="incoming" name="Money In" fill={reportColors.in} radius={[0, 3, 3, 0]} maxBarSize={13} isAnimationActive={false} /><Bar dataKey="outgoing" name="Money Out" fill={reportColors.out} radius={[0, 3, 3, 0]} maxBarSize={13} isAnimationActive={false} /></BarChart></ResponsiveContainer></div> : <div className="report-chart-empty"><h3>No payment activity</h3><p>Payment methods appear when money is recorded.</p></div>}
    <details className="report-data-details"><summary>View method totals</summary><div className="report-table-wrap"><table><caption className="sr-only">Payment methods in BDT</caption><thead><tr><th scope="col">Method</th><th scope="col">Money In</th><th scope="col">Money Out</th></tr></thead><tbody>{data.map((row) => <tr key={row.method}><th scope="row">{row.name}</th><td>{cashMoney(row.incoming.toFixed(2))}</td><td>{cashMoney(row.outgoing.toFixed(2))}</td></tr>)}</tbody></table></div></details>
  </ReportPanel>;
}

export function BreakdownTable({ summary, ledgerUrl }: { summary: FinanceSummary; ledgerUrl: (type?: string) => string }) {
  return <ReportPanel title="Detailed breakdown" description="Full totals for the selected dates" action={<Link className="report-text-link" to={ledgerUrl()}>Open cashbook <ArrowRight size={14} aria-hidden="true" /></Link>}><div className="report-table-wrap"><table><caption className="sr-only">Money breakdown with share of each direction</caption><thead><tr><th scope="col">Payment type</th><th scope="col">Direction</th><th scope="col">Share</th><th scope="col">Amount</th><th scope="col"><span className="sr-only">Records</span></th></tr></thead><tbody>{(["in", "out"] as const).flatMap((direction) => moneyGroups(summary, direction).map((group) => <tr key={group.type}><th scope="row"><i className="report-table-dot" style={{ background: group.fill } as CSSProperties} />{group.name}</th><td><span className={`report-direction ${direction}`}>Money {direction === "in" ? "In" : "Out"}</span></td><td>{percentage(percent(group.value, Number(direction === "in" ? summary.moneyIn : summary.moneyOut)))}</td><td className="report-table-amount">{cashMoney(group.amount)}</td><td><Link className="report-text-link" aria-label={`View ${group.name} records`} to={ledgerUrl(group.type)}>View <ArrowRight size={14} aria-hidden="true" /></Link></td></tr>))}</tbody></table></div>{Number(summary.byType.LEGACY_PAYMENT) > 0 && <p className="report-panel-note">Older Payments are included in Money In. Their payment type has not been confirmed.</p>}</ReportPanel>;
}
