import { useAutoAnimate } from "@formkit/auto-animate/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ArrowLeft,
  LoaderCircle,
  PackagePlus,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";
import type { SupplierSummary } from "@afia/contracts";
import {
  InlinePartyFields,
  type InlinePartyValues,
  type PartySuggestion,
} from "@/components/inline-party-fields";
import { SearchablePicker } from "@/components/searchable-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getProducts, getSuppliers, receivePurchase } from "@/lib/api";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

import { InvoiceImportPanel } from "./invoice-import-panel";

const normalizeVariantPart = (value = "") =>
  value.trim().toLocaleLowerCase().replace(/\s+/g, "");
const colorRowSchema = z.object({
  color: z.string().trim().min(1, "Color is required."),
  rolls: z.number().int().positive("Enter at least one roll."),
  totalMeter: z.number().min(0, "Meter cannot be negative."),
});
const itemGroupSchema = z
  .object({
    productId: z.string().optional(),
    itemCode: z.string().trim().min(1, "Item code is required."),
    description: z.string().optional(),
    colors: z.array(colorRowSchema).min(1),
  })
  .superRefine((item, context) => {
    const variants = new Set<string>();
    item.colors.forEach((color, index) => {
      if (!color.color.trim()) return;
      const key = normalizeVariantPart(color.color);
      if (variants.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["colors", index, "color"],
          message: "This Color Code is already in this item.",
        });
      }
      variants.add(key);
    });
  });
const schema = z
  .object({
    supplier: z.object({
      id: z.string().optional(),
      name: z.string().trim().min(1, "Supplier name is required."),
      email: z.union([z.email("Enter a valid email."), z.literal("")]),
      phone: z.string(),
      address: z.string(),
    }),
    containerNumber: z.string().trim().min(2),
    purchaseNumber: z.string().trim().min(2),
    purchasedAt: z.string().min(1),
    notes: z.string().optional(),
    items: z.array(itemGroupSchema).min(1),
  })
  .superRefine((purchase, context) => {
    const products = new Set<string>();
    const itemCodes = new Set<string>();
    purchase.items.forEach((item, index) => {
      if (item.productId && products.has(item.productId)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "productId"],
          message: "This item is already included above. Add another color there.",
        });
      }
      if (item.productId) products.add(item.productId);

      const itemCode = normalizeVariantPart(item.itemCode);
      if (itemCode && itemCodes.has(itemCode)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "itemCode"],
          message: "This item code is already included above.",
        });
      }
      if (itemCode) itemCodes.add(itemCode);
    });
  });
type FormData = z.infer<typeof schema>;
const newColor = (): FormData["items"][number]["colors"][number] => ({
  color: "",
  rolls: 1,
  totalMeter: 0,
});
const newItem = (): FormData["items"][number] => ({
  productId: undefined,
  itemCode: "",
  description: "",
  colors: [newColor()],
});

