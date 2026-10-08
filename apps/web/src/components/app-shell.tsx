import { useQuery } from "@tanstack/react-query";
import {
  BarChart3, Boxes, Container, LayoutDashboard, Menu, PackagePlus, PanelLeftClose, PanelLeftOpen,
  ReceiptText, WalletCards, Settings, ShoppingBag, Truck, Users, X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Drawer } from "vaul";
import { GlobalSearch } from "@/components/global-search";
import { Button } from "@/components/ui/button";
import { SignOutButton } from "@/features/auth/auth";
import { getAccount, getSettings } from "@/lib/api";
import { useAuth } from "@/features/auth/auth-context";
import "./desktop-sidebar.css";

const navigation = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { to: "/inventory", label: "Inventory", icon: Boxes },
  { to: "/purchases", label: "Purchases", icon: PackagePlus },
  { to: "/sales", label: "Sales", icon: ShoppingBag },
  { to: "/payments", label: "Payments", icon: WalletCards },
  { to: "/cashbook", label: "Cashbook", icon: ReceiptText },
  { to: "/customers", label: "Customers", icon: Users },
  { to: "/suppliers", label: "Suppliers", icon: Truck },
  { to: "/containers", label: "Containers", icon: Container },
  { to: "/reports", label: "Reports", icon: BarChart3 },
];

function StoreIdentity({ name, logo }: { name: string; logo?: string | null }) {
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  return (
    <NavLink to="/dashboard" className="desktop-store-identity" aria-label={`${name} store overview`}>
      <span className="desktop-store-mark">
        {logo && failedLogo !== logo ? <img src={logo} alt="" onError={() => setFailedLogo(logo)} /> : <span aria-hidden="true">{name.slice(0, 1).toUpperCase()}<small>·</small></span>}
      </span>
      <span className="desktop-store-copy"><strong title={name}>{name}</strong><small>Inventory & finance</small></span>
    </NavLink>
  );
}

const desktopGroups = [
  { label: "Workspace", paths: ["/dashboard", "/inventory", "/purchases", "/sales"] },
  { label: "Money records", paths: ["/payments", "/cashbook", "/reports"] },
  { label: "Contacts & stock history", paths: ["/customers", "/suppliers", "/containers"] },
];
function DesktopNavigation() {
  return <nav className="desktop-workspace-nav" aria-label="Workspace">{desktopGroups.map((group) => <div className="desktop-nav-group" key={group.label}><p>{group.label}</p>{group.paths.map((path) => {
    const item = navigation.find((entry) => entry.to === path)!;
    return <NavLink key={item.to} to={item.to} aria-label={item.label} title={item.label} className={({ isActive }) => `desktop-nav-item ${isActive ? "is-active" : ""}`}><item.icon size={17} strokeWidth={1.7} aria-hidden="true" /><span>{item.label}</span><i aria-hidden="true" /></NavLink>;
  })}</div>)}</nav>;
}
function DesktopAccountFooter() {
  const { user } = useAuth();
  const account = useQuery({ queryKey: ["sidebar-account", user?.id], queryFn: getAccount, enabled: !!user });
  const name = account.data?.name || user?.name || user?.username || "Store account";
  const role = user?.role === "OWNER" ? "Owner" : user?.role === "STAFF" ? "Staff" : user?.role || "Account";
  return <div className="desktop-account-footer"><NavLink className="desktop-account-link" to="/settings?section=account" aria-label={`Account settings for ${name}`} title={`${name} · ${role} · Account settings`}><span className="desktop-account-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span><span className="desktop-account-copy"><strong title={name}>{name}</strong><span>{role}</span></span></NavLink><SignOutButton compact /></div>;
}

function WorkspaceNavigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Workspace" className="space-y-1">
      {navigation.map((item) => (
        <div key={item.to} className={item.to === "/customers" ? "border-t border-[var(--border)] pt-4 mt-4" : ""}>
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
  const [sidebarPreference, setSidebarPreference] = useState<"collapsed" | "expanded" | null>(() => {
    try {
      const saved = localStorage.getItem("afia-sidebar-layout");
      return saved === "collapsed" || saved === "expanded" ? saved : null;
    } catch { return null; }
  });
  const [tabletWidth, setTabletWidth] = useState(() => window.matchMedia("(max-width: 1199px)").matches);
  const sidebarCollapsed = sidebarPreference ? sidebarPreference === "collapsed" : tabletWidth;
  const toggleSidebar = () => {
    const next = sidebarCollapsed ? "expanded" : "collapsed";
    setSidebarPreference(next);
    try { localStorage.setItem("afia-sidebar-layout", next); } catch { /* The layout still works when storage is unavailable. */ }
  };
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1199px)");
    const update = () => setTabletWidth(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const location = useLocation();
  const workspaceBody = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (location.pathname !== "/dashboard") return;
    const resetHorizontalScroll = () => {
      if (!window.matchMedia("(max-width: 767px)").matches) return;
      if (document.scrollingElement) document.scrollingElement.scrollLeft = 0;
      document.body.scrollLeft = 0;
      if (workspaceBody.current) workspaceBody.current.scrollLeft = 0;
    };
    resetHorizontalScroll();
    window.addEventListener("resize", resetHorizontalScroll);
    return () => window.removeEventListener("resize", resetHorizontalScroll);
  }, [location.pathname]);
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
    <div data-page={location.pathname === "/dashboard" ? "overview" : undefined} data-sidebar={sidebarCollapsed ? "collapsed" : "expanded"} className="workspace-shell min-h-svh bg-[var(--page)] text-[var(--ink)]">
      <a href="#workspace-content" className="app-chrome sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:bg-[var(--surface)] focus:p-3">Skip to content</a>
      <aside id="store-sidebar" aria-label="Store navigation" className="app-chrome desktop-sidebar fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-[var(--border)] md:flex">
        <div className="desktop-sidebar-header"><StoreIdentity name={name} logo={settings.data?.logoUrl} /></div>
        <div className="desktop-sidebar-scroll"><DesktopNavigation /></div>
        <div className="desktop-sidebar-bottom"><NavLink to="/settings" aria-label="Settings" title="Settings" className={({ isActive }) => `desktop-nav-item desktop-settings-link ${isActive ? "is-active" : ""}`}><Settings size={17} strokeWidth={1.7} aria-hidden="true" /><span>Settings</span><i aria-hidden="true" /></NavLink><DesktopAccountFooter /></div>
      </aside>
      <div ref={workspaceBody} className="workspace-body min-w-0">
        {!online && (
          <div role="status" className="app-chrome border-b border-[var(--border)] bg-[var(--warning-soft)] px-4 py-3 text-sm text-[var(--warning)]">
            You’re offline. Sales and stock changes require an internet connection.
          </div>
        )}
        <header className="app-chrome sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3 md:px-7 lg:px-8">
          <div className="mx-auto flex max-w-350 min-w-0 items-center gap-3">
            <Button variant="ghost" size="icon" className="hidden shrink-0 md:inline-flex" onClick={toggleSidebar} aria-controls="store-sidebar" aria-expanded={!sidebarCollapsed} aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
              {sidebarCollapsed ? <PanelLeftOpen className="size-[18px]" aria-hidden="true" /> : <PanelLeftClose className="size-[18px]" aria-hidden="true" />}
            </Button>
            {section !== "Overview" && <span className="hidden w-36 shrink-0 text-sm font-medium text-[var(--foreground-secondary)] xl:block">{section}</span>}
            <NavLink to="/dashboard" className="mobile-store-brand" aria-label={`${name} overview`}>
              <span className="mobile-store-mark" aria-hidden="true">{settings.data?.logoUrl ? <img src={settings.data.logoUrl} alt="" /> : name.slice(0, 1).toUpperCase()}</span>
              <span className="mobile-store-copy"><strong title={name}>{name}</strong><small>{section}</small></span>
            </NavLink>
            <div className="min-w-0 shrink-0 md:flex-1 lg:max-w-xl"><GlobalSearch compactMobile /></div>
            <Button asChild className="ml-auto hidden shrink-0 sm:inline-flex lg:hidden">
              <NavLink to="/sales/new"><ReceiptText aria-hidden="true" className="size-4" /> New Sale</NavLink>
            </Button>
          </div>
        </header>
        <main id="workspace-content" tabIndex={-1} className="min-w-0 outline-none">{children}</main>
      </div>
      <nav aria-label="Quick navigation" className="app-chrome mobile-quick-nav fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-[var(--border)] bg-[var(--surface)] px-2 pt-1 pb-[max(4px,env(safe-area-inset-bottom))] md:hidden">
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
