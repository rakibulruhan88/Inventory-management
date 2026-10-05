import { useQuery } from "@tanstack/react-query";
import {
  BarChart3, Boxes, Container, LayoutDashboard, Menu, PackagePlus,
  ReceiptText, Settings, ShoppingBag, Truck, Users, X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Drawer } from "vaul";
import { GlobalSearch } from "@/components/global-search";
import { Button } from "@/components/ui/button";
import { SignOutButton } from "@/features/auth/auth";
import { getSettings } from "@/lib/api";

const navigation = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { to: "/inventory", label: "Inventory", icon: Boxes },
  { to: "/purchases", label: "Purchases", icon: PackagePlus },
  { to: "/sales", label: "Sales", icon: ShoppingBag },
  { to: "/customers", label: "Customers", icon: Users },
  { to: "/suppliers", label: "Suppliers", icon: Truck },
  { to: "/containers", label: "Containers", icon: Container },
  { to: "/reports", label: "Reports", icon: BarChart3 },
];

function StoreIdentity({ name, logo }: { name: string; logo?: string | null }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {logo ? (
        <img src={logo} alt={`${name} logo`} className="size-10 shrink-0 object-contain" />
      ) : (
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center border border-[var(--primary-border)] text-xl font-semibold text-[var(--primary)]">
          {name[0]}
        </span>
      )}
      <div className="min-w-0">
        <p className="font-display break-words text-sm font-bold">{name}</p>
        <p className="mt-0.5 text-xs text-[var(--muted)]">Leather & inventory</p>
      </div>
    </div>
  );
}

function WorkspaceNavigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Workspace" className="space-y-1">
      {navigation.map((item, index) => (
        <div key={item.to} className={index === 4 ? "border-t border-[var(--border)] pt-4 mt-4" : ""}>
          <NavLink to={item.to} onClick={onNavigate} className={({ isActive }) =>
            `flex min-h-11 items-center gap-3 rounded-md border-l-2 px-3 text-sm font-medium transition-colors ${isActive ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary-strong)]" : "border-transparent text-[var(--foreground-secondary)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"}`
          }>
            <item.icon aria-hidden="true" className="size-[18px] shrink-0" strokeWidth={1.6} />
            {item.label}
          </NavLink>
        </div>
      ))}
      <NavLink to="/settings" onClick={onNavigate} className={({ isActive }) =>
        `flex min-h-11 items-center gap-3 rounded-md border-l-2 px-3 text-sm font-medium transition-colors ${isActive ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary-strong)]" : "border-transparent text-[var(--foreground-secondary)] hover:bg-[var(--surface-muted)]"}`
      }>
        <Settings aria-hidden="true" className="size-[18px]" strokeWidth={1.6} /> Settings
      </NavLink>
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(navigator.onLine);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const name = settings.data?.storeName || "Afia Leather";
  const moreActive = !["/dashboard", "/inventory", "/purchases/new", "/sales/new"].some((path) => location.pathname.startsWith(path));
  const section = navigation.find((item) => location.pathname.startsWith(item.to))?.label ?? "Settings";
  useEffect(() => {
    if (!settings.data) return;
    document.title = `${settings.data.storeName} Inventory`;
    document.documentElement.style.setProperty("--brand-accent", settings.data.brandAccent);
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
      <a href="#workspace-content" className="app-chrome sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:bg-[var(--surface)] focus:p-3">Skip to content</a>
      <aside aria-label="Store navigation" className="app-chrome fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-[var(--border)] bg-[var(--sidebar)] px-4 py-6 lg:flex">
        <div className="px-2"><StoreIdentity name={name} logo={settings.data?.logoUrl} /></div>
        <div className="mt-8 min-h-0 flex-1 overflow-y-auto">
          <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">Workspace</p>
          <WorkspaceNavigation />
        </div>
        <div className="mt-5 border-t border-[var(--border)] pt-3">
          <SignOutButton />
          <p className="px-3 pt-3 text-xs text-[var(--muted)]">Inventory · Sales · Accounts</p>
        </div>
      </aside>
      <div className="workspace-body min-w-0 lg:pl-60">
        {!online && (
          <div role="status" className="app-chrome border-b border-[var(--border)] bg-[var(--warning-soft)] px-4 py-3 text-sm text-[var(--warning)]">
            You’re offline. Sales and stock changes require an internet connection.
          </div>
        )}
        <header className="app-chrome sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 md:px-7 lg:px-8">
          <div className="mx-auto flex max-w-350 min-w-0 items-center gap-3">
            {section !== "Overview" && <span className="hidden w-36 shrink-0 text-sm font-medium text-[var(--foreground-secondary)] xl:block">{section}</span>}
            {settings.data?.logoUrl && <img src={settings.data.logoUrl} alt={`${name} logo`} className="size-8 shrink-0 object-contain lg:hidden" />}
            <span className="font-display max-w-24 truncate text-sm font-bold sm:max-w-36 lg:hidden" title={name}>{name}</span>
            <div className="min-w-0 flex-1 lg:max-w-xl"><GlobalSearch /></div>
            <Button asChild className="ml-auto hidden shrink-0 sm:inline-flex lg:hidden">
              <NavLink to="/sales/new"><ReceiptText aria-hidden="true" className="size-4" /> New Sale</NavLink>
            </Button>
          </div>
        </header>
        <main id="workspace-content" tabIndex={-1} className="min-w-0 outline-none">{children}</main>
      </div>
      <nav aria-label="Quick navigation" className="app-chrome fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-[var(--border)] bg-[var(--surface)] px-2 pt-1 pb-[max(4px,env(safe-area-inset-bottom))] lg:hidden">
        {[
          { to: "/dashboard", label: "Overview", icon: LayoutDashboard },
          { to: "/purchases/new", label: "Purchase", icon: PackagePlus },
          { to: "/sales/new", label: "Sale", icon: ReceiptText },
          { to: "/inventory", label: "Inventory", icon: Boxes },
        ].map((item) => (
          <NavLink key={item.to} to={item.to} className={({ isActive }) =>
            `flex min-h-14 flex-col items-center justify-center gap-1 border-t-2 text-[11px] font-medium transition-colors ${isActive ? "border-[var(--primary)] text-[var(--primary-strong)]" : "border-transparent text-[var(--muted)] hover:bg-[var(--surface-muted)]"}`
          }>
            <item.icon aria-hidden="true" className="size-[18px]" strokeWidth={1.6} />{item.label}
          </NavLink>
        ))}
        <button type="button" aria-haspopup="dialog" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)} className={`flex min-h-14 flex-col items-center justify-center gap-1 border-t-2 text-[11px] font-medium transition-colors hover:bg-[var(--surface-muted)] ${moreActive ? "border-[var(--primary)] text-[var(--primary-strong)]" : "border-transparent text-[var(--muted)]"}`}>
          <Menu aria-hidden="true" className="size-[18px]" /> More
        </button>
      </nav>
      <Drawer.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="app-chrome fixed inset-0 z-50 bg-black/35" />
          <Drawer.Content className="app-chrome fixed inset-x-0 bottom-0 z-50 max-h-[90svh] overflow-y-auto rounded-t-lg border-t border-[var(--border)] bg-[var(--surface)] p-4 pb-[max(16px,env(safe-area-inset-bottom))] outline-none">
            <div className="mx-auto max-w-lg">
              <div className="mb-4 flex items-center justify-between gap-3">
                <Drawer.Title className="font-display font-semibold">{name}</Drawer.Title>
                <Drawer.Close asChild><Button variant="ghost" size="icon" aria-label="Close navigation"><X className="size-5" /></Button></Drawer.Close>
              </div>
              <Drawer.Description className="sr-only">Navigate your inventory, transactions, contacts, and settings.</Drawer.Description>
              <WorkspaceNavigation onNavigate={() => setMenuOpen(false)} />
              <div className="mt-3 border-t border-[var(--border)] pt-3"><SignOutButton /></div>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  );
}
