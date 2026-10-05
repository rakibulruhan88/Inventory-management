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

const commonColors: Record<string, string> = {
  black: "#000000",
  white: "#FFFFFF",
  red: "#C0392B",
  brown: "#8B5A2B",
  green: "#2E7D32",
  blue: "#1565C0",
  grey: "#808080",
  gray: "#808080",
  beige: "#F5F5DC",
  tan: "#D2B48C",
  navy: "#000080",
};
const normalizeVariantPart = (value = "") =>
  value.trim().toLocaleLowerCase().replace(/\s+/g, "");
const colorRowSchema = z.object({
  size: z.string().optional(),
  color: z.string().trim().min(1, "Color is required."),
  colorCode: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex color."),
  rolls: z.number().int().positive("Enter at least one roll."),
  totalMeter: z.number().min(0, "Meter cannot be negative."),
});
const itemGroupSchema = z
  .object({
    productId: z.string().optional(),
    itemCode: z.string().trim().min(1, "Item code is required."),
    name: z.string().optional(),
    colors: z.array(colorRowSchema).min(1),
  })
  .superRefine((item, context) => {
    const variants = new Set<string>();
    item.colors.forEach((color, index) => {
      if (!color.color.trim()) return;
      const key = `${normalizeVariantPart(color.color)}::${normalizeVariantPart(color.size)}`;
      if (variants.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["colors", index, "color"],
          message: "This color and size is already in this item.",
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
  size: "",
  color: "",
  colorCode: "#8B5A2B",
  rolls: 1,
  totalMeter: 0,
});
const newItem = (): FormData["items"][number] => ({
  productId: undefined,
  itemCode: "",
  name: "",
  colors: [newColor()],
});

export function PurchaseReceivePage() {
  const navigate = useNavigate();
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
        qc.invalidateQueries({ queryKey: ["inventory"] }),
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
      items: itemGroups.flatMap(({ itemCode, name, colors }) =>
        colors.map((color) => ({ itemCode, name, ...color })),
      ),
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
          description: x.name || "Saved item",
          keywords: [x.name || "", x.color || ""],
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
    form.setValue(`items.${index}.name`, p.name ?? "");
  };
  const setColor = (itemIndex: number, colorIndex: number, value: string) => {
    form.setValue(`items.${itemIndex}.colors.${colorIndex}.color`, value, {
      shouldValidate: true,
    });
    const hex = commonColors[value.trim().toLowerCase()];
    if (hex)
      form.setValue(
        `items.${itemIndex}.colors.${colorIndex}.colorCode`,
        hex,
        { shouldValidate: true },
      );
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
    <div className="mx-auto max-w-5xl px-4 pb-32 pt-5 md:px-7 lg:px-10">
      <Link
        to="/purchases"
        className="flex min-h-11 items-center gap-2 text-sm text-[var(--muted)]"
      >
        <ArrowLeft className="size-4" /> Purchases
      </Link>
      <div className="mt-3 flex gap-4">
        <span className="grid size-11 place-items-center rounded-xl bg-[var(--surface-warm)] text-[var(--accent)]">
          <PackagePlus className="size-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">Receive stock</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Add each item once, then enter all of its colors together.
          </p>
        </div>
      </div>
      <form onSubmit={form.handleSubmit(submit)} className="mt-7 space-y-5">
        <section className="rounded-xl border border-[var(--border)] bg-white p-4 shadow-[var(--shadow-card)] sm:p-5">
          <InlinePartyFields
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
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">
              Container number
              <Input
                className="mt-2"
                placeholder="CN-1009"
                {...form.register("containerNumber")}
              />
            </label>
            <label className="text-sm font-medium">
              Reference / invoice
              <Input className="mt-2" {...form.register("purchaseNumber")} />
            </label>
            <label className="text-sm font-medium">
              Purchase date
              <Input
                className="mt-2"
                type="date"
                {...form.register("purchasedAt")}
              />
            </label>
            <label className="text-sm font-medium">
              Note{" "}
              <span className="font-normal text-[var(--muted)]">
                (optional)
              </span>
              <Input className="mt-2" {...form.register("notes")} />
            </label>
          </div>
        </section>
        <div ref={list} className="space-y-4">
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
                className="rounded-xl border border-[var(--border)] bg-white p-4 shadow-[var(--shadow-card)] sm:p-5"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-[var(--accent)]">
                      Item {itemIndex + 1}
                    </p>
                    <h2 className="mt-1 font-semibold">Item details</h2>
                  </div>
                  {fields.fields.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => fields.remove(itemIndex)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
                <div className="mt-4">
                  <SearchablePicker
                    label="Existing item"
                    placeholder="Search item code or name..."
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
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-medium">
                    Item code
                    <Input
                      className="mt-2"
                      placeholder="AL-101"
                      {...form.register(`items.${itemIndex}.itemCode`)}
                    />
                    {error?.itemCode && (
                      <span className="text-xs text-[var(--danger)]">
                        {error.itemCode.message}
                      </span>
                    )}
                  </label>
                  <label className="text-sm font-medium">
                    Item name
                    <Input
                      className="mt-2"
                      placeholder="Premium cow leather"
                      {...form.register(`items.${itemIndex}.name`)}
                    />
                  </label>
                </div>
                <div className="mt-5 border-t border-[var(--border)] pt-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Colors and stock</h3>
                    <span className="text-xs text-[var(--muted)]">
                      {item?.colors?.length ?? 0} color(s)
                    </span>
                  </div>
                  <div className="space-y-3">
                    {(item?.colors ?? []).map((color, colorIndex) => {
                      const colorError = error?.colors?.[colorIndex];
                      return (
                        <div
                          key={colorIndex}
                          className="rounded-lg bg-[var(--surface-subtle)] p-3"
                        >
                          <div className="flex items-center justify-between">
                            <p className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">
                              Color {colorIndex + 1}
                            </p>
                            {(item?.colors?.length ?? 0) > 1 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                  removeColor(itemIndex, colorIndex)
                                }
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            )}
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-5">
                            <label className="col-span-2 text-sm font-medium lg:col-span-1">
                              Color name
                              <Input
                                className="mt-1 h-9"
                                placeholder="Black"
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
                            <label className="col-span-2 text-sm font-medium lg:col-span-1">
                              Color code
                              <div className="mt-1 flex gap-2">
                                <span
                                  className="size-9 shrink-0 rounded-lg border border-[var(--border)]"
                                  style={{ background: color.colorCode }}
                                />
                                <Input
                                  className="h-9"
                                  {...form.register(
                                    `items.${itemIndex}.colors.${colorIndex}.colorCode`,
                                  )}
                                />
                              </div>
                              {colorError?.colorCode && (
                                <span className="text-xs text-[var(--danger)]">
                                  {colorError.colorCode.message}
                                </span>
                              )}
                            </label>
                            <label className="text-sm font-medium">
                              Size{" "}
                              <span className="font-normal text-[var(--muted)]">
                                (optional)
                              </span>
                              <Input
                                className="mt-1 h-9"
                                placeholder="e.g. 1.2–1.4 mm"
                                {...form.register(
                                  `items.${itemIndex}.colors.${colorIndex}.size`,
                                )}
                              />
                            </label>
                            <label className="text-sm font-medium">
                              Rolls
                              <Input
                                className="mt-1 h-9"
                                type="number"
                                min="1"
                                inputMode="numeric"
                                {...form.register(
                                  `items.${itemIndex}.colors.${colorIndex}.rolls`,
                                  { valueAsNumber: true },
                                )}
                              />
                            </label>
                            <label className="text-sm font-medium">
                              Meter{" "}
                              <span className="font-normal text-[var(--muted)]">
                                (optional)
                              </span>
                              <Input
                                className="mt-1 h-9"
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
                            </label>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-3 w-full border-dashed"
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
          className="w-full border-dashed"
          onClick={() => fields.append(newItem())}
        >
          <Plus className="size-4" /> Add another item
        </Button>
        <section className="rounded-2xl bg-[var(--sidebar)] p-5">
          <p className="text-sm font-semibold">Purchase summary</p>
          <div className="mt-3 grid grid-cols-3 gap-3 text-center">
            <div>
              <strong className="block text-xl">{totals.colors}</strong>
              <span className="text-xs text-[var(--muted)]">Colors</span>
            </div>
            <div>
              <strong className="block text-xl">{totals.rolls}</strong>
              <span className="text-xs text-[var(--muted)]">Rolls</span>
            </div>
            <div>
              <strong className="block text-xl">
                {totals.meter.toLocaleString()}
              </strong>
              <span className="text-xs text-[var(--muted)]">Meter</span>
            </div>
          </div>
        </section>
        <div className="sticky bottom-20 z-20 rounded-xl border border-[var(--border)] bg-white/95 p-3 shadow-[var(--shadow-float)] backdrop-blur lg:bottom-4">
          <Button
            variant="premium"
            className="w-full"
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
      </form>
    </div>
  );
}
