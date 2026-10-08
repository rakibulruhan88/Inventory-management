import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { getInventoryItems, getInventorySummary, getSettings } from "@/lib/api";
import { OverviewEmpty, OverviewError, OverviewLink, OverviewLoading, OverviewPanel } from "./dashboard-components";
import { overviewNumber } from "./dashboard-data";

export function useOverviewStock() {
  const summary = useQuery({ queryKey: ["inventory-summary"], queryFn: getInventorySummary });
  const stock = useQuery({ queryKey: ["inventory", "dashboard"], queryFn: () => getInventoryItems() });
  const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const rollsLimit = settings.data?.lowStockRollThreshold ?? 3;
  const meterLimit = settings.data?.lowStockMeterThreshold ?? 500;
  const variants = (stock.data ?? []).flatMap((item) => item.variants.map((variant) => ({ ...variant, itemCode: item.itemCode, description: item.description })));
  // Retain the existing Overview's Rolls OR Meter threshold rule, including zero Meter.
  const review = variants.filter((variant) => variant.totalRolls <= rollsLimit || variant.totalMeters <= meterLimit)
    .sort((a, b) => a.totalRolls - b.totalRolls || a.totalMeters - b.totalMeters || a.itemCode.localeCompare(b.itemCode));
  const noRolls = review.filter((variant) => variant.totalRolls === 0).length;
  return { summary, stock, settings, variants, review, noRolls, low: review.length - noRolls, above: variants.length - review.length, rollsLimit, meterLimit,
    pending: stock.isPending || settings.isPending,
    error: stock.isError || settings.isError,
    busy: stock.isFetching || settings.isFetching,
    retry: () => { void stock.refetch(); void settings.refetch(); },
  };
}
type StockData = ReturnType<typeof useOverviewStock>;

export function StockSnapshot({ data }: { data: StockData }) {
  const { summary } = data;
  const total = data.variants.length;
  const states = [
    { name: "Above limits", value: data.above, color: "var(--success)" },
    { name: "Low stock", value: data.low, color: "var(--primary)" },
    { name: "No Rolls", value: data.noRolls, color: "var(--danger)" },
  ];
  let offset = 0;
  return <OverviewPanel title="Stock on hand" description="Current inventory · all containers" action={<OverviewLink to="/inventory">Inventory</OverviewLink>} className="overview-stock-snapshot">
    {summary.isError ? <OverviewError title="Stock totals could not be updated" retry={() => void summary.refetch()} busy={summary.isFetching} /> : summary.isPending ? <OverviewLoading rows={2} /> : summary.data && <>
      <div className="overview-stock-total"><span>Available Rolls</span><strong>{overviewNumber(summary.data.totalRolls)}<small>Rolls</small></strong><p>{overviewNumber(summary.data.totalMeters)} Meter tracked</p></div>
      <dl className="overview-stock-facts"><div><dt>Item codes</dt><dd>{overviewNumber(summary.data.totalItems)}</dd></div><div><dt>Open Rolls</dt><dd>{overviewNumber(summary.data.openRolls)}</dd></div><div><dt>Today’s Sales</dt><dd className="money">৳{overviewNumber(summary.data.todaySales)}</dd></div></dl>
    </>}
    <div className="overview-stock-health"><h3>Color variant stock health</h3>{data.error ? <OverviewError title="Stock health could not be updated" retry={data.retry} busy={data.busy} /> : data.pending ? <OverviewLoading rows={1} /> : total === 0 ? <OverviewEmpty title="No inventory yet" detail="Receive a purchase to add your item codes and colors." to="/purchases/new" action="New Purchase" /> : <>
      <div className="overview-health-layout"><div className="overview-health-ring" role="img" aria-label={`${data.above} color variants above limits, ${data.low} low stock, ${data.noRolls} with no Rolls. ${total} total.`}><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="40" fill="none" stroke="var(--surface-muted)" strokeWidth="8" />{states.filter((state) => state.value > 0).map((state) => {
        const share = state.value / total * 100;
        const start = offset;
        offset += share;
        return <circle key={state.name} cx="50" cy="50" r="40" fill="none" stroke={state.color} strokeWidth="8" pathLength="100" strokeDasharray={`${Math.max(0, share - (share < 100 ? 1.4 : 0))} 100`} strokeDashoffset={-start} transform="rotate(-90 50 50)" />;
      })}</svg><div><strong>{Math.round(data.above / total * 100)}%</strong><span>above limits</span></div></div><dl className="overview-health-legend">{states.map((state) => <div key={state.name}><dt><i style={{ background: state.color }} />{state.name}</dt><dd>{overviewNumber(state.value)}</dd></div>)}</dl></div>
      <p className="overview-health-note">{overviewNumber(total)} color variants · Limits: {overviewNumber(data.rollsLimit)} Rolls / {overviewNumber(data.meterLimit)} Meter</p>
    </>}</div>
  </OverviewPanel>;
}

