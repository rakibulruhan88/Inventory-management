import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  InventoryColorVariant,
  InventoryItemSummary,
} from "@afia/contracts";
import {
  ChevronDown,
  Edit3,
  LoaderCircle,
  Scale,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Drawer } from "vaul";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  adjustStock,
  archiveInventoryItem,
  archiveInventoryVariant,
  getInventoryItems,
  getSettings,
  updateInventoryItem,
  updateInventoryVariant,
} from "@/lib/api";

type EditTarget =
  | { kind: "item"; item: InventoryItemSummary }
  | { kind: "variant"; variant: InventoryColorVariant };

type DeleteTarget = { kind: "item" | "variant"; id: string; label: string };

export function InventoryPage() {
  const [params] = useSearchParams();
  const reduceMotion = useReducedMotion();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const deleteDialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!deleteTarget) return;
    const previousFocus = document.activeElement;
    const dialog = deleteDialog.current;
    dialog?.querySelector<HTMLButtonElement>("button")?.focus();
    const keepFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setDeleteTarget(null);
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const buttons = dialog.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if ((event.shiftKey && document.activeElement === first) ||
          (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    };
    dialog?.addEventListener("keydown", keepFocus);
    return () => {
      dialog?.removeEventListener("keydown", keepFocus);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [deleteTarget]);
  const [itemCode, setItemCode] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  const [description, setDescription] = useState("");
  const [adjustTarget, setAdjustTarget] =
    useState<InventoryColorVariant | null>(null);
  const [rollsChange, setRollsChange] = useState(0);
  const [meterChange, setMeterChange] = useState(0);
  const [adjustReason, setAdjustReason] = useState("");
  const inventory = useQuery({
    queryKey: ["inventory-items", search],
    queryFn: () => getInventoryItems(search),
  });
  const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["inventory-items"] }),
      queryClient.invalidateQueries({ queryKey: ["inventory-summary"] }),
      queryClient.invalidateQueries({ queryKey: ["products"] }),
    ]);
  };
  const save = useMutation({
    mutationFn: async () => {
      if (!editTarget) return;
      if (editTarget.kind === "item")
        return updateInventoryItem(editTarget.item.productId, {
          itemCode,
          name,
          description,
        });
      return updateInventoryVariant(editTarget.variant.variantId, {
        color,
      });
    },
    onSuccess: async () => {
      await refresh();
      setEditTarget(null);
      toast.success("Changes saved");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const archive = useMutation({
    mutationFn: async () => {
      if (!deleteTarget) return;
      return deleteTarget.kind === "item"
        ? archiveInventoryItem(deleteTarget.id)
        : archiveInventoryVariant(deleteTarget.id);
    },
    onSuccess: async () => {
      await refresh();
      setDeleteTarget(null);
      toast.success("Removed from active inventory. History is preserved.");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const adjust = useMutation({
    mutationFn: () =>
      adjustStock({
        variantId: adjustTarget!.variantId,
        rollsChange,
        meterChange,
        reason: adjustReason,
      }),
    onSuccess: async () => {
      await refresh();
      setAdjustTarget(null);
      setRollsChange(0);
      setMeterChange(0);
      setAdjustReason("");
      toast.success("Stock adjusted and recorded");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const beginEditItem = (item: InventoryItemSummary) => {
    setItemCode(item.itemCode);
    setName(item.name ?? "");
    setDescription(item.description ?? "");
    setEditTarget({ kind: "item", item });
  };
  const beginEditVariant = (variant: InventoryColorVariant) => {
    setColor(variant.color);
    setEditTarget({ kind: "variant", variant });
  };
  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="mx-auto max-w-350 px-4 pb-28 pt-6 md:px-7 lg:px-8 lg:pb-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Stock by item. Expand for colors and container balances.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/purchases/new">Receive Purchase</Link>
        </Button>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full md:max-w-xl">
          <label htmlFor="inventory-search" className="sr-only">Search inventory</label>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
          <Input
            id="inventory-search"
            className="h-11 pl-10 pr-12"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search item code, color, roll, meter or container..."
          />
          {search && (
            <button
              type="button"
              aria-label="Clear inventory search"
              onClick={() => setSearch("")}
              className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-md text-[var(--muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          )}
        </div>
        <p aria-live="polite" className="text-xs text-[var(--muted)]">
          {inventory.isLoading ? "Loading inventory…" : inventory.isError ? "Inventory unavailable" :
            `${inventory.data?.length ?? 0} ${search ? "matching " : ""}${inventory.data?.length === 1 ? "item" : "items"}`}
          {inventory.isFetching && !inventory.isLoading && " · Updating…"}
        </p>
      </div>

      <section aria-label="Inventory items" aria-busy={inventory.isLoading} className="mt-4 border border-[var(--border)] bg-[var(--surface)]">
        <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1fr)_4rem_5rem_6rem_7rem_1.25rem] items-center gap-3 border-b border-[var(--border)] bg-[var(--page)] px-4 py-3 text-xs font-medium text-[var(--muted)] md:grid">
          <span>Item / Description</span><span className="text-right">Colors</span><span className="text-right">Containers</span><span className="text-right">Rolls</span><span className="text-right">Meter</span><span />
        </div>
        {inventory.isError ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-4 px-4 py-8">
            <div>
              <h2 className="text-sm font-semibold">Inventory could not be loaded</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">Check your connection and try again.</p>
            </div>
            <Button variant="outline" disabled={inventory.isFetching} onClick={() => void inventory.refetch()}>
              {inventory.isFetching ? "Retrying…" : "Try again"}
            </Button>
          </div>
        ) : inventory.isLoading ? (
          <div role="status">
            <span className="sr-only">Loading inventory items…</span>
            {[0, 1, 2, 3, 4, 5].map((row) => (
              <div key={row} aria-hidden="true" className="flex min-h-20 items-center justify-between gap-4 border-b border-[var(--border)] px-4 last:border-0">
                <div className="w-1/2 space-y-2"><div className="h-3 w-24 rounded-sm bg-[var(--surface-muted)]" /><div className="h-3 w-full max-w-72 rounded-sm bg-[var(--surface-muted)]" /></div>
                <div className="h-6 w-20 rounded-sm bg-[var(--surface-muted)]" />
              </div>
            ))}
          </div>
        ) : inventory.data?.length ? (
          <ul>
            {inventory.data.map((item) => {
              const isOpen = expanded.has(item.productId);
              return (
                <li key={item.productId} className="border-b border-[var(--border)] last:border-0">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={`inventory-details-${item.productId}`}
                    onClick={() => toggle(item.productId)}
                    className={`grid min-h-20 w-full grid-cols-[minmax(0,1fr)_auto_1.25rem] items-center gap-3 px-4 py-3 text-left transition-colors focus-visible:relative focus-visible:z-10 focus-visible:outline-offset-[-2px] md:min-h-18 md:grid-cols-[minmax(0,1fr)_4rem_5rem_6rem_7rem_1.25rem] ${isOpen ? "bg-[var(--primary-soft)]" : "hover:bg-[var(--page)]"}`}
                  >
                    <span className="min-w-0">
                      <span className="block break-words text-sm font-semibold">{item.itemCode}</span>
                      <span className="mt-1 block truncate text-xs text-[var(--muted)]" title={item.description || item.name || "No Description / Size"}>
                        {item.description || item.name || "No Description / Size"}
                      </span>
                      <span className="mt-1 block truncate text-xs text-[var(--muted)] md:hidden" title={item.variants.map((variant) => variant.color).join(", ")}>
                        {item.colorCount} {item.colorCount === 1 ? "color" : "colors"} · {item.variants.map((variant) => variant.color).join(", ")}
                      </span>
                    </span>
                    <span className="hidden break-words text-right text-sm tabular-nums md:block"><span className="sr-only">Colors: </span>{item.colorCount}</span>
                    <span className="hidden break-words text-right text-sm tabular-nums md:block"><span className="sr-only">Containers: </span>{item.containerCount}</span>
                    <span className="grid min-w-0 max-w-32 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-1.5 gap-y-0.5 break-words text-right tabular-nums md:hidden">
                      <span className="text-base font-semibold leading-5">{item.totalRolls}</span>
                      <span className="text-[11px] text-[var(--muted)]">Rolls</span>
                      <span className="text-sm font-medium leading-5 text-[var(--ink-soft)]">{item.totalMeters}</span>
                      <span className="text-[11px] text-[var(--muted)]">Meter</span>
                    </span>
                    <span className="hidden break-words text-right text-sm font-semibold tabular-nums md:block">{item.totalRolls}<span className="sr-only"> Rolls</span></span>
                    <span className="hidden break-words text-right text-sm tabular-nums md:block">{item.totalMeters}<span className="sr-only"> Meter</span></span>
                    <ChevronDown aria-hidden="true" className={`size-4 text-[var(--muted)] transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`} />
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.section
                        id={`inventory-details-${item.productId}`}
                        aria-label={`${item.itemCode} colors and batches`}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: reduceMotion ? 0 : 0.16 }}
                        className="overflow-hidden"
                      >
                        <div className="border-t border-[var(--border)]">
                          <div className="flex flex-col items-stretch justify-between gap-x-3 gap-y-2 border-b border-[var(--border)] bg-[var(--page)] px-4 py-2 md:flex-row md:flex-wrap md:items-center md:gap-y-1">
                            <div className="min-w-0 md:flex-1">
                              <p className="break-words text-sm font-medium">{item.description || item.name || "No Description / Size"}</p>
                              <p className="mt-1 text-xs text-[var(--muted)]">
                                {item.colorCount} {item.colorCount === 1 ? "color" : "colors"} · From {item.containerCount} {item.containerCount === 1 ? "container" : "containers"}
                              </p>
                            </div>
                            <div className="-ml-2 flex flex-wrap gap-1 md:ml-0">
                              <Button type="button" variant="ghost" className="px-2 text-xs md:px-3 md:text-sm" onClick={() => beginEditItem(item)}>
                                <Edit3 aria-hidden="true" className="size-3.5" /> Edit item
                              </Button>
                              <Button type="button" variant="ghost" className="px-2 text-xs text-[var(--danger)] md:px-3 md:text-sm" onClick={() => setDeleteTarget({ kind: "item", id: item.productId, label: item.itemCode })}>
                                <Trash2 aria-hidden="true" className="size-3.5" /> Delete item
                              </Button>
                            </div>
                          </div>
                          {item.variants.map((variant) => (
                            <InventoryColorDetails
                              key={variant.variantId}
                              variant={variant}
                              lowStock={variant.totalRolls <= (settings.data?.lowStockRollThreshold ?? 3) || variant.totalMeters <= (settings.data?.lowStockMeterThreshold ?? 500)}
                              onAdjust={() => setAdjustTarget(variant)}
                              onEdit={() => beginEditVariant(variant)}
                              onDelete={() => setDeleteTarget({ kind: "variant", id: variant.variantId, label: `${item.itemCode} · ${variant.color}` })}
                            />
                          ))}
                        </div>
                      </motion.section>
                    )}
                  </AnimatePresence>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="px-4 py-8">
            <h2 className="text-sm font-semibold">{search ? "No matching stock" : "No stock received yet"}</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {search ? "Try another item code, color, roll, meter or container." : "Receive the first container to see inventory here."}
            </p>
            {search ? <Button className="mt-4" variant="outline" onClick={() => setSearch("")}>Clear search</Button> :
              <Button asChild className="mt-4" variant="outline"><Link to="/purchases/new">Receive Purchase</Link></Button>}
          </div>
        )}
      </section>

      <Drawer.Root
        open={Boolean(editTarget)}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-50 bg-black/35" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[90svh] overflow-y-auto rounded-t-lg border-t border-[var(--border)] bg-[var(--surface)] p-5 pb-[max(20px,env(safe-area-inset-bottom))] outline-none">
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-[var(--border-strong)]" />
            <div className="mx-auto max-w-lg">
              <div className="flex items-center justify-between">
                <Drawer.Title className="text-lg font-semibold">
                  {editTarget?.kind === "item" ? "Edit item" : "Edit color"}
                </Drawer.Title>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Close editor"
                  onClick={() => setEditTarget(null)}
                >
                  <X className="size-4" />
                </Button>
              </div>
              <Drawer.Description className="mt-1 text-sm text-[var(--muted)]">
                {editTarget?.kind === "item" ? editTarget.item.itemCode : editTarget?.variant.color}
              </Drawer.Description>
              {editTarget?.kind === "item" ? (
                <div className="mt-5 grid gap-4">
                  <label className="text-sm font-medium">
                    Item code
                    <Input
                      className="mt-2"
                      value={itemCode}
                      onChange={(event) => setItemCode(event.target.value)}
                    />
                  </label>
                  <label className="text-sm font-medium">
                    Description / Size
                    <Input
                      className="mt-2"
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                    />
                  </label>
                </div>
              ) : (
                <div className="mt-5 grid gap-4">
                  <label className="text-sm font-medium">
                    Color Code <span className="text-[var(--danger)]">*</span>
                    <Input
                      className="mt-2"
                      value={color}
                      onChange={(event) => setColor(event.target.value)}
                    />
                  </label>
                </div>
              )}
              <Button
                className="mt-6 w-full"
                disabled={
                  save.isPending ||
                  (editTarget?.kind === "item"
                    ? !itemCode.trim()
                    : !color.trim())
                }
                onClick={() => save.mutate()}
              >
                {save.isPending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : null}
                Save changes
              </Button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      <Drawer.Root
        open={Boolean(adjustTarget)}
        onOpenChange={(open) => {
          if (!open) setAdjustTarget(null);
        }}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-50 bg-black/35" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[90svh] overflow-y-auto rounded-t-lg border-t border-[var(--border)] bg-[var(--surface)] p-5 pb-[max(20px,env(safe-area-inset-bottom))] outline-none">
            <div className="mx-auto max-w-lg">
              <div className="flex items-center justify-between gap-3">
                <Drawer.Title className="text-lg font-semibold">
                  Adjust {adjustTarget?.color} stock
                </Drawer.Title>
                <Button type="button" variant="ghost" size="icon" aria-label="Close stock adjustment" onClick={() => setAdjustTarget(null)}><X aria-hidden="true" className="size-4" /></Button>
              </div>
              <Drawer.Description className="mt-1 text-sm text-[var(--muted)]">
                Current: {adjustTarget?.totalRolls} Rolls ·{" "}
                {adjustTarget?.totalMeters} Meter
              </Drawer.Description>
              <div className="mt-5 grid grid-cols-2 gap-4">
                <label className="text-sm font-medium">
                  Roll change
                  <Input
                    className="mt-2"
                    type="number"
                    value={rollsChange}
                    onChange={(event) =>
                      setRollsChange(Number(event.target.value))
                    }
                  />
                </label>
                <label className="text-sm font-medium">
                  Meter change
                  <Input
                    className="mt-2"
                    type="number"
                    step="0.01"
                    value={meterChange}
                    onChange={(event) =>
                      setMeterChange(Number(event.target.value))
                    }
                  />
                </label>
              </div>
              <label className="mt-4 block text-sm font-medium">
                Reason *
                <Input
                  className="mt-2"
                  value={adjustReason}
                  onChange={(event) => setAdjustReason(event.target.value)}
                  placeholder="Damaged roll, recount difference…"
                />
              </label>
              <Button
                className="mt-5 w-full"
                disabled={
                  adjustReason.trim().length < 2 ||
                  (!rollsChange && !meterChange) ||
                  adjust.isPending
                }
                onClick={() => adjust.mutate()}
              >
                {adjust.isPending && (
                  <LoaderCircle className="size-4 animate-spin" />
                )}{" "}
                Save Adjustment
              </Button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {deleteTarget ? (
        <div
          className="fixed inset-0 z-60 grid place-items-center bg-black/40 p-4"
          ref={deleteDialog}
          role="dialog"
          aria-modal="true"
          aria-labelledby="inventory-delete-title"
          aria-describedby="inventory-delete-description"
        >
          <div className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-float)]">
            <h2 id="inventory-delete-title" className="break-words text-lg font-semibold">
              Delete {deleteTarget.label}?
            </h2>
            <p id="inventory-delete-description" className="mt-2 text-sm leading-6 text-[var(--muted)]">
              It will disappear from active inventory, but purchase and
              container history will stay safe.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={archive.isPending}
                onClick={() => archive.mutate()}
              >
                {archive.isPending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Trash2 className="size-4" />
                )}
                Delete
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function InventoryColorDetails({
  variant,
  lowStock,
  onAdjust,
  onEdit,
  onDelete,
}: {
  variant: InventoryColorVariant;
  lowStock: boolean;
  onAdjust: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <section aria-label={`${variant.color} stock`} className="border-b border-[var(--border)] px-4 py-3 last:border-b-0 md:pl-8">
      <div className="flex flex-col items-stretch justify-between gap-x-4 gap-y-1 md:flex-row md:flex-wrap md:items-center md:gap-y-2">
        <div className="flex min-w-0 items-start gap-2.5 md:flex-1 md:basis-44">
          <div className="min-w-0">
            <h3 className="break-words text-sm font-semibold">{variant.color}</h3>
            <p className="mt-1 text-xs tabular-nums text-[var(--muted)]">{variant.totalRolls} Rolls · {variant.totalMeters} Meter</p>
            {lowStock && <p className="mt-1 text-xs font-medium text-[var(--warning)]">Low stock</p>}
          </div>
        </div>
        <div className="-ml-2 flex shrink-0 self-start gap-0 md:ml-0 md:self-auto md:gap-1">
          <Button type="button" variant="ghost" className="px-2 text-xs md:px-3 md:text-sm" onClick={onAdjust}><Scale aria-hidden="true" className="size-3.5 md:size-4" /> Adjust</Button>
          <Button type="button" size="icon" variant="ghost" aria-label={`Edit ${variant.color}`} onClick={onEdit}><Edit3 aria-hidden="true" className="size-3.5 md:size-4" /></Button>
          <Button type="button" size="icon" variant="ghost" className="text-[var(--danger)]" aria-label={`Delete ${variant.color}`} onClick={onDelete}><Trash2 aria-hidden="true" className="size-3.5 md:size-4" /></Button>
        </div>
      </div>
      {variant.batches.length ? (
        <div className="mt-3 overflow-x-auto border-l-2 border-[var(--border)] pl-3 md:ml-5">
          <table className="w-full border-collapse text-left text-xs">
            <caption className="sr-only">Container batch balances for {variant.color}</caption>
            <thead className="text-[var(--muted)]">
              <tr><th scope="col" className="py-2 pr-3 font-medium">Container</th><th scope="col" className="px-2 py-2 text-right font-medium">Rolls</th><th scope="col" className="py-2 pl-3 text-right font-medium">Meter</th></tr>
            </thead>
            <tbody>
              {variant.batches.map((batch) => (
                <tr key={batch.batchId} className="border-t border-[var(--border)] hover:bg-[var(--page)]">
                  <th scope="row" className="break-words py-2.5 pr-3 font-medium">{batch.containerNumber}</th>
                  <td className="px-2 py-2.5 text-right tabular-nums">{batch.availableRolls}</td>
                  <td className="py-2.5 pl-3 text-right tabular-nums">{batch.availableMeter}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="mt-3 border-l-2 border-[var(--border)] pl-3 text-xs text-[var(--muted)] md:ml-5">No container batches for this color.</p>}
    </section>
  );
}
