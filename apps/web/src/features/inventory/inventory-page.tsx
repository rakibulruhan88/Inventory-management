import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  InventoryColorVariant,
  InventoryItemSummary,
} from "@afia/contracts";
import {
  Boxes,
  ChevronDown,
  Container,
  Edit3,
  LoaderCircle,
  Scale,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
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
  const queryClient = useQueryClient();
  const [search, setSearch] = useState(params.get("search") ?? "");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [itemCode, setItemCode] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  const [size, setSize] = useState("");
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
        });
      return updateInventoryVariant(editTarget.variant.variantId, {
        color,
        size,
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
    setEditTarget({ kind: "item", item });
  };
  const beginEditVariant = (variant: InventoryColorVariant) => {
    setColor(variant.color);
    setSize(variant.size ?? "");
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
    <div className="mx-auto max-w-350 px-4 pb-28 pt-6 md:px-7 md:pt-8 lg:px-10 lg:pb-12">
      <div className="flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--surface-warm)] text-[var(--accent)]">
          <Boxes className="size-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
            Inventory
          </h1>
          <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
            Item totals first. Open an item to see every color and roll.
          </p>
        </div>
      </div>
      <label className="relative mt-6 block">
        <span className="sr-only">Search inventory</span>
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-[var(--accent)]" />
        <Input
          className="h-13 pl-12"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search item code, color, roll, meter or container..."
        />
      </label>

      {inventory.isLoading ? (
        <div className="grid min-h-56 place-items-center">
          <LoaderCircle className="size-5 animate-spin" />
        </div>
      ) : inventory.data?.length ? (
        <div className="mt-5 space-y-3">
          {inventory.data.map((item) => {
            const isOpen = expanded.has(item.productId);
            return (
              <article
                key={item.productId}
                className="overflow-hidden rounded-xl border border-[var(--border)] bg-white shadow-[var(--shadow-card)] transition hover:border-[var(--primary-border)]"
              >
                <button
                  type="button"
                  onClick={() => toggle(item.productId)}
                  className="flex w-full items-center gap-3 p-4 text-left sm:p-5"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--surface-warm)] text-[var(--accent)]">
                    <Boxes className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {item.itemCode}
                    </span>
                    <span className="mt-1 block truncate text-xs text-[var(--muted)]">
                      {item.name || "Unnamed leather item"} · {item.colorCount}{" "}
                      {item.colorCount === 1 ? "Color" : "Colors"}
                    </span>
                  </span>
                  <span className="hidden text-right sm:block">
                    <span className="block font-semibold">
                      {item.totalRolls} Rolls
                    </span>
                    <span className="text-xs text-[var(--accent)]">
                      {item.totalMeters} Meter
                    </span>
                  </span>
                  <ChevronDown
                    className={`size-5 shrink-0 text-[var(--muted)] transition ${isOpen ? "rotate-180" : ""}`}
                  />
                </button>
                <div className="grid grid-cols-3 border-t border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-3 text-center text-xs sm:hidden">
                  <span>{item.totalRolls} Rolls</span>
                  <span>{item.totalMeters} Meter</span>
                  <span>
                    {item.colorCount}{" "}
                    {item.colorCount === 1 ? "Color" : "Colors"}
                  </span>
                </div>
                <AnimatePresence initial={false}>
                  {isOpen ? (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-[var(--border)] p-4 sm:p-5">
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs text-[var(--muted)]">
                            <Container className="mr-1 inline size-3.5" />
                            From {item.containerCount} containers
                          </p>
                          <div className="flex gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => beginEditItem(item)}
                            >
                              <Edit3 className="size-4" /> Edit item
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              className="text-[var(--danger)]"
                              onClick={() =>
                                setDeleteTarget({
                                  kind: "item",
                                  id: item.productId,
                                  label: item.itemCode,
                                })
                              }
                            >
                              <Trash2 className="size-4" /> Delete
                            </Button>
                          </div>
                        </div>
                        <div className="space-y-3">
                          {item.variants.map((variant) => (
                            <div
                              key={variant.variantId}
                              className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-3 sm:p-4"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-3">
                                  <span
                                    className="size-8 rounded-lg border border-black/10"
                                    style={{ background: variant.colorCode }}
                                  />
                                  <div>
                                    <p className="font-semibold">
                                      {variant.color}
                                      {variant.size ? ` · ${variant.size}` : ""}
                                    </p>
                                    <p className="mt-1 text-xs text-[var(--muted)]">
                                      {variant.totalRolls} Rolls ·{" "}
                                      {variant.totalMeters} Meter
                                    </p>
                                    {(variant.totalRolls <=
                                      (settings.data?.lowStockRollThreshold ??
                                        3) ||
                                      variant.totalMeters <=
                                        (settings.data
                                          ?.lowStockMeterThreshold ?? 500)) && (
                                      <span className="mt-1 inline-block rounded-full bg-[var(--warning-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--warning)]">
                                        Low stock
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex gap-1">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => setAdjustTarget(variant)}
                                  >
                                    <Scale className="size-4" /> Adjust
                                  </Button>
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    aria-label={`Edit ${variant.color}`}
                                    onClick={() => beginEditVariant(variant)}
                                  >
                                    <Edit3 className="size-4" />
                                  </Button>
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="text-[var(--danger)]"
                                    aria-label={`Delete ${variant.color}`}
                                    onClick={() =>
                                      setDeleteTarget({
                                        kind: "variant",
                                        id: variant.variantId,
                                        label: `${item.itemCode} · ${variant.color}`,
                                      })
                                    }
                                  >
                                    <Trash2 className="size-4" />
                                  </Button>
                                </div>
                              </div>
                              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                                {variant.batches.map((batch) => (
                                  <div
                                    key={batch.batchId}
                                    className="rounded-lg bg-white p-3 text-xs"
                                  >
                                    <div className="flex justify-between gap-2">
                                      <span className="font-semibold">
                                        {batch.containerNumber}
                                      </span>
                                      <span className="text-[var(--accent)]">
                                        {batch.availableMeter} Meter
                                      </span>
                                    </div>
                                    <p className="mt-1 text-[var(--muted)]">
                                      {batch.availableRolls} Rolls available
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-dashed border-[var(--border-strong)] bg-white px-5 py-14 text-center">
          <Boxes className="mx-auto size-7 text-[var(--accent)]" />
          <h2 className="mt-3 font-semibold">
            {search ? "No matching stock" : "No stock received yet"}
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {search
              ? "Try another item code, color, roll, meter or container."
              : "Receive the first container to see inventory here."}
          </p>
        </div>
      )}

      <Drawer.Root
        open={Boolean(editTarget)}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-[2px]" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 rounded-t-[26px] bg-white p-5 outline-none">
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
                  onClick={() => setEditTarget(null)}
                >
                  <X className="size-4" />
                </Button>
              </div>
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
                    Item name
                    <Input
                      className="mt-2"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </label>
                </div>
              ) : (
                <div className="mt-5 grid gap-4">
                  <label className="text-sm font-medium">
                    Color <span className="text-[var(--danger)]">*</span>
                    <Input
                      className="mt-2"
                      value={color}
                      onChange={(event) => setColor(event.target.value)}
                    />
                  </label>
                  <label className="text-sm font-medium">
                    Size{" "}
                    <span className="font-normal text-[var(--muted)]">
                      (optional)
                    </span>
                    <Input
                      className="mt-2"
                      value={size}
                      onChange={(event) => setSize(event.target.value)}
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
          <Drawer.Overlay className="fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-[2px]" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 rounded-t-[26px] bg-white p-5 outline-none">
            <div className="mx-auto max-w-lg">
              <Drawer.Title className="text-lg font-semibold">
                Adjust {adjustTarget?.color} stock
              </Drawer.Title>
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
          className="fixed inset-0 z-60 grid place-items-center bg-slate-950/40 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm delete"
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
            <span className="grid size-10 place-items-center rounded-lg bg-[var(--danger-soft)] text-[var(--danger)]">
              <Trash2 className="size-5" />
            </span>
            <h2 className="mt-4 text-lg font-semibold">
              Delete {deleteTarget.label}?
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
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