export function StockReview({ data }: { data: StockData }) {
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<"all" | "empty">("all");
  const term = search.trim().toLocaleLowerCase();
  const matching = data.review.filter((variant) => (scope !== "empty" || variant.totalRolls === 0) && (!term || `${variant.itemCode} ${variant.color} ${variant.description ?? ""}`.toLocaleLowerCase().includes(term)));
  return <OverviewPanel title="Stock to review" description="Lowest Rolls first · current stock" action={<OverviewLink to="/inventory">All inventory</OverviewLink>} className="overview-stock-review">
    <div className="overview-stock-toolbar"><div className="overview-segment" role="group" aria-label="Stock review status"><button type="button" aria-pressed={scope === "all"} onClick={() => setScope("all")}>To review {!data.pending && !data.error && <span>{data.review.length}</span>}</button><button type="button" aria-pressed={scope === "empty"} onClick={() => setScope("empty")}>No Rolls {!data.pending && !data.error && <span>{data.noRolls}</span>}</button></div><label className="overview-stock-search"><span className="sr-only">Search stock by item code, color or description</span><Search size={15} aria-hidden="true" /><Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Item code or color…" maxLength={150} />{search && <button type="button" aria-label="Clear stock search" onClick={() => setSearch("")}><X size={14} aria-hidden="true" /></button>}</label></div>
    {data.error ? <OverviewError title="Stock review could not be updated" retry={data.retry} busy={data.busy} /> : data.pending ? <OverviewLoading rows={5} /> : !matching.length ? <OverviewEmpty title={search ? "No matching stock" : data.variants.length === 0 ? "No inventory yet" : scope === "empty" ? "No colors with zero Rolls" : "All stock is above your limits"} detail={search ? "Try another item code, color or description." : "Change the view or open inventory to see all colors."} to="/inventory" action="View inventory" /> : <>
      <div className="overview-table-scroll"><table className="overview-stock-table"><caption className="sr-only">Stock to review, showing {Math.min(5, matching.length)} of {matching.length} matching color variants.</caption><thead><tr><th scope="col">Item / Color</th><th scope="col">Rolls</th><th scope="col">Meter</th><th scope="col">Review</th></tr></thead><tbody>{matching.slice(0, 5).map((variant) => {
        const state = variant.totalRolls === 0 ? "No Rolls" : variant.totalRolls <= data.rollsLimit ? "Low Rolls" : "Low Meter";
        return <tr key={variant.variantId}><th scope="row"><Link to={`/inventory?search=${encodeURIComponent(variant.itemCode)}`}>{variant.itemCode}</Link><p>{variant.color}</p></th><td><strong>{overviewNumber(variant.totalRolls)}</strong><div className="overview-stock-bar" role="meter" aria-label={`${variant.itemCode} ${variant.color}: Rolls relative to review limit`} aria-valuemin={0} aria-valuemax={Math.max(1, data.rollsLimit)} aria-valuenow={Math.min(variant.totalRolls, Math.max(1, data.rollsLimit))} aria-valuetext={`${variant.totalRolls} Rolls; review limit ${data.rollsLimit} Rolls`}><span style={{ width: `${Math.min(100, variant.totalRolls / Math.max(1, data.rollsLimit) * 100)}%`, background: state === "No Rolls" ? "var(--danger)" : "var(--primary)" }} /></div></td><td>{overviewNumber(variant.totalMeters)}</td><td><span className={`overview-badge ${state === "No Rolls" ? "danger" : "warning"}`}>{state}</span></td></tr>;
      })}</tbody></table></div>
      <p className="overview-panel-footnote">Showing {Math.min(5, matching.length)} of {matching.length} matching variants · At or below either stock limit</p>
    </>}
  </OverviewPanel>;
}
