import {
  dateOptions,
  statusOptions,
  methodOptions,
  sortOptions,
  filterError,
} from "./sales-filter-state";
import { useState } from "react";
import { Drawer } from "vaul";
import { SlidersHorizontal, X } from "lucide-react";
import type { SalesLedgerQuery } from "@afia/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchablePicker } from "@/components/searchable-picker";

export function FilterPicker({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[][];
  value?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium">{label}</p>
      <SearchablePicker
        label={label}
        placeholder={options[0][1]}
        value={value ?? options[0][0]}
        options={options.map(([value, label]) => ({ value, label }))}
        onChange={onChange}
        purchasePresentation
        nestedDrawer
        triggerClassName="min-h-11 rounded-md shadow-none"
      />
    </div>
  );
}
export function SalesFilters({
  value,
  onApply,
}: {
  value: SalesLedgerQuery;
  onApply: (q: SalesLedgerQuery) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<SalesLedgerQuery>(value);
  const error = filterError(draft);
  const update = (
    key: keyof SalesLedgerQuery,
    next: string | number | undefined,
  ) => setDraft((q) => ({ ...q, [key]: next }));
  return (
    <Drawer.Root open={open} onOpenChange={setOpen}>
      <Drawer.Trigger asChild>
        <Button variant="outline" onClick={() => setDraft(value)}>
          <SlidersHorizontal className="size-4" /> Filters
        </Button>
      </Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/35" />
        <Drawer.Content className="purchase-form-controls fixed inset-x-0 bottom-0 z-50 flex max-h-[90svh] flex-col rounded-t-lg border border-[var(--border)] bg-[var(--surface)] md:inset-x-auto md:right-4 md:w-[560px]">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
            <Drawer.Title className="font-semibold">Sales filters</Drawer.Title>
            <Drawer.Close asChild>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Close sales filters"
              >
                <X className="size-4" />
              </Button>
            </Drawer.Close>
          </div>
          <form
            className="flex min-h-0 flex-col"
            aria-describedby={error ? "sales-filter-error" : undefined}
            onSubmit={(e) => {
              e.preventDefault();
              if (!error) {
                onApply({ ...draft, page: 1 });
                setOpen(false);
              }
            }}
          >
            <div className="min-h-0 space-y-5 overflow-y-auto p-5">
              <Drawer.Description className="text-xs text-[var(--muted)]">
                Combine filters across all sales. Dates use the recorded
                creation time in Asia/Dhaka; weeks start Monday.
              </Drawer.Description>
              <FilterPicker
                label="Created date"
                options={dateOptions}
                value={draft.date ?? ""}
                onChange={(next) =>
                  setDraft((q) => ({
                    ...q,
                    date: (next || undefined) as SalesLedgerQuery["date"],
                    from: undefined,
                    to: undefined,
                  }))
                }
              />
              {(draft.date === "specific" || draft.date === "range") && (
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs font-medium">
                    {draft.date === "specific" ? "Specific Date" : "From Date"}
                    <Input
                      type="date"
                      required
                      value={draft.from ?? ""}
                      className="mt-1.5"
                      onChange={(e) => update("from", e.target.value)}
                    />
                  </label>
                  {draft.date === "range" && (
                    <label className="text-xs font-medium">
                      To Date
                      <Input
                        type="date"
                        required
                        value={draft.to ?? ""}
                        min={draft.from}
                        className="mt-1.5"
                        onChange={(e) => update("to", e.target.value)}
                      />
                    </label>
                  )}
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ["customer", "Customer name"],
                  ["phone", "Customer phone"],
                  ["invoice", "Invoice number"],
                  ["product", "Item / Description / Color Code"],
                ].map(([key, label]) => (
                  <label key={key} className="text-xs font-medium">
                    {label}
                    <Input
                      className="mt-1.5"
                      maxLength={
                        key === "phone" || key === "invoice" ? 100 : 200
                      }
                      value={String(draft[key as keyof SalesLedgerQuery] ?? "")}
                      onChange={(e) =>
                        update(key as keyof SalesLedgerQuery, e.target.value)
                      }
                    />
                  </label>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <FilterPicker
                  label="Invoice status"
                  options={statusOptions}
                  value={draft.status ?? ""}
                  onChange={(v) => update("status", v || undefined)}
                />
                <FilterPicker
                  label="Payment method"
                  options={methodOptions}
                  value={draft.method ?? ""}
                  onChange={(v) => update("method", v || undefined)}
                />
              </div>
              <p className="text-xs text-[var(--muted)]">
                Payment method matches recorded, non-voided payments. Unpaid
                invoices have no payment method.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {[
                  ["minTotal", "Minimum invoice total"],
                  ["maxTotal", "Maximum invoice total"],
                  ["minDue", "Minimum invoice due"],
                  ["maxDue", "Maximum invoice due"],
                ].map(([key, label]) => (
                  <label key={key} className="text-xs font-medium">
                    {label}
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      className="mt-1.5"
                      value={draft[key as keyof SalesLedgerQuery] ?? ""}
                      onChange={(e) =>
                        update(
                          key as keyof SalesLedgerQuery,
                          e.target.value === ""
                            ? undefined
                            : Number(e.target.value),
                        )
                      }
                    />
                  </label>
                ))}
              </div>
              <FilterPicker
                label="Sort"
                options={sortOptions}
                value={draft.sort ?? "newest"}
                onChange={(v) => update("sort", v)}
              />
            </div>
            <div className="border-t border-[var(--border)] p-5 pb-[max(20px,env(safe-area-inset-bottom))]">
              {error && (
                <p
                  id="sales-filter-error"
                  role="alert"
                  className="mb-3 text-sm text-[var(--danger)]"
                >
                  {error}
                </p>
              )}
              <div className="flex justify-between gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setDraft({ search: value.search })}
                >
                  Reset filters
                </Button>
                <Button type="submit" disabled={!!error}>
                  Apply filters
                </Button>
              </div>
            </div>
          </form>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
