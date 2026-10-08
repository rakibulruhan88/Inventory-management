import { FinanceCreatePage } from "@/features/finance/finance-create-page";
import { FinanceDetailPage } from "@/features/finance/finance-detail-page";
import { CashbookPage } from "@/features/finance/cashbook-page";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useSearchParams,
} from "react-router-dom";
import { AppShell } from "@/components/app-shell";
import { DashboardPage } from "@/features/dashboard/dashboard-page";
import { LoginPage, Protected } from "@/features/auth/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { reversePurchase } from "@/lib/api";
import { toast } from "sonner";
import { Drawer } from "vaul";
import { getPurchases } from "@/lib/api";

const InventoryPage = lazy(() =>
  import("@/features/inventory/inventory-page").then((m) => ({
    default: m.InventoryPage,
  })),
);
const PurchaseReceivePage = lazy(() =>
  import("@/features/purchases/purchase-receive-page").then((m) => ({
    default: m.PurchaseReceivePage,
  })),
);
const PurchaseDetailsPage = lazy(() => import("@/features/purchases/purchase-details-page").then(m => ({ default: m.PurchaseDetailsPage })));
const NewSalePage = lazy(() =>
  import("@/features/sales/new-sale-page").then((m) => ({
    default: m.NewSalePage,
  })),
);
const SaleInvoicePage = lazy(() =>
  import("@/features/sales/sale-invoice-page").then((m) => ({
    default: m.SaleInvoicePage,
  })),
);
const SettingsPage = lazy(() =>
  import("@/features/settings/settings-page").then((m) => ({
    default: m.SettingsPage,
  })),
);
const ReportsPage = lazy(() =>
  import("@/features/reports/reports-page").then((m) => ({
    default: m.ReportsPage,
  })),
);
const CustomerCreatePage = lazy(() => import("@/features/payments/opening-due-page").then(m => ({ default: m.CustomerCreatePage })));
const ActivityPage = lazy(() => import("@/features/activity/activity-page").then(m => ({ default: m.ActivityPage })));
const CustomersPage = lazy(() =>
  import("@/features/records/records-pages").then((m) => ({
    default: m.CustomersPage,
  })),
);
const OpeningDuePage = lazy(() => import("@/features/payments/opening-due-page").then(m => ({default: m.OpeningDuePage})));
const PaymentsPage = lazy(() => import("@/features/payments/payments-page").then(m => ({ default: m.PaymentsPage })));
const ReceivePaymentPage = lazy(() => import("@/features/records/receive-payment-page").then(m => ({ default: m.ReceivePaymentPage })));
const PaymentReceiptPage = lazy(() => import("@/features/records/payment-receipt-page").then(m => ({ default: m.PaymentReceiptPage })));
const CustomerDetailPage = lazy(() =>
  import("@/features/records/customer-account-page").then((m) => ({
    default: m.CustomerDetailPage,
  })),
);
const ContainersPage = lazy(() =>
  import("@/features/records/records-pages").then((m) => ({
    default: m.ContainersPage,
  })),
);
const SalesPage = lazy(() =>
  import("@/features/sales/sales-page").then((m) => ({
    default: m.SalesPage,
  })),
);
const SuppliersPage = lazy(() =>
  import("@/features/suppliers/suppliers-page").then((m) => ({
    default: m.SuppliersPage,
  })),
);
const SupplierDetailPage = lazy(() =>
  import("@/features/suppliers/suppliers-page").then((m) => ({
    default: m.SupplierDetailPage,
  })),
);

