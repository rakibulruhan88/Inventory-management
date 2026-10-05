import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Boxes,
  BarChart3,
  Container,
  LayoutDashboard,
  Menu,
  PackagePlus,
  ReceiptText,
  Settings,
  ShoppingBag,
  Truck,
  Users,
} from "lucide-react";
import { motion } from "motion/react";
import { lazy, Suspense, useEffect, useState } from "react";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useSearchParams,
} from "react-router-dom";
import { GlobalSearch } from "@/components/global-search";
import { LoginPage, Protected, SignOutButton } from "@/features/auth/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { reversePurchase } from "@/lib/api";
import { toast } from "sonner";
import { Drawer } from "vaul";
import {
  getInventoryItems,
  getInventorySummary,
  getPurchases,
  getSales,
  getSettings,
} from "@/lib/api";

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

const nav = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { to: "/inventory", label: "Inventory", icon: Boxes },
  { to: "/purchases", label: "Purchases", icon: PackagePlus },
  { to: "/sales", label: "Sales", icon: ShoppingBag },
  { to: "/customers", label: "Customers", icon: Users },
  { to: "/suppliers", label: "Suppliers", icon: Truck },
  { to: "/containers", label: "Containers", icon: Container },
  { to: "/reports", label: "Reports", icon: BarChart3 },
];
function Shell({ children }: { children: React.ReactNode }) {
  const [online, setOnline] = useState(navigator.onLine);
  const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const name = settings.data?.storeName || "Afia Leather";
  useEffect(() => {
    if (!settings.data) return;
    document.title = `${settings.data.storeName} Inventory`;
    document.documentElement.style.setProperty(
      "--brand-accent",
      settings.data.brandAccent,
    );
    const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (favicon) favicon.href = settings.data.faviconUrl || "/favicon.svg";
  }, [settings.data]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return (
    <div className="min-h-svh bg-[var(--page)] text-[var(--ink)]">
      {!online && (
        <div className="app-chrome fixed inset-x-0 top-0 z-[100] bg-[var(--warning-soft)] px-4 py-2 text-center text-sm font-medium text-[var(--warning)]">
          You’re offline. Sales and stock changes require an internet
          connection.
        </div>
      )}
      <aside className="app-chrome fixed inset-y-0 left-0 z-30 hidden w-66 border-r border-[var(--border)] bg-[var(--sidebar)] px-4 py-6 lg:flex lg:flex-col">
        <div className="flex items-center gap-3 px-2">
          {settings.data?.logoUrl ? (
            <img
              src={settings.data.logoUrl}
              className="size-10 rounded-xl object-contain"
            />
          ) : (
            <div className="grid size-10 place-items-center rounded-lg bg-[image:var(--gradient-primary)] text-lg font-bold text-white shadow-sm">
              {name[0]}
            </div>
          )}
          <div>
            <p className="font-display font-bold text-[var(--foreground)]">
              {name}
            </p>
            <p className="text-xs font-medium text-[var(--muted)]">
              Inventory management
            </p>
          </div>
        </div>
        <nav className="mt-8 space-y-1">
          {nav.map((x) => (
            <NavLink
              key={x.to}
              to={x.to}
              className={({ isActive }) =>
                `flex min-h-11 items-center gap-3 rounded-lg border px-3 text-sm font-medium transition ${isActive ? "border-[var(--primary-border)] bg-[var(--primary-soft)] text-[var(--primary-hover)]" : "border-transparent text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground-secondary)]"}`
              }
            >
              <x.icon className="size-[18px]" />
              {x.label}
            </NavLink>
          ))}
        </nav>
        <NavLink
          to="/settings"
          className="mt-auto flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium text-[var(--muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"
        >
          <Settings className="size-[18px]" /> Settings
        </NavLink>
        <SignOutButton />
      </aside>
      <main className="min-w-0 lg:pl-66">
        <header className="app-chrome sticky top-0 z-20 border-b border-[var(--border)] bg-white/90 px-3 py-3 shadow-[0_1px_2px_rgb(15_23_42/0.03)] backdrop-blur-xl sm:px-4 md:px-7 lg:px-10">
          <div className="mx-auto flex w-full max-w-350 min-w-0 items-center gap-2 sm:gap-3">
            {settings.data?.logoUrl ? (
              <img
                src={settings.data.logoUrl}
                alt={`${name} logo`}
                className="size-9 shrink-0 rounded-lg object-contain sm:size-11 lg:hidden"
              />
            ) : (
              <div
                className="grid size-9 shrink-0 place-items-center rounded-lg bg-[image:var(--gradient-primary)] font-bold text-white shadow-sm sm:size-11 lg:hidden"
                aria-label={name}
              >
                {name[0]}
              </div>
            )}

            <div className="min-w-0 flex-1">
              <GlobalSearch />
            </div>

            <Button
              asChild
              variant="premium"
              className="hidden shrink-0 sm:inline-flex"
            >
              <NavLink to="/sales/new">
                <ReceiptText className="size-4" />
                New Sale
              </NavLink>
            </Button>
          </div>
        </header>

        {children}
      </main>
      <nav className="app-chrome fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-40 grid grid-cols-5 rounded-2xl border border-[var(--border)] bg-white/95 p-1.5 shadow-[0_14px_35px_rgb(15_23_42/0.14)] backdrop-blur-xl lg:hidden">
        {[
          { to: "/dashboard", label: "Home", icon: LayoutDashboard },
          { to: "/purchases/new", label: "Purchase", icon: PackagePlus },
          { to: "/sales/new", label: "Sale", icon: ReceiptText },
          { to: "/inventory", label: "Stock", icon: Boxes },
          { to: "/settings", label: "More", icon: Menu },
        ].map((x) => (
          <NavLink
            key={x.to}
            to={x.to}
            className={({ isActive }) =>
              `flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg text-[11px] font-medium ${isActive ? "bg-[var(--primary-soft)] text-[var(--primary-hover)]" : "text-[var(--muted)]"}`
            }
          >
            <x.icon className="size-[18px]" />
            {x.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function Dashboard() {
  const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const summary = useQuery({
    queryKey: ["inventory-summary"],
    queryFn: getInventorySummary,
  });
  const sales = useQuery({
    queryKey: ["sales", "recent"],
    queryFn: () => getSales(),
  });
  const purchases = useQuery({
    queryKey: ["purchases", "recent"],
    queryFn: () => getPurchases(),
  });
  const stock = useQuery({
    queryKey: ["inventory", "dashboard"],
    queryFn: () => getInventoryItems(),
  });
  const cards = [
    {
      label: "Available Rolls",
      value: summary.data?.totalRolls ?? 0,
      detail: "Ready to sell",
      icon: Boxes,
    },
    {
      label: "Available Meter",
      value: (summary.data?.totalMeters ?? 0).toLocaleString(),
      detail: "Across all colors",
      icon: Container,
    },
    {
      label: "Today’s Sales",
      value: `৳${(summary.data?.todaySales ?? 0).toLocaleString()}`,
      detail: "Completed today",
      icon: ReceiptText,
    },
    {
      label: "Customer Due",
      value: `৳${(summary.data?.totalCustomerDue ?? 0).toLocaleString()}`,
      detail: "Outstanding",
      icon: Users,
    },
  ];
  return (
    <div className="mx-auto max-w-350 px-4 pb-28 pt-7 md:px-7 lg:px-10">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <p className="text-sm font-medium text-[var(--accent)]">
          {new Intl.DateTimeFormat("en-BD", {
            weekday: "long",
            day: "numeric",
            month: "long",
          }).format(new Date())}
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Good morning</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Here’s what needs your attention today.
        </p>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:flex">
          <Button asChild variant="premium" className="h-12 px-5">
            <NavLink to="/sales/new">
              <ReceiptText className="size-5" /> New Sale
            </NavLink>
          </Button>
          <Button asChild className="h-12 px-5" variant="outline">
            <NavLink to="/purchases/new">
              <PackagePlus className="size-5" /> New Purchase
            </NavLink>
          </Button>
        </div>
      </motion.div>
      <section className="mt-7 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {cards.map((c) => (
          <article
            key={c.label}
            className="rounded-xl border border-[var(--border)] bg-white p-4 shadow-[var(--shadow-card)] sm:p-5"
          >
            <span className="grid size-9 place-items-center rounded-lg bg-[var(--primary-soft)] text-[var(--primary)]">
              <c.icon className="size-5" />
            </span>
            <p className="mt-4 text-xs text-[var(--muted)]">{c.label}</p>
            <p className="mt-1 text-xl font-semibold sm:text-2xl">{c.value}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">{c.detail}</p>
          </article>
        ))}
      </section>
      <section className="mt-6 grid gap-4 xl:grid-cols-2">
        <Recent
          title="Recent Sales"
          rows={(sales.data ?? [])
            .slice(0, 4)
            .map((x) => [
              x.invoiceNumber,
              x.customerName,
              `৳${x.totalAmount.toLocaleString()}`,
            ])}
          empty="No sales recorded yet."
        />
        <Recent
          title="Recent Purchases"
          rows={(purchases.data ?? [])
            .slice(0, 4)
            .map((x) => [
              x.purchaseNumber,
              x.containerNumber,
              `${x.totalRolls} Rolls`,
            ])}
          empty="No purchases recorded yet."
        />
      </section>
      <section className="mt-4 rounded-xl border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-card)]">
        <h2 className="font-semibold">Low stock</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {(stock.data ?? [])
            .flatMap((p) =>
              p.variants.map((v) => ({ ...v, itemCode: p.itemCode })),
            )
            .filter(
              (v) =>
                v.totalRolls <= (settings.data?.lowStockRollThreshold ?? 3) ||
                v.totalMeters <= (settings.data?.lowStockMeterThreshold ?? 500),
            )
            .slice(0, 6)
            .map((v) => (
              <div
                key={v.variantId}
                className="flex justify-between rounded-xl bg-[var(--surface-subtle)] p-3 text-sm"
              >
                <span>
                  <strong>{v.itemCode}</strong> · {v.color}
                </span>
                <span className="text-[var(--accent)]">
                  {v.totalRolls} Rolls · {v.totalMeters}m
                </span>
              </div>
            ))}
        </div>
      </section>
    </div>
  );
}
function Recent({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: string[][];
  empty: string;
}) {
  return (
    <article className="rounded-xl border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-card)]">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-3 space-y-2">
        {rows.length ? (
          rows.map((r, i) => (
            <div
              key={i}
              className="grid grid-cols-[1fr_1fr_auto] gap-2 rounded-xl bg-[var(--surface-subtle)] p-3 text-sm"
            >
              <strong>{r[0]}</strong>
              <span className="truncate text-[var(--muted)]">{r[1]}</span>
              <span>{r[2]}</span>
            </div>
          ))
        ) : (
          <p className="py-6 text-center text-sm text-[var(--muted)]">
            {empty}
          </p>
        )}
      </div>
    </article>
  );
}
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
            <Shell>
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
                  <Route path="/dashboard" element={<Dashboard />} />
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
            </Shell>
          </Protected>
        }
      />
    </Routes>
  );
}
