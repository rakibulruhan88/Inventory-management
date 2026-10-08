import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowUpRight, ReceiptText, PackagePlus } from "lucide-react";
import { getOutstandingCustomers, getPurchases, getSalesLedger } from "@/lib/api";
import { OverviewEmpty, OverviewError, OverviewLink, OverviewLoading, OverviewPanel } from "./dashboard-components";
import { overviewMoney, overviewNumber, recordDate } from "./dashboard-data";

export function CustomerDue() {
  const due = useQuery({ queryKey: ["customers", "payments", "outstanding", "dashboard"], queryFn: () => getOutstandingCustomers({ page: 1, pageSize: 4 }) });
  return <OverviewPanel title="Customer due" description="Current balances · highest due first" action={<OverviewLink to="/payments">All customers</OverviewLink>} className="overview-customer-due">
    {due.isError ? <OverviewError title="Customer due could not be updated" retry={() => void due.refetch()} busy={due.isFetching} /> : due.isPending ? <OverviewLoading rows={4} /> : due.data && <>
      <div className="overview-due-total"><div><span>Total Due</span><strong>{overviewMoney(due.data.totalOutstanding)}</strong></div><p>{overviewNumber(due.data.total)} {due.data.total === 1 ? "customer" : "customers"} with due</p></div>
      {due.data.items.length ? <ul className="overview-due-list">{due.data.items.map((customer) => <li key={customer.id}>
        <div className="overview-due-customer"><div><Link to={`/customers/${customer.id}`} className="overview-customer-name">{customer.name}</Link><p>{customer.phone || "No phone saved"}</p></div><strong>{overviewMoney(customer.totalDue)}</strong></div>
        <div className="overview-due-progress" role="meter" aria-label={`${customer.name}: share of total customer due`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={due.data.totalOutstanding > 0 ? Math.min(100, customer.totalDue / due.data.totalOutstanding * 100) : 0}><span style={{ width: `${due.data.totalOutstanding > 0 ? Math.min(100, customer.totalDue / due.data.totalOutstanding * 100) : 0}%` }} /></div>
        <div className="overview-due-source"><span>Oldest due · {recordDate(customer.oldestDueInvoice.soldAt)}</span><Link to={`/customers/${customer.id}/receive-payment`}>Receive Payment <ArrowUpRight size={13} aria-hidden="true" /></Link></div>
      </li>)}</ul> : <OverviewEmpty title="No customer due" detail="No outstanding Sales or Opening Due balances." to="/customers" action="View customers" />}
      {due.data.items.length > 0 && <p className="overview-panel-footnote">Bars show each customer’s share of Total Due · Includes Opening Due</p>}
    </>}
  </OverviewPanel>;
}

export function RecentRecords() {
  const [view, setView] = useState<"sales" | "purchases">("sales");
  const sales = useQuery({ queryKey: ["sales", "dashboard", "recent"], queryFn: () => getSalesLedger({ page: 1, pageSize: 5, sort: "newest" }), enabled: view === "sales" });
  const purchases = useQuery({ queryKey: ["purchases", "dashboard", "recent"], queryFn: () => getPurchases(), enabled: view === "purchases" });
  const query = view === "sales" ? sales : purchases;
  const empty = view === "sales" ? !sales.data?.items.length : !purchases.data?.length;
  return <OverviewPanel title="Latest records" description="Most recently recorded · all dates" action={<div className="overview-segment" role="group" aria-label="Recent records"><button type="button" aria-pressed={view === "sales"} onClick={() => setView("sales")}><ReceiptText size={14} aria-hidden="true" />Sales</button><button type="button" aria-pressed={view === "purchases"} onClick={() => setView("purchases")}><PackagePlus size={14} aria-hidden="true" />Purchases</button></div>} className="overview-recent-records">
    {query.isError ? <OverviewError title="Recent records could not be updated" retry={() => void query.refetch()} busy={query.isFetching} /> : query.isPending ? <OverviewLoading rows={5} /> : empty ? <OverviewEmpty title={`No ${view} recorded yet`} detail={view === "sales" ? "Create a sale to start your invoice ledger." : "Receive a purchase to add stock and container history."} to={view === "sales" ? "/sales/new" : "/purchases/new"} action={view === "sales" ? "New Sale" : "New Purchase"} /> : <>
      {view === "sales" ? <div className="overview-table-scroll"><table className="overview-recent-table"><caption className="sr-only">Latest recorded sale invoices</caption><thead><tr><th scope="col">Invoice / Customer</th><th scope="col">Date</th><th scope="col">Total</th><th scope="col">Due / Status</th><th scope="col"><span className="sr-only">Open invoice</span></th></tr></thead><tbody>{sales.data?.items.map((sale) => <tr key={sale.id}><th scope="row"><Link to={`/sales/${sale.id}/invoice`}>{sale.invoiceNumber}</Link><p>{sale.customerName}</p></th><td>{recordDate(sale.soldAt)}</td><td>{overviewMoney(sale.totalAmount)}</td><td>{sale.status === "VOIDED" ? <span className="overview-badge neutral">Voided</span> : sale.dueAmount > 0 ? <span className="overview-sale-due">{overviewMoney(sale.dueAmount)} due</span> : <span className="overview-badge success">Paid</span>}</td><td><Link className="overview-row-open" to={`/sales/${sale.id}/invoice`} aria-label={`Open invoice ${sale.invoiceNumber}`}><ArrowUpRight size={16} aria-hidden="true" /></Link></td></tr>)}</tbody></table></div> : <div className="overview-table-scroll"><table className="overview-recent-table"><caption className="sr-only">Latest recorded purchases</caption><thead><tr><th scope="col">Purchase / Supplier</th><th scope="col">Container</th><th scope="col">Rolls / Meter</th><th scope="col">Date / Status</th><th scope="col"><span className="sr-only">Open purchase</span></th></tr></thead><tbody>{purchases.data?.slice(0, 5).map((purchase) => <tr key={purchase.id}><th scope="row"><Link to={`/purchases/${purchase.id}`}>{purchase.purchaseNumber}</Link><p>{purchase.supplierName}</p></th><td className="overview-container-cell">{purchase.containerNumber}</td><td><strong>{overviewNumber(purchase.totalRolls)} Rolls</strong><p>{overviewNumber(purchase.totalMeters)} Meter</p></td><td>{recordDate(purchase.purchasedAt)}{purchase.status === "REVERSED" && <p><span className="overview-badge neutral">Reversed</span></p>}</td><td><Link className="overview-row-open" to={`/purchases/${purchase.id}`} aria-label={`Open purchase ${purchase.purchaseNumber}`}><ArrowUpRight size={16} aria-hidden="true" /></Link></td></tr>)}</tbody></table></div>}
      <div className="overview-records-footer"><p>Showing {view === "sales" ? sales.data?.items.length : Math.min(5, purchases.data?.length ?? 0)} latest records</p><OverviewLink to={view === "sales" ? "/sales" : "/purchases"}>{view === "sales" ? "All sales" : "All purchases"}</OverviewLink></div>
    </>}
  </OverviewPanel>;
}