function PurchasesPage() {
  const [params] = useSearchParams();
  const search = params.get("search") ?? "";
  const queryClient = useQueryClient();
  const [correcting, setCorrecting] = useState<{
    id: string;
    number: string;
  } | null>(null);
  const [reason, setReason] = useState("");
  const q = useQuery({
    queryKey: ["purchases", search],
    queryFn: () => getPurchases(search),
  });
  const reverse = useMutation({
    mutationFn: () => reversePurchase(correcting!.id, reason),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["purchases"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory"] }),
      ]);
      setCorrecting(null);
      setReason("");
      toast.success("Purchase reversed and stock history recorded");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <div className="mx-auto max-w-350 px-4 pb-28 pt-6 md:px-7 lg:px-8 lg:pb-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-semibold tracking-tight">Purchases</h1><p className="mt-1 text-sm text-[var(--muted)]">Stock receipts, suppliers, and container records.</p></div>
        <Button asChild><NavLink to="/purchases/new">New Purchase</NavLink></Button>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--muted)]">
        <p>{q.isLoading ? "Loading receipts…" : q.isError ? "Receipts unavailable" : `${q.data?.length ?? 0} ${q.data?.length === 1 ? "receipt" : "receipts"}`}</p>
        {search && <div className="flex min-w-0 flex-wrap items-center gap-3"><span className="break-words">Matching “{search}”</span><NavLink className="inline-flex min-h-11 items-center font-semibold text-[var(--primary)] hover:underline" to="/purchases">Clear search</NavLink></div>}
      </div>
      <section aria-label="Purchase receipts" aria-busy={q.isLoading} className="mt-3 border border-[var(--border)] bg-[var(--surface)]">
        <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_5rem_7rem_9rem] items-center gap-3 border-b border-[var(--border)] bg-[var(--page)] px-4 py-3 text-xs font-medium text-[var(--muted)] md:grid">
          <span>Reference / Invoice</span><span>Supplier / Container</span><span className="text-right">Rolls</span><span className="text-right">Meter</span><span className="text-right">Receipt status</span>
        </div>
        {q.isError ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-4 px-4 py-8"><div><h2 className="text-sm font-semibold">Purchase receipts could not be loaded</h2><p className="mt-1 text-sm text-[var(--muted)]">Check your connection and try again.</p></div><Button variant="outline" disabled={q.isFetching} onClick={() => void q.refetch()}>{q.isFetching ? "Retrying…" : "Try again"}</Button></div>
        ) : q.isLoading ? (
          <div role="status"><span className="sr-only">Loading purchase receipts…</span>{[0, 1, 2, 3].map((row) => <div key={row} aria-hidden="true" className="flex min-h-20 items-center justify-between gap-4 border-b border-[var(--border)] px-4 last:border-0"><div className="h-3 w-1/3 rounded-sm bg-[var(--surface-muted)]" /><div className="h-4 w-20 rounded-sm bg-[var(--surface-muted)]" /></div>)}</div>
        ) : q.data?.length ? (
          <ul>
            {q.data.map((x) => (
              <li key={x.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-[var(--border)] px-4 py-3 last:border-0 hover:bg-[var(--page)] md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_5rem_7rem_9rem]">
                <div className="min-w-0"><NavLink className="break-words text-sm font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-[var(--primary)]" to={`/purchases/${x.id}`}>{x.purchaseNumber}</NavLink><p className="mt-1 break-words text-xs text-[var(--muted)] md:hidden">{x.supplierName} · {x.containerNumber}</p></div>
                <div className="hidden min-w-0 md:block"><p className="break-words text-sm">{x.supplierName}</p><p className="mt-1 break-words text-xs text-[var(--muted)]">{x.containerNumber}</p></div>
                <div className="max-w-32 break-words text-right tabular-nums md:hidden"><p className="text-sm font-semibold">{x.totalRolls} <span className="text-xs font-normal text-[var(--muted)]">Rolls</span></p><p className="mt-1 text-xs text-[var(--muted)]">{x.totalMeters.toLocaleString()} Meter</p></div>
                <p className="hidden break-words text-right text-sm font-medium tabular-nums md:block">{x.totalRolls}<span className="sr-only"> Rolls</span></p>
                <p className="hidden break-words text-right text-sm tabular-nums md:block">{x.totalMeters.toLocaleString()}<span className="sr-only"> Meter</span></p>
                <div className="col-span-2 flex items-center justify-between border-t border-[var(--border)] pt-1 md:col-span-1 md:justify-end md:border-t-0 md:pt-0">
                  {x.status === "RECEIVED" ? <><span className="text-xs text-[var(--muted)] md:hidden">Received</span><Button variant="ghost" className="px-2 text-xs" onClick={() => setCorrecting({ id: x.id, number: x.purchaseNumber })}>Correct / Reverse</Button></> : <span className="py-2 text-xs font-medium text-[var(--danger)]">Reversed</span>}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-4 py-8"><h2 className="text-sm font-semibold">{search ? "No matching purchases" : "No purchases recorded yet"}</h2><p className="mt-1 text-sm text-[var(--muted)]">{search ? "Clear the search to see all purchase receipts." : "Receive a purchase to record a supplier, container, and incoming stock."}</p><Button asChild variant="outline" className="mt-4"><NavLink to={search ? "/purchases" : "/purchases/new"}>{search ? "Clear search" : "New Purchase"}</NavLink></Button></div>
        )}
      </section>
      <Drawer.Root
        open={!!correcting}
        onOpenChange={(open) => !open && setCorrecting(null)}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-50 bg-black/35" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[90svh] overflow-y-auto rounded-t-lg border-t border-[var(--border)] bg-[var(--surface)] p-5 pb-[max(20px,env(safe-area-inset-bottom))]">
            <div className="mx-auto max-w-lg">
              <Drawer.Title className="text-lg font-semibold">
                Reverse {correcting?.number}?
              </Drawer.Title>
              <Drawer.Description className="mt-2 text-sm text-[var(--muted)]">
                This is only allowed if none of its stock has been sold or
                adjusted. Otherwise use Stock Adjustment.
              </Drawer.Description>
              <label className="mt-4 block text-sm font-medium">
                Correction reason *
                <Input
                  className="mt-2"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <Button
                variant="danger"
                className="mt-5 w-full"
                disabled={reason.trim().length < 2 || reverse.isPending}
                onClick={() => reverse.mutate()}
              >
                {reverse.isPending ? "Reversing…" : "Reverse Purchase"}
              </Button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  );
}
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="*"
        element={
          <Protected>
            <AppShell>
              <Suspense
                fallback={
                  <div className="grid min-h-80 place-items-center text-sm text-[var(--muted)]">
                    Loading…
                  </div>
                }
              >
                <Routes>
                  <Route
                    path="/"
                    element={<Navigate to="/dashboard" replace />}
                  />
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/inventory" element={<InventoryPage />} />
                  <Route path="/purchases" element={<PurchasesPage />} />
                  <Route path="/purchases/:id" element={<PurchaseDetailsPage />} />
                  <Route
                    path="/purchases/new"
                    element={<PurchaseReceivePage />}
                  />
                  <Route path="/sales" element={<SalesPage />} />
                  <Route path="/sales/new" element={<NewSalePage />} />
                  <Route
                    path="/sales/:id/invoice"
                    element={<SaleInvoicePage />}
                  />
                  <Route path="/cashbook" element={<CashbookPage />} />
                  <Route path="/cashbook/money-in" element={<CashbookPage />} />
                  <Route path="/cashbook/expenses" element={<CashbookPage />} />
                  <Route path="/cashbook/supplier-payments" element={<CashbookPage />} />
                  <Route path="/cashbook/money-out" element={<CashbookPage />} />
                  <Route path="/cashbook/money-in/new" element={<FinanceCreatePage type="OTHER_IN" />} />
                  <Route path="/cashbook/expenses/new" element={<FinanceCreatePage type="EXPENSE" />} />
                  <Route path="/cashbook/supplier-payments/new" element={<FinanceCreatePage type="SUPPLIER_PAYMENT" />} />
                  <Route path="/cashbook/money-out/new" element={<FinanceCreatePage type="OTHER_OUT" />} />
                  <Route path="/cashbook/entries/:entryId" element={<FinanceDetailPage />} />
                  <Route path="/cashbook/receive-payment" element={<PaymentsPage cashbook />} />
                  <Route path="/cashbook/receive-payment/add-old-customer" element={<OpeningDuePage cashbook />} />
                  <Route path="/payments" element={<PaymentsPage />} />
                  <Route path="/payments/add-customer" element={<OpeningDuePage />} />
                  <Route path="/customers/:id/opening-due" element={<OpeningDuePage />} />
                  <Route path="/customers/:id/receive-payment" element={<ReceivePaymentPage />} />
                  <Route path="/customers/:id/receipts/:receiptId" element={<PaymentReceiptPage />} />
                  <Route path="/customers" element={<CustomersPage />} />
                  <Route path="/customers/new" element={<CustomerCreatePage />} />
                  <Route
                    path="/customers/:id"
                    element={<CustomerDetailPage />}
                  />
                  <Route path="/suppliers" element={<SuppliersPage />} />
                  <Route
                    path="/suppliers/:id"
                    element={<SupplierDetailPage />}
                  />
                  <Route path="/containers" element={<ContainersPage />} />
                  <Route path="/reports" element={<ReportsPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/activity" element={<ActivityPage />} />
                  <Route
                    path="*"
                    element={<Navigate to="/dashboard" replace />}
                  />
                </Routes>
              </Suspense>
            </AppShell>
          </Protected>
        }
      />
    </Routes>
  );
}