export function PurchaseReceivePage() {
  const navigate = useNavigate();
  const [reviewDirty, setReviewDirty] = useState(false);
  const [reviewDiscardVersion, setReviewDiscardVersion] = useState(0);
  const [entryMode, setEntryMode] = useState<"manual" | "import">("manual");
  const qc = useQueryClient();
  const [supplierSearch, setSupplierSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [selectedSupplier, setSelectedSupplier] =
    useState<SupplierSummary | null>(null);
  const debouncedSupplierSearch = useDebouncedValue(supplierSearch);
  const [list] = useAutoAnimate<HTMLDivElement>();
  const suppliers = useQuery({
    queryKey: ["suppliers", debouncedSupplierSearch],
    queryFn: () => getSuppliers(debouncedSupplierSearch),
    enabled: debouncedSupplierSearch.trim().length >= 2,
  });
  const products = useQuery({
    queryKey: ["products", productSearch],
    queryFn: () => getProducts(productSearch),
  });
  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      supplier: { id: undefined, name: "", email: "", phone: "", address: "" },
      containerNumber: "",
      purchaseNumber: `PUR-${format(new Date(), "yyyyMMdd-HHmm")}`,
      purchasedAt: format(new Date(), "yyyy-MM-dd"),
      notes: "",
      items: [newItem()],
    },
  });
  const fields = useFieldArray({ control: form.control, name: "items" });
  const items = useWatch({ control: form.control, name: "items" });
  const supplier = useWatch({ control: form.control, name: "supplier" });
  const totals = (items ?? []).flatMap((item) => item.colors ?? []).reduce(
    (a, color) => ({
      colors: a.colors + 1,
      rolls:
        a.rolls + (Number.isFinite(color.rolls) ? color.rolls : 0),
      meter:
        a.meter +
        (Number.isFinite(color.totalMeter) ? color.totalMeter : 0),
    }),
    { colors: 0, rolls: 0, meter: 0 },
  );
  const save = useMutation({
    mutationFn: receivePurchase,
    onSuccess: async (r) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["inventory-items"] }),
        qc.invalidateQueries({ queryKey: ["inventory-summary"] }),
        qc.invalidateQueries({ queryKey: ["products"] }),
        qc.invalidateQueries({ queryKey: ["purchases"] }),
      ]);
      toast.success(
        `${r.totalRolls} Rolls · ${r.totalMeter.toLocaleString()} Meter received`,
      );
      navigate("/inventory");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const submit = (v: FormData) => {
    const { items: itemGroups, ...purchase } = v;
    save.mutate({
      ...purchase,
      purchasedAt: new Date(`${v.purchasedAt}T12:00:00`).toISOString(),
      items: itemGroups.map(({ itemCode, description, colors }) => ({ itemCode, description, colors })),
    });
  };
  const supplierSuggestions: PartySuggestion[] = (suppliers.data ?? []).map(
    (item) => ({
      id: item.id,
      name: item.name,
      email: item.email ?? "",
      phone: item.phone ?? "",
      address: item.address ?? "",
    }),
  );
  const productOptions = Array.from(
    new Map(
      (products.data ?? []).map((x) => [
        x.productId,
        {
          value: x.productId,
          label: x.itemCode,
          description: x.description || "Saved item",
          keywords: [x.description || "", x.color || ""],
        },
      ]),
    ).values(),
  );
  const pickProduct = (index: number, productId: string) => {
    const p = products.data?.find((x) => x.productId === productId);
    if (!p) return;
    const duplicate = form
      .getValues("items")
      .some((item, itemIndex) =>
        itemIndex === index
          ? false
          : item.productId === productId ||
            normalizeVariantPart(item.itemCode) ===
              normalizeVariantPart(p.itemCode),
      );
    if (duplicate) {
      toast.error("That item is already included. Add another color to it.");
      return;
    }
    form.setValue(`items.${index}.productId`, productId, {
      shouldValidate: true,
    });
    form.setValue(`items.${index}.itemCode`, p.itemCode);
    form.setValue(`items.${index}.description`, p.description ?? "");
  };
  const setColor = (itemIndex: number, colorIndex: number, value: string) => {
    form.setValue(`items.${itemIndex}.colors.${colorIndex}.color`, value, {
      shouldValidate: true,
    });
  };
  const addColor = (itemIndex: number) => {
    const colors = form.getValues(`items.${itemIndex}.colors`);
    form.setValue(`items.${itemIndex}.colors`, [...colors, newColor()]);
  };
  const removeColor = (itemIndex: number, colorIndex: number) => {
    const colors = form.getValues(`items.${itemIndex}.colors`);
    form.setValue(
      `items.${itemIndex}.colors`,
      colors.filter((_, index) => index !== colorIndex),
    );
  };
  return (
    <div className="mx-auto max-w-350 px-4 pb-32 pt-5 md:px-7 lg:px-8">
      <Link
        to="/purchases"
        className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--muted)] transition-colors hover:text-[var(--primary)]"
      >
        <ArrowLeft className="size-4" /> Purchases
      </Link>
      <div className="mt-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Receive stock</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Add each item once, then enter all of its colors together.
          </p>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Stock entry method">
        <Button type="button" variant={entryMode === "manual" ? "primary" : "outline"} aria-pressed={entryMode === "manual"} onClick={() => {
          if (reviewDirty && !window.confirm("Discard unsaved import review edits and enter manually?")) return;
          if (reviewDirty) setReviewDiscardVersion(v => v + 1);
          setEntryMode("manual");
        }}>Enter Manually</Button>
        <Button type="button" variant={entryMode === "import" ? "primary" : "outline"} aria-pressed={entryMode === "import"} onClick={() => setEntryMode("import")}>Import Commercial Invoice</Button>
      </div>
      <div hidden={entryMode !== "import"}><InvoiceImportPanel onDirtyChange={setReviewDirty} discardVersion={reviewDiscardVersion} /></div>
      <div hidden={entryMode !== "manual"}>
      <form onSubmit={form.handleSubmit(submit)} className="purchase-form-controls mt-5 space-y-5">
        <section aria-label="Purchase information" className="grid border border-[var(--border)] bg-[var(--surface)] xl:grid-cols-2">
          <div className="min-w-0 p-4 sm:p-5">
          <InlinePartyFields
            dense
            autoComplete="off"
            kind="Supplier"
            values={
              (supplier ?? {
                name: "",
                email: "",
                phone: "",
                address: "",
              }) as InlinePartyValues
            }
            selected={
              selectedSupplier
                ? {
                    id: selectedSupplier.id,
                    name: selectedSupplier.name,
                    email: selectedSupplier.email ?? "",
                    phone: selectedSupplier.phone ?? "",
                    address: selectedSupplier.address ?? "",
                  }
                : undefined
            }
            suggestions={supplierSuggestions}
            searching={suppliers.isFetching}
            nameError={form.formState.errors.supplier?.name?.message}
            onSearch={setSupplierSearch}
            onFieldChange={(field, value) => {
              if (selectedSupplier) {
                setSelectedSupplier(null);
                form.setValue("supplier.id", undefined);
              }
              form.setValue(`supplier.${field}`, value, {
                shouldValidate: field === "name" || field === "email",
              });
            }}
            onSelect={(party) => {
              const selected = suppliers.data?.find((x) => x.id === party.id);
              if (!selected) return;
              setSelectedSupplier(selected);
              form.setValue("supplier", {
                id: selected.id,
                name: selected.name,
                email: selected.email ?? "",
                phone: selected.phone ?? "",
                address: selected.address ?? "",
              });
              setSupplierSearch("");
            }}
            onClear={() => {
              setSelectedSupplier(null);
              form.setValue("supplier.id", undefined);
            }}
          />
          <PurchaseFieldError message={form.formState.errors.supplier?.email?.message} />
          </div>
          <div className="min-w-0 border-t border-[var(--border)] p-4 sm:p-5 xl:border-t-0 xl:border-l">
          <h2 className="text-sm font-semibold">Container & reference</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">Enter the Commercial Invoice Contract No. as Container Number.</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="min-w-0 text-xs font-medium">
              Container Number
              <Input
                className="mt-1 h-11 min-w-0"
                placeholder="B0312614"
                {...form.register("containerNumber")}
              />
              <PurchaseFieldError message={form.formState.errors.containerNumber?.message} />
            </label>
            <label className="min-w-0 text-xs font-medium">
              Reference / invoice
              <Input className="mt-1 h-11 min-w-0" {...form.register("purchaseNumber")} />
              <PurchaseFieldError message={form.formState.errors.purchaseNumber?.message} />
            </label>
            <label className="min-w-0 text-xs font-medium">
              Purchase date
              <Input
                className="mt-1 h-11 min-w-0"
                type="date"
                {...form.register("purchasedAt")}
              />
              <PurchaseFieldError message={form.formState.errors.purchasedAt?.message} />
            </label>
            <label className="min-w-0 text-xs font-medium">
              Note{" "}
              <span className="font-normal text-[var(--muted)]">
                (optional)
              </span>
              <Input className="mt-1 h-11 min-w-0" {...form.register("notes")} />
            </label>
          </div>
          </div>
        </section>
        <section aria-labelledby="received-items-heading" className="border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-4 sm:px-5">
            <div><h2 id="received-items-heading" className="text-base font-semibold">Received items</h2><p className="mt-1 text-xs text-[var(--muted)]">Choose a saved item or enter a new code. Add its colors below.</p></div>
            <span className="text-xs text-[var(--muted)]">{fields.fields.length} {fields.fields.length === 1 ? "item" : "items"}</span>
          </div>
        <div ref={list}>
          {fields.fields.map((field, itemIndex) => {
            const item = items?.[itemIndex];
            const error = form.formState.errors.items?.[itemIndex];
            const selectedProductIds = new Set(
              (items ?? [])
                .filter((_, index) => index !== itemIndex)
                .map((candidate) => candidate.productId)
                .filter(Boolean),
            );
            const availableProductOptions = productOptions.filter(
              (option) => !selectedProductIds.has(option.value),
            );
            return (
              <section
                key={field.id}
                className="border-b border-[var(--border)] p-4 sm:p-5"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--primary)]">
                      Item {itemIndex + 1}
                    </h3>
                  </div>
                  {fields.fields.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove item ${itemIndex + 1}`}
                      onClick={() => fields.remove(itemIndex)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
                <div className="min-w-0">
                  <p className="mb-1 text-xs font-medium">Existing item</p>
                  <SearchablePicker
                    purchasePresentation
                    triggerClassName="min-h-11 rounded-md px-3 shadow-none"
                    label="Existing item"
                    placeholder="Search item code or description..."
                    searchPlaceholder="Search items..."
                    options={availableProductOptions}
                    value={item?.productId}
                    onChange={(v) => pickProduct(itemIndex, v)}
                    onSearchChange={setProductSearch}
                  />
                  {error?.productId && (
                    <span className="text-xs text-[var(--danger)]">
                      {error.productId.message}
                    </span>
                  )}
                </div>
                <div className="grid min-w-0 grid-cols-2 gap-3">
                  <label className="min-w-0 text-xs font-medium">
                    Item code
                    <Input
                      className="mt-1 h-11 min-w-0"
                      placeholder="AL-101"
                      readOnly={Boolean(item?.productId)}
                      {...form.register(`items.${itemIndex}.itemCode`)}
                    />
                    {error?.itemCode && (
                      <span className="text-xs text-[var(--danger)]">
                        {error.itemCode.message}
                      </span>
                    )}
                  </label>
                  <label className="min-w-0 text-xs font-medium">
                    Description / Size
                    <Input
                      className="mt-1 h-11 min-w-0"
                      placeholder='1.2mm*54"*36.5m'
                      readOnly={Boolean(item?.productId)}
                      {...form.register(`items.${itemIndex}.description`)}
                    />
                    {item?.productId && <span className="mt-1 block font-normal text-[var(--muted)]">Saved item description. Change it in Inventory before receiving if needed.</span>}
                  </label>
                </div>
                </div>
                <div className="mt-4 border-t border-[var(--border)] pt-3">
                  <div className="mb-3 flex items-center justify-between">
                    <h4 className="text-xs font-semibold">Colors and stock</h4>
                    <span className="text-xs text-[var(--muted)]">
                      {item?.colors?.length ?? 0} color(s)
                    </span>
                  </div>
                  <div className="divide-y divide-[var(--border)]">
                    {(item?.colors ?? []).map((color, colorIndex) => {
                      const colorError = error?.colors?.[colorIndex];
                      return (
                        <div
                          key={colorIndex}
                          className="py-3 first:pt-0"
                        >
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-medium text-[var(--muted)]">
                              Color {colorIndex + 1}
                            </p>
                            {(item?.colors?.length ?? 0) > 1 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Remove color ${colorIndex + 1} from item ${itemIndex + 1}`}
                                onClick={() =>
                                  removeColor(itemIndex, colorIndex)
                                }
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            )}
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                            <label className="min-w-0 text-xs font-medium">
                              Color Code
                              <Input
                                className="mt-1 h-11 min-w-0"
                                placeholder="02#Pine green"
                                value={color.color ?? ""}
                                onChange={(event) =>
                                  setColor(
                                    itemIndex,
                                    colorIndex,
                                    event.target.value,
                                  )
                                }
                              />
                              {colorError?.color && (
                                <span className="text-xs text-[var(--danger)]">
                                  {colorError.color.message}
                                </span>
                              )}
                            </label>
                            <label className="min-w-0 text-xs font-medium">
                              Rolls
                              <Input
                                className="mt-1 h-11 min-w-0"
                                type="number"
                                min="1"
                                inputMode="numeric"
                                {...form.register(
                                  `items.${itemIndex}.colors.${colorIndex}.rolls`,
                                  { valueAsNumber: true },
                                )}
                              />
                              <PurchaseFieldError message={colorError?.rolls?.message} />
                            </label>
                            <label className="min-w-0 text-xs font-medium">
                              Meter{" "}
                              <span className="font-normal text-[var(--muted)]">
                                (optional)
                              </span>
                              <Input
                                className="mt-1 h-11 min-w-0"
                                type="number"
                                min="0"
                                step="0.01"
                                inputMode="decimal"
                                {...form.register(
                                  `items.${itemIndex}.colors.${colorIndex}.totalMeter`,
                                  {
                                    setValueAs: (value) =>
                                      value === "" ? 0 : Number(value),
                                  },
                                )}
                              />
                              <PurchaseFieldError message={colorError?.totalMeter?.message} />
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-2 px-3 text-xs"
                    onClick={() => addColor(itemIndex)}
                  >
                    <Plus className="size-4" /> Add another color
                  </Button>
                </div>
              </section>
            );
          })}
        </div>
        <Button
          type="button"
          variant="outline"
          className="mx-4 my-3 px-3 sm:mx-5"
          onClick={() => fields.append(newItem())}
        >
          <Plus className="size-4" /> Add another item
        </Button>
        </section>
        <section aria-label="Purchase summary and receiving action" className="sticky bottom-20 z-20 border border-[var(--border)] bg-[var(--surface)] p-3 lg:bottom-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 sm:flex-1">
          <h2 className="text-xs font-semibold">Purchase summary</h2>
          <div className="mt-2 grid grid-cols-3 gap-3 divide-x divide-[var(--border)] text-center tabular-nums sm:max-w-md">
            <div>
              <strong className="block break-words text-lg font-semibold">{totals.colors}</strong>
              <span className="text-xs text-[var(--muted)]">Colors</span>
            </div>
            <div>
              <strong className="block break-words text-lg font-semibold">{totals.rolls}</strong>
              <span className="text-xs text-[var(--muted)]">Rolls</span>
            </div>
            <div>
              <strong className="block break-words text-lg font-semibold">
                {totals.meter.toLocaleString()}
              </strong>
              <span className="text-xs text-[var(--muted)]">Meter</span>
            </div>
          </div>
          </div>
          <Button
            type="submit"
            className="w-full shrink-0 sm:w-auto"
            disabled={save.isPending}
          >
            {save.isPending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <PackagePlus className="size-4" />
            )}{" "}
            Receive stock
          </Button>
          </div>
        </section>
      </form>
      </div>
    </div>
  );
}


function PurchaseFieldError({ message }: { message?: string }) {
  return message ? <span role="alert" className="mt-1 block text-xs text-[var(--danger)]">{message}</span> : null;
}
