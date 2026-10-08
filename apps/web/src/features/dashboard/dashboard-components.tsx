import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function OverviewLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link className="overview-link" to={to}>{children}<ArrowRight size={14} aria-hidden="true" /></Link>;
}
export function OverviewPanel({ title, description, action, children, className = "" }: { title: string; description: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`overview-panel ${className}`}><header className="overview-panel-header"><div><h2>{title}</h2><p>{description}</p></div>{action}</header>{children}</section>;
}
export function OverviewLoading({ rows = 3, chart = false }: { rows?: number; chart?: boolean }) {
  return <div className={`overview-loading ${chart ? "is-chart" : ""}`} role="status"><span className="sr-only">Loading overview data…</span>{Array.from({ length: rows }, (_, index) => <div key={index} aria-hidden="true"><span /><span /></div>)}</div>;
}
export function OverviewError({ title, retry, busy }: { title: string; retry: () => void; busy: boolean }) {
  return <div className="overview-feedback" role="alert"><h3>{title}</h3><p>Check your connection and try again.</p><Button variant="outline" disabled={busy} onClick={retry}>{busy ? "Retrying…" : "Try again"}</Button></div>;
}
export function OverviewEmpty({ title, detail, to, action }: { title: string; detail: string; to?: string; action?: string }) {
  return <div className="overview-feedback"><h3>{title}</h3><p>{detail}</p>{to && action && <OverviewLink to={to}>{action}</OverviewLink>}</div>;
}
