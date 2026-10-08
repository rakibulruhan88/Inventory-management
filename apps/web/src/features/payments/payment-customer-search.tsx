import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Command } from "cmdk";
import { Drawer } from "vaul";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { getCustomers } from "@/lib/api";
import { formatMoney } from "@/features/sales/ledger-components";
import {
  prioritizeDueCustomers,
  receivePaymentPath,
} from "./payments-navigation";
export function PaymentCustomerSearch({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const term = useDebouncedValue(search, 250);
  const q = useQuery({
    queryKey: ["customers", "payment-search", term],
    queryFn: () => getCustomers(term),
    enabled: open && !!term.trim(),
  });
  const waiting = q.isPending || search !== term;
  const customers = prioritizeDueCustomers(q.data ?? []);
  return (
    <Drawer.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setSearch("");
      }}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/35" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-lg border-t border-[var(--border)] bg-[var(--surface)] px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-4 outline-none sm:mx-auto sm:max-w-xl sm:border-x">
          <div className="flex items-center justify-between gap-3">
            <Drawer.Title className="text-lg font-semibold">
              Receive Payment
            </Drawer.Title>
            <Drawer.Close asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close customer search"
              >
                <X aria-hidden="true" className="size-4" />
              </Button>
            </Drawer.Close>
          </div>
          <Drawer.Description className="mt-1 text-sm text-[var(--muted)]">
            Choose a customer.
          </Drawer.Description>
          <Command
            shouldFilter={false}
            loop
            className="mt-4 flex min-h-0 flex-col"
          >
            <div className="flex items-center gap-2 border-y border-[var(--border)]">
              <Search
                aria-hidden="true"
                className="size-4 shrink-0 text-[var(--muted)]"
              />
              <Command.Input
                autoFocus
                aria-label="Search customer by name or phone"
                placeholder="Customer name or phone…"
                maxLength={200}
                value={search}
                onValueChange={setSearch}
                className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[var(--muted)]"
              />
            </div>
            <Command.List
              className="min-h-28 overflow-y-auto py-2"
              aria-busy={!!term.trim() && waiting}
            >
              {!search.trim() ? (
                <p className="px-2 py-5 text-sm text-[var(--muted)]">
                  Search by customer name or phone.
                </p>
              ) : waiting ? (
                <p
                  role="status"
                  className="animate-pulse px-2 py-5 text-sm text-[var(--muted)]"
                >
                  Finding customers…
                </p>
              ) : q.isError ? (
                <div className="p-2 text-sm" role="alert">
                  <p className="text-[var(--danger)]">{q.error.message}</p>
                  <Button
                    variant="outline"
                    className="mt-3"
                    onClick={() => void q.refetch()}
                  >
                    Retry
                  </Button>
                </div>
              ) : (
                <>
                  <Command.Empty className="px-2 py-5 text-sm text-[var(--muted)]">
                    No customers found.
                  </Command.Empty>
                  {customers.map((c) => (
                    <Command.Item
                      key={c.id}
                      value={c.id}

                      onSelect={() => {
                        onOpenChange(false);
                        setSearch("");
                        navigate(
                          c.totalDue > 0
                            ? receivePaymentPath(c.id)
                            : `/customers/${encodeURIComponent(c.id)}/opening-due`,
                        );
                      }}
                      className="flex min-h-16 cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-3 outline-none data-[selected=true]:bg-[var(--primary-soft)] data-[disabled=true]:cursor-default data-[disabled=true]:opacity-60"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-sm font-medium">
                          {c.name}
                        </span>
                        <span className="mt-1 block break-words text-xs text-[var(--muted)]">
                          {c.phone || "No phone recorded"}
                        </span>
                      </span>
                      <span className="min-w-0 text-right">
                        <span className="block break-words text-sm font-semibold tabular-nums">
                          {formatMoney(c.totalDue)}
                        </span>
                        <span className="mt-1 block text-xs text-[var(--muted)]">
                          {c.totalDue > 0 ? "Total Due" : "Add Old Due"}
                        </span>
                      </span>
                    </Command.Item>
                  ))}
                </>
              )}
            </Command.List>
          </Command>
          <Button
            variant="outline"
            className="mt-3 shrink-0"
            onClick={() => {
              onOpenChange(false);
              navigate("/payments/add-customer");
            }}
          >
            + Add Customer
          </Button>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
