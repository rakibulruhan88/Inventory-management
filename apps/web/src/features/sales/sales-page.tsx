import { Permit } from "@/features/auth/permit";
import { useQuery } from "@tanstack/react-query";
import type { SalesLedgerQuery } from "@afia/contracts";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { getSalesLedger } from "@/lib/api";
import { SalesFilters } from "./sales-filters";
import { activeFilterLabels, readLedgerParams } from "./sales-filter-state";
import {
  LedgerError,
  LedgerLoading,
  LedgerPagination,
  SalesLedger,
} from "./ledger-components";

export function SalesPage() {
  const [params, setParams] = useSearchParams();
  const filters = readLedgerParams(params);
  const search = filters.search ?? "";
  const debouncedSearch = useDebouncedValue(search, 250);
  const request = { ...filters, search: debouncedSearch, pageSize: 25 };
  const q = useQuery({
    queryKey: ["sales", "ledger", request],
    queryFn: () => getSalesLedger(request),
  });
  const apply = (next: SalesLedgerQuery) => {
    const p = new URLSearchParams();
    Object.entries(next).forEach(([key, value]) => {
      if (value !== undefined && value !== "") p.set(key, String(value));
    });
    setParams(p, { replace: true });
  };
  const chips = activeFilterLabels(filters);
  const clear = () => apply({ search, page: 1 });
  return (
    <div className="mx-auto max-w-350 px-4 pb-28 pt-6 md:px-7 lg:px-8 lg:pb-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sales</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Customer sales and invoice balances.
          </p>
        </div>
        <Permit permission="sales.create"><Button asChild>
          <Link to="/sales/new">
            <Plus className="size-4" /> New Sale
          </Link>
        </Button></Permit>
      </header>
      <div className="mt-5 flex items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">
            Search sales by invoice, customer, phone or item code
          </span>
          <Search
            aria-hidden="true"
            className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]"
          />
          <Input
            className="pl-9"
            maxLength={200}
            value={search}
            onChange={(e) =>
              apply({ ...filters, search: e.target.value, page: 1 })
            }
            placeholder="Search invoice, customer, phone or item…"
          />
        </label>
        <SalesFilters value={filters} onApply={apply} />
      </div>
      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {chips.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              aria-label={`Remove ${label} filter`}
              className="flex max-w-full items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs hover:bg-[var(--surface-warm)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
              onClick={() => {
                const next = { ...filters, [key]: undefined, page: 1 };
                if (key === "date") {
                  next.from = undefined;
                  next.to = undefined;
                }
                apply(next);
              }}
            >
              <span className="break-words">{label}</span>
              <X className="size-3 shrink-0" />
            </button>
          ))}
          <Button variant="ghost" onClick={clear}>
            Clear filters
          </Button>
        </div>
      )}
      <section
        aria-label="Sales ledger"
        aria-busy={q.isFetching || search !== debouncedSearch}
        className="mt-5 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface)]"
      >
        {q.isError ? (
          <LedgerError
            message={q.error.message}
            retry={() => void q.refetch()}
          />
        ) : q.isPending || search !== debouncedSearch ? (
          <LedgerLoading />
        ) : q.data.items.length ? (
          <SalesLedger rows={q.data.items} />
        ) : (
          <div className="p-5">
            <h2 className="text-sm font-semibold">No sales found</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {chips.length || search
                ? "Try fewer filters or a different search."
                : "New sales will appear here."}
            </p>
            {(chips.length > 0 || search) && (
              <Button
                variant="outline"
                className="mt-3"
                onClick={() => apply({})}
              >
                Clear search and filters
              </Button>
            )}
          </div>
        )}
        {q.data && !q.isError && (
          <LedgerPagination
            data={q.data}
            busy={q.isFetching || search !== debouncedSearch}
            onPage={(page) => apply({ ...filters, page })}
          />
        )}
      </section>
    </div>
  );
}
