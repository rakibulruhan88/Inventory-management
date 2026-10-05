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
const CustomersPage = lazy(() =>
  import("@/features/records/records-pages").then((m) => ({
    default: m.CustomersPage,
  })),
);
const CustomerDetailPage = lazy(() =>
  import("@/features/records/records-pages").then((m) => ({
    default: m.CustomerDetailPage,
  })),
);
const ContainersPage = lazy(() =>
  import("@/features/records/records-pages").then((m) => ({
    default: m.ContainersPage,
  })),
);
const SalesPage = lazy(() =>
  import("@/features/records/records-pages").then((m) => ({
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
    <div className="mx-auto max-w-350 px-4 pb-28 pt-7 md:px-7 lg:px-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-3xl font-semibold">Purchases</h1>
        <Button asChild>
          <NavLink to="/purchases/new">New Purchase</NavLink>
        </Button>
      </div>
      <div className="mt-6 space-y-3">
        {q.data?.map((x) => (
          <article
            key={x.id}
            className="grid gap-3 rounded-xl border border-[var(--border)] bg-white p-4 shadow-[var(--shadow-card)] transition hover:border-[var(--primary-border)] sm:grid-cols-[1fr_1.5fr_auto_auto] sm:items-center"
          >
            <strong>{x.purchaseNumber}</strong>
            <span className="text-[var(--muted)]">
              {x.supplierName} · {x.containerNumber}
            </span>
            <span>
              {x.totalRolls} Rolls · {x.totalMeters.toLocaleString()} Meter
            </span>
            {x.status === "RECEIVED" ? (
              <Button
                variant="ghost"
                onClick={() =>
                  setCorrecting({ id: x.id, number: x.purchaseNumber })
                }
              >
                Correct / Reverse
              </Button>
            ) : (
              <span className="rounded-full bg-[var(--danger-soft)] px-2.5 py-1 text-xs font-medium text-[var(--danger)]">
                Reversed
              </span>
            )}
          </article>
        ))}
      </div>
      <Drawer.Root
        open={!!correcting}
        onOpenChange={(open) => !open && setCorrecting(null)}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-[2px]" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-[var(--border)] bg-white p-5 shadow-[var(--shadow-float)]">
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
                Reverse Purchase
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
                  <Route path="/customers" element={<CustomersPage />} />
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
