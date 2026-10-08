import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { activityCategories } from "@afia/contracts";
import type { ActivityRow } from "@afia/contracts";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Filter,
  History,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Drawer } from "vaul";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchablePicker } from "@/components/searchable-picker";
import { useAuth } from "@/features/auth/auth-context";
import { getActivity, getActivityDetail, getActivityOptions } from "@/lib/api";
import { ActivityDetails } from "./activity-details";
import {
  activityDateLabel,
  activityDateRange,
  activityFilters,
  activityMoney,
  activityTime,
} from "./activity-domain";
import "./activity.css";

function ActivityEvent({
  event,
  selected,
  open,
}: {
  event: ActivityRow;
  selected: boolean;
  open: () => void;
}) {
  const attention = [
    "SALE_VOIDED",
    "PURCHASE_REVERSED",
    "FINANCIAL_ENTRY_VOIDED",
    "INVOICE_EMAIL_FAILED",
    "RECORD_ARCHIVED",
  ].includes(event.action);
  return (
    <li className={`activity-event ${selected ? "is-selected" : ""}`}>
      <time dateTime={event.createdAt} className="activity-event-time">
        <strong>{activityTime(event.createdAt)}</strong>
        <span>{activityDateLabel(event.createdAt)}</span>
      </time>
      <div className="activity-event-main">
        <button
          type="button"
          className={`activity-event-title ${attention ? "needs-attention" : ""}`}
          onClick={open}
          aria-expanded={selected}
        >
          {event.title}
        </button>
        <p>
          <span className="activity-category">{event.category}</span>
          {event.label && <span>{event.label}</span>}
        </p>
      </div>
      <div className="activity-event-person">
        <span>{event.actor?.name ?? "Not recorded"}</span>
        <small>
          {event.actor?.role === "OWNER"
            ? "Owner"
            : event.actor?.role === "STAFF"
              ? "Staff"
              : "Older activity"}
        </small>
      </div>
      <div className="activity-event-record">
        <span>{event.reference}</span>
        {event.amount !== null && (
          <strong>{activityMoney(event.amount)}</strong>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="activity-event-open"
        aria-label={`View ${event.title} details`}
        onClick={open}
      >
        <ChevronRight size={17} />
      </Button>
    </li>
  );
}
function ActivityWorkspace() {
  const [params, setParams] = useSearchParams();
  const filters = activityFilters(params);
  const [search, setSearch] = useState(filters.search ?? "");
  const [advanced, setAdvanced] = useState(false);
  const [live, setLive] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [desktop, setDesktop] = useState(
    () => window.matchMedia("(min-width: 1440px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1440px)");
    const update = () => setDesktop(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const update = (values: Record<string, string | undefined>) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("page");
      for (const [key, value] of Object.entries(values)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    });
  useEffect(() => {
    setSearch(filters.search ?? "");
  }, [filters.search]);
  useEffect(() => {
    if (search === (params.get("search") ?? "")) return;
    const timer = window.setTimeout(
      () =>
        setParams(
          (current) => {
            const next = new URLSearchParams(current);
            next.delete("page");
            if (search.trim()) next.set("search", search.trim());
            else next.delete("search");
            return next;
          },
          { replace: true },
        ),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [search, params, setParams]);
  const list = useQuery({
    queryKey: ["activity", filters],
    queryFn: () => getActivity(filters),
    placeholderData: keepPreviousData,
    refetchInterval: live ? 30000 : false,
  });
  const options = useQuery({
    queryKey: ["activity-options"],
    queryFn: getActivityOptions,
    staleTime: 30000,
  });
  const detail = useQuery({
    queryKey: ["activity-detail", selected],
    queryFn: () => getActivityDetail(selected!),
    enabled: !!selected,
  });
  const filterCount = [
    filters.category,
    filters.action,
    filters.actorId,
    filters.from,
    filters.to,
  ].filter(Boolean).length;
  const grouped = new Map<string, ActivityRow[]>();
  list.data?.items.forEach((event) => {
    const day = activityDateLabel(event.createdAt);
    grouped.set(day, [...(grouped.get(day) ?? []), event]);
  });
  const hasFilters = Boolean(filters.search || filterCount);
  const preset =
    params.get("period") ?? (filters.from || filters.to ? "custom" : "all");
  const detailContent = selected ? (
    detail.isLoading ? (
      <div className="activity-state" role="status">
        Loading activity details…
      </div>
    ) : detail.isError ? (
      <div className="activity-state" role="alert">
        <h2>Details could not be loaded</h2>
        <p>{detail.error.message}</p>
        <Button variant="outline" onClick={() => void detail.refetch()}>
          Try again
        </Button>
      </div>
    ) : detail.data ? (
      <ActivityDetails event={detail.data} close={() => setSelected(null)} />
    ) : null
  ) : (
    <div className="activity-inspector-empty">
      <History size={22} strokeWidth={1.5} />
      <h2>Every record has a story</h2>
      <p>
        Choose an activity to see who did it, the saved details, and what
        changed.
      </p>
      <span>Activity is saved by the server.</span>
    </div>
  );
  return (
    <div className="activity-page">
      <header className="activity-header">
        <div>
          <p className="activity-eyebrow">STORE HISTORY</p>
          <h1>Activity</h1>
          <p>Follow every recorded change, from stock to money.</p>
        </div>
        <div className="activity-header-actions">
          <span className="activity-owner">
            <ShieldCheck size={14} /> Owner only
          </span>
          <Button
            variant="outline"
            disabled={list.isFetching}
            onClick={() => void list.refetch()}
          >
            <RefreshCw
              size={15}
              className={list.isFetching ? "animate-spin" : ""}
            />{" "}
            Refresh
          </Button>
        </div>
      </header>
      <section
        className="activity-summary"
        aria-label="Activity summary for the current filters"
      >
        {(
          [
            ["Activities", list.data?.summary.total],
            ["Changes", list.data?.summary.changes],
            ["Voids / Archives", list.data?.summary.reversals],
            ["People", list.data?.summary.people],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>
              {list.isLoading ? "—" : (value?.toLocaleString("en-US") ?? "—")}
            </strong>
          </div>
        ))}
      </section>
      <nav className="activity-categories" aria-label="Activity category">
        <button
          type="button"
          aria-pressed={!filters.category}
          onClick={() => update({ category: undefined })}
        >
          All activity
        </button>
        {activityCategories.map((category) => (
          <button
            key={category}
            type="button"
            aria-pressed={filters.category === category}
            onClick={() => update({ category })}
          >
            {category}
          </button>
        ))}
      </nav>
      <section
        className="activity-toolbar"
        aria-label="Search and filter activity"
      >
        <label className="activity-search">
          <Search size={17} aria-hidden="true" />
          <span className="sr-only">Search activity</span>
          <Input
            maxLength={200}
            placeholder="Search name, invoice, item, or change…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <SearchablePicker
          label="Activity dates"
          placeholder="All dates"
          value={preset}
          options={[
            { value: "all", label: "All dates" },
            { value: "today", label: "Today" },
            { value: "week", label: "Last 7 days" },
            { value: "month", label: "This month" },
            { value: "custom", label: "Choose dates" },
          ]}
          onChange={(value) => {
            if (value === "custom") {
              setAdvanced(true);
              update({ period: value });
            } else update({ period: value, ...activityDateRange(value) });
          }}
        />
        <Button
          variant="outline"
          aria-expanded={advanced}
          onClick={() => setAdvanced(!advanced)}
        >
          <Filter size={15} /> Filters
          {filterCount > 0 && (
            <span className="activity-filter-count">{filterCount}</span>
          )}
        </Button>
        <SearchablePicker
          label="Activity order"
          placeholder="Newest first"
          value={filters.sort}
          options={[
            { value: "newest", label: "Newest first" },
            { value: "oldest", label: "Oldest first" },
          ]}
          onChange={(sort) => update({ sort })}
        />
      </section>
      {advanced && (
        <section
          className="activity-advanced"
          aria-label="More activity filters"
        >
          <div>
            <span>Person</span>
            <SearchablePicker
              label="Filter by person"
              placeholder="All people"
              value={filters.actorId ?? "all"}
              options={[
                { value: "all", label: "All people" },
                ...(options.data?.actors.map((actor) => ({
                  value: actor.id,
                  label: actor.name,
                  description: actor.role === "OWNER" ? "Owner" : "Staff",
                })) ?? []),
              ]}
              onChange={(actorId) =>
                update({ actorId: actorId === "all" ? undefined : actorId })
              }
            />
          </div>
          <div>
            <span>Action</span>
            <SearchablePicker
              label="Filter by action"
              placeholder="All actions"
              value={filters.action ?? "all"}
              options={[
                { value: "all", label: "All actions" },
                ...(options.data?.actions ?? []),
              ]}
              onChange={(action) =>
                update({ action: action === "all" ? undefined : action })
              }
            />
          </div>
          <label>
            Start date
            <Input
              type="date"
              value={filters.from ?? ""}
              max={filters.to}
              onChange={(e) =>
                update({ from: e.target.value || undefined, period: "custom" })
              }
            />
          </label>
          <label>
            End date
            <Input
              type="date"
              value={filters.to ?? ""}
              min={filters.from}
              onChange={(e) =>
                update({ to: e.target.value || undefined, period: "custom" })
              }
            />
          </label>
          {options.isError && (
            <p role="alert">
              People and actions could not be loaded.{" "}
              <button type="button" onClick={() => void options.refetch()}>
                Try again
              </button>
            </p>
          )}
        </section>
      )}
      <div className="activity-results-meta">
        <p aria-live="polite">
          {list.isLoading
            ? "Loading history…"
            : list.isError
              ? "History unavailable"
              : `${list.data?.total.toLocaleString("en-US") ?? 0} activities${hasFilters ? " match these filters" : " recorded"}`}
          {list.isFetching && !list.isLoading && " · Updating…"}
        </p>
        <div>
          {hasFilters && (
            <Button
              variant="ghost"
              onClick={() => {
                setSearch("");
                setParams({});
              }}
            >
              Clear filters
            </Button>
          )}
          <button
            type="button"
            className="activity-live"
            aria-pressed={live}
            onClick={() => setLive(!live)}
          >
            <span />
            {live ? "Auto refresh on" : "Auto refresh off"}
          </button>
        </div>
      </div>
      <div className="activity-workspace">
        <section
          className="activity-history"
          aria-label="Recorded activity"
          aria-busy={list.isFetching}
        >
          <div className="activity-table-head" aria-hidden="true">
            <span>Time</span>
            <span>Activity</span>
            <span>Done by</span>
            <span>Record / Amount</span>
            <span />
          </div>
          {list.isError ? (
            <div className="activity-state" role="alert">
              <h2>Activity could not be loaded</h2>
              <p>{list.error.message}</p>
              <Button
                variant="outline"
                disabled={list.isFetching}
                onClick={() => void list.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : list.isLoading ? (
            <div role="status" className="activity-skeleton">
              <span className="sr-only">Loading activity…</span>
              {[0, 1, 2, 3, 4].map((row) => (
                <div key={row} aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              ))}
            </div>
          ) : !list.data?.items.length ? (
            <div className="activity-state">
              <History size={24} strokeWidth={1.5} />
              <h2>
                {hasFilters
                  ? "No matching activity"
                  : "No activity recorded yet"}
              </h2>
              <p>
                {hasFilters
                  ? "Try a different date, person, or search."
                  : "New work in the store will appear here."}
              </p>
              {hasFilters && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch("");
                    setParams({});
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            [...grouped].map(([day, events]) => (
              <section key={day} className="activity-day">
                <h2>
                  {day}
                  <span>{events.length} on this page</span>
                </h2>
                <ul>
                  {events.map((event) => (
                    <ActivityEvent
                      key={event.id}
                      event={event}
                      selected={event.id === selected}
                      open={() => setSelected(event.id)}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
          {!!list.data?.total && (
            <footer className="activity-pagination">
              <span>
                Page {list.data.page} of {list.data.totalPages}
              </span>
              <div>
                <Button
                  variant="outline"
                  disabled={filters.page === 1 || list.isFetching}
                  onClick={() =>
                    setParams((current) => {
                      const next = new URLSearchParams(current);
                      next.set("page", String((filters.page ?? 1) - 1));
                      return next;
                    })
                  }
                >
                  <ChevronLeft size={15} /> Previous
                </Button>
                <Button
                  variant="outline"
                  disabled={
                    (filters.page ?? 1) >= list.data.totalPages ||
                    list.isFetching
                  }
                  onClick={() =>
                    setParams((current) => {
                      const next = new URLSearchParams(current);
                      next.set("page", String((filters.page ?? 1) + 1));
                      return next;
                    })
                  }
                >
                  Next <ChevronRight size={15} />
                </Button>
              </div>
            </footer>
          )}
        </section>
        {desktop && (
          <aside className="activity-inspector" aria-label="Activity details">
            {detailContent}
          </aside>
        )}
      </div>
      <p className="activity-footer-note">
        Times use Bangladesh time. Older records may have fewer details.
        Activity tracks saved work and account events.
      </p>
      {!desktop && (
        <Drawer.Root
          open={!!selected}
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
        >
          <Drawer.Portal>
            <Drawer.Overlay className="fixed inset-0 z-50 bg-black/35" />
            <Drawer.Content className="activity-detail-drawer">
              <Drawer.Title className="sr-only">Activity details</Drawer.Title>
              <Drawer.Description className="sr-only">
                The saved event, person, time and changes.
              </Drawer.Description>
              {detailContent}
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
      )}
    </div>
  );
}
export function ActivityPage() {
  const { user } = useAuth();
  if (user?.role !== "OWNER")
    return (
      <div className="activity-page activity-state">
        <ShieldCheck size={24} />
        <h1>Owner access needed</h1>
        <p>Only the store owner can view Activity.</p>
        <Button asChild variant="outline">
          <Link to="/dashboard">
            Back to Overview <ArrowRight size={15} />
          </Link>
        </Button>
      </div>
    );
  return <ActivityWorkspace />;
}
