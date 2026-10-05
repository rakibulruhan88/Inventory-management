import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ArrowLeft,
  LoaderCircle,
  Plus,
  ReceiptText,
  Trash2,
} from "lucide-react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";
import type { CustomerSummary } from "@afia/contracts";
import {
  InlinePartyFields,
  type InlinePartyValues,
  type PartySuggestion,
} from "@/components/inline-party-fields";
import { SearchablePicker } from "@/components/searchable-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createSale, getCustomers, getProducts, getSettings } from "@/lib/api";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

const saleLine = z.object({
  variantId: z.string().min(1, "Choose an item and color."),
  rollsSold: z.number().int().min(1, "Enter at least one roll."),
  meterSold: z.number().min(0, "Meter cannot be negative."),
  lineTotal: z.number().positive("Enter the price for this item."),
});
const saleItem = z
  .object({
    productId: z.string().min(1, "Choose an item."),
    colors: z.array(saleLine).min(1),
  })
  .superRefine((item, context) => {
    const variants = new Set<string>();
    item.colors.forEach((color, index) => {
      if (!color.variantId) return;
      if (variants.has(color.variantId)) {
        context.addIssue({
          code: "custom",
          path: ["colors", index, "variantId"],
          message: "This color is already included for this item.",
        });
      }
      variants.add(color.variantId);
    });
  });
const schema = z
  .object({
    customer: z.object({
      id: z.string().optional(),
      name: z.string().trim().min(1, "Customer name is required."),
      email: z.union([z.email("Enter a valid email."), z.literal("")]),
      phone: z.string(),
      address: z.string(),
    }),
    soldAt: z.string().min(1),
    discountAmount: z.number().min(0),
    receivedAmount: z.number().min(0),
    paymentMethod: z.enum(["CASH", "BANK", "MOBILE_BANKING", "OTHER"]),
    emailInvoice: z.boolean(),
    notes: z.string().optional(),
    items: z.array(saleItem).min(1),
  })
  .superRefine((sale, context) => {
    const products = new Set<string>();
    sale.items.forEach((item, index) => {
      if (!item.productId) return;
      if (products.has(item.productId)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "productId"],
          message: "This item is already included above. Add another color there.",
        });
      }
      products.add(item.productId);
    });
  });
type FormData = z.infer<typeof schema>;
const blankColor = (): FormData["items"][number]["colors"][number] => ({
  variantId: "",
  rollsSold: 1,
  meterSold: 0,
  lineTotal: 0,
});
const blankItem = (): FormData["items"][number] => ({
  productId: "",
  colors: [blankColor()],
});
const numberValue = (value: unknown) => (value === "" ? 0 : Number(value));

export function NewSalePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] =
    useState<CustomerSummary | null>(null);
  const debouncedCustomerSearch = useDebouncedValue(customerSearch);
  const customers = useQuery({
    queryKey: ["customers", debouncedCustomerSearch],
    queryFn: () => getCustomers(debouncedCustomerSearch),
    enabled: debouncedCustomerSearch.trim().length >= 2,
  });
  const products = useQuery({
    queryKey: ["products"],
    queryFn: () => getProducts(),
  });
  const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const symbol = settings.data?.currencySymbol ?? "৳";
  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      customer: { id: undefined, name: "", email: "", phone: "", address: "" },
      soldAt: format(new Date(), "yyyy-MM-dd"),
      discountAmount: 0,
      receivedAmount: 0,
      paymentMethod: "CASH",
      emailInvoice: true,
      notes: "",
      items: [blankItem()],
    },
  });
  const fields = useFieldArray({ control: form.control, name: "items" });
  const values = useWatch({ control: form.control });
  const subtotal = (values.items ?? [])
    .flatMap((item) => item.colors ?? [])
    .reduce((sum, color) => sum + (color?.lineTotal || 0), 0);
  const grandTotal = Math.max(subtotal - (values.discountAmount || 0), 0);
  const received = values.receivedAmount || 0;
  const paid = Math.min(received, grandTotal);
  const due = Math.max(grandTotal - received, 0);
  const change = Math.max(received - grandTotal, 0);

  const save = useMutation({
    mutationFn: createSale,
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["inventory"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory-summary"] }),
        queryClient.invalidateQueries({ queryKey: ["sales"] }),
        queryClient.invalidateQueries({ queryKey: ["customers"] }),
        queryClient.invalidateQueries({ queryKey: ["products"] }),
      ]);
      toast.success(
        result.emailStatus === "sent"
          ? "Sale completed and invoice emailed."
          : result.emailStatus === "failed"
            ? "Sale completed, but the invoice email could not be sent."
            : "Sale completed successfully",
      );
      navigate(`/sales/${result.id}/invoice`);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const customerSuggestions: PartySuggestion[] = (customers.data ?? []).map(
    (customer) => ({
      id: customer.id,
      name: customer.name,
      phone: customer.phone ?? "",
      email: customer.email ?? "",
      address: customer.address ?? "",
      due: customer.totalDue,
    }),
  );
  const productOptions = Array.from(
    new Map(
      (products.data ?? [])
        .filter((product) => product.availableRolls > 0)
        .map((product) => [
          product.productId,
          {
            value: product.productId,
            label: product.itemCode,
            description: product.name || "Saved item",
            keywords: [product.name || "", product.color || ""],
          },
        ]),
    ).values(),
  );
  const selectProduct = (itemIndex: number, productId: string) => {
    const duplicate = form
      .getValues("items")
      .some((item, index) =>
        index === itemIndex ? false : item.productId === productId,
      );
    if (duplicate) {
      toast.error("That item is already included. Add another color to it.");
      return;
    }
    form.setValue(`items.${itemIndex}.productId`, productId, {
      shouldValidate: true,
    });
    form.setValue(`items.${itemIndex}.colors`, [blankColor()]);
  };
  const addColor = (itemIndex: number) => {
    const colors = form.getValues(`items.${itemIndex}.colors`);
    form.setValue(`items.${itemIndex}.colors`, [...colors, blankColor()]);
  };
  const removeColor = (itemIndex: number, colorIndex: number) => {
    const colors = form.getValues(`items.${itemIndex}.colors`);
    form.setValue(
      `items.${itemIndex}.colors`,
      colors.filter((_, index) => index !== colorIndex),
    );
  };
  const selectColor = (
    itemIndex: number,
    colorIndex: number,
    variantId: string,
  ) => {
    const duplicate = form
      .getValues(`items.${itemIndex}.colors`)
      .some((color, index) =>
        index === colorIndex ? false : color.variantId === variantId,
      );
    if (duplicate) {
      toast.error("That color is already included for this item.");
      return;
    }
    form.setValue(
      `items.${itemIndex}.colors.${colorIndex}.variantId`,
      variantId,
      { shouldValidate: true },
    );
  };
  const submit = (data: FormData) => {
    const { items, ...sale } = data;
    save.mutate({
      ...sale,
      soldAt: new Date(`${data.soldAt}T12:00:00`).toISOString(),
      lines: items.flatMap((item) =>
        item.colors.map((color) => ({
          ...color,
          meterSold: color.meterSold > 0 ? color.meterSold : undefined,
        })),
      ),
    });
  };

  return (
    <div className="mx-auto max-w-4xl px-4 pb-32 pt-5 md:px-7 lg:px-10">
      <Link
        to="/sales"
        className="flex min-h-11 items-center gap-2 text-sm text-[var(--muted)]"
      >
        <ArrowLeft className="size-4" /> Sales
      </Link>
      <div className="mt-3 flex gap-4">
        <span className="grid size-11 place-items-center rounded-xl bg-[var(--surface-warm)] text-[var(--accent)]">
          <ReceiptText className="size-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">New sale</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Choose each item once, then add the colors being sold.
          </p>
        </div>
      </div>
      <form onSubmit={form.handleSubmit(submit)} className="mt-7 space-y-5">
        <section className="rounded-xl border border-[var(--border)] bg-white p-4 shadow-[var(--shadow-card)] sm:p-5">
          <InlinePartyFields
            kind="Customer"
            values={
              (values.customer ?? {
                name: "",
                email: "",
                phone: "",
                address: "",
              }) as InlinePartyValues
            }
            selected={
              selectedCustomer
                ? {
                    id: selectedCustomer.id,
                    name: selectedCustomer.name,
                    email: selectedCustomer.email ?? "",
                    phone: selectedCustomer.phone ?? "",
                    address: selectedCustomer.address ?? "",
                    due: selectedCustomer.totalDue,
                  }
                : undefined
            }
            suggestions={customerSuggestions}
            searching={customers.isFetching}
            currencySymbol={symbol}
            nameError={form.formState.errors.customer?.name?.message}
            onSearch={setCustomerSearch}
            onFieldChange={(field, value) => {
              if (selectedCustomer) {
                setSelectedCustomer(null);
                form.setValue("customer.id", undefined);
              }
              form.setValue(`customer.${field}`, value, {
                shouldValidate: field === "name" || field === "email",
              });
            }}
            onSelect={(party) => {
              const selected = customers.data?.find((x) => x.id === party.id);
              if (!selected) return;
              setSelectedCustomer(selected);
              form.setValue("customer", {
                id: selected.id,
                name: selected.name,
                email: selected.email ?? "",
                phone: selected.phone ?? "",
                address: selected.address ?? "",
              });
              setCustomerSearch("");
            }}
            onClear={() => {
              setSelectedCustomer(null);
              form.setValue("customer.id", undefined);
            }}
          />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl bg-[var(--surface-subtle)] px-4 py-3 text-sm">
              <span className="text-[var(--muted)]">Invoice number</span>
              <strong className="mt-1 block">Assigned automatically</strong>
            </div>
            <label className="text-sm font-medium">
              Sale date
              <Input
                className="mt-2"
                type="date"
                {...form.register("soldAt")}
              />
            </label>
          </div>
          {values.customer?.email && (
            <label className="mt-4 flex min-h-12 items-center gap-3 rounded-xl bg-[var(--surface-warm)] px-4 text-sm">
              <input
                className="size-4 accent-[var(--accent)]"
                type="checkbox"
                {...form.register("emailInvoice")}
              />
              <span>
                Email invoice to <strong>{values.customer.email}</strong>
              </span>
            </label>
          )}
        </section>

        {fields.fields.map((field, itemIndex) => {
          const item = values.items?.[itemIndex];
          const selectedProduct = products.data?.find(
            (product) => product.productId === item?.productId,
          );
          const selectedProductIds = new Set(
            (values.items ?? [])
              .filter((_, index) => index !== itemIndex)
              .map((candidate) => candidate.productId),
          );
          const availableProductOptions = productOptions.filter(
            (option) => !selectedProductIds.has(option.value),
          );
          const baseColorOptions = (products.data ?? [])
            .filter(
              (product) =>
                product.productId === item?.productId &&
                product.availableRolls > 0,
            )
            .map((product) => ({
              value: product.variantId,
              label: `${product.color || "Unnamed color"}${product.size ? ` · ${product.size}` : ""}`,
              description: `${product.availableRolls} Rolls · ${product.availableMeter.toLocaleString()} Meter available`,
              keywords: [product.color || "", product.size || ""],
            }));
          const error = form.formState.errors.items?.[itemIndex];
          return (
            <section
              key={field.id}
              className="rounded-xl border border-[var(--border)] bg-white p-4 shadow-[var(--shadow-card)] sm:p-5"
            >
              <div className="flex justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-[var(--accent)]">
                    Item {itemIndex + 1}
                  </p>
                  <h2 className="mt-1 font-semibold">
                    {selectedProduct?.name ||
                      selectedProduct?.itemCode ||
                      "Choose an item"}
                  </h2>
                  {selectedProduct?.name && (
                    <p className="text-xs text-[var(--muted)]">
                      {selectedProduct.itemCode}
                    </p>
                  )}
                </div>
                {fields.fields.length > 1 && (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => fields.remove(itemIndex)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
              <div className="mt-4">
                <SearchablePicker
                  label="Search item"
                  placeholder="Search item code or name..."
                  searchPlaceholder="Search stock..."
                  options={availableProductOptions}
                  value={item?.productId}
                  onChange={(value) => selectProduct(itemIndex, value)}
                />
                {error?.productId && (
                  <span className="text-xs text-[var(--danger)]">
                    {error.productId.message}
                  </span>
                )}
              </div>
              <div className="mt-5 border-t border-[var(--border)] pt-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Colors being sold</h3>
                  <span className="text-xs text-[var(--muted)]">
                    {item?.colors?.length ?? 0} color(s)
                  </span>
                </div>
                <div className="space-y-3">
                  {(item?.colors ?? []).map((color, colorIndex) => {
                    const selectedColor = products.data?.find(
                      (product) => product.variantId === color.variantId,
                    );
                    const colorError = error?.colors?.[colorIndex];
                    const selectedVariantIds = new Set(
                      (item?.colors ?? [])
                        .filter((_, index) => index !== colorIndex)
                        .map((candidate) => candidate.variantId),
                    );
                    const colorOptions = baseColorOptions.filter(
                      (option) => !selectedVariantIds.has(option.value),
                    );
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
                              size="icon"
                              variant="ghost"
                              onClick={() =>
                                removeColor(itemIndex, colorIndex)
                              }
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          )}
                        </div>
                        <div className="mt-2">
                          <SearchablePicker
                            label="Color"
                            placeholder={
                              item?.productId
                                ? "Choose a color..."
                                : "Choose an item first"
                            }
                            searchPlaceholder="Search colors..."
                            options={colorOptions}
                            value={color.variantId}
                            onChange={(value) =>
                              selectColor(itemIndex, colorIndex, value)
                            }
                          />
                          {colorError?.variantId && (
                            <span className="text-xs text-[var(--danger)]">
                              {colorError.variantId.message}
                            </span>
                          )}
                        </div>
                        {selectedColor && (
                          <div className="mt-2 flex items-center gap-3 rounded-lg bg-[var(--surface-warm)] px-3 py-2">
                            <span
                              className="size-8 rounded-lg border border-black/10"
                              style={{ background: selectedColor.colorCode }}
                            />
                            <div className="text-xs text-[var(--muted)]">
                              <p className="font-medium text-[var(--foreground)]">
                                {selectedColor.color}
                                {selectedColor.size
                                  ? ` · ${selectedColor.size}`
                                  : ""}
                              </p>
                              <p>
                                Available:{" "}
                                <strong>
                                  {selectedColor.availableRolls} Rolls
                                </strong>{" "}
                                · {selectedColor.availableMeter.toLocaleString()} Meter
                              </p>
                            </div>
                          </div>
                        )}
                        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                          <label className="text-sm font-medium">
                            Rolls Sold *
                            <Input
                              className="mt-1 h-9 bg-white"
                              type="number"
                              min="1"
                              max={selectedColor?.availableRolls}
                              {...form.register(
                                `items.${itemIndex}.colors.${colorIndex}.rollsSold`,
                                { valueAsNumber: true },
                              )}
                            />
                            {colorError?.rollsSold && (
                              <span className="text-xs text-[var(--danger)]">
                                {colorError.rollsSold.message}
                              </span>
                            )}
                          </label>
                          <label className="text-sm font-medium">
                            Meter{" "}
                            <span className="font-normal text-[var(--muted)]">
                              (optional)
                            </span>
                            <Input
                              className="mt-1 h-9 bg-white"
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="Leave blank"
                              {...form.register(
                                `items.${itemIndex}.colors.${colorIndex}.meterSold`,
                                { setValueAs: numberValue },
                              )}
                            />
                            {colorError?.meterSold && (
                              <span className="text-xs text-[var(--danger)]">
                                {colorError.meterSold.message}
                              </span>
                            )}
                          </label>
                          <label className="col-span-2 text-sm font-medium">
                            Price / Amount *
                            <div className="relative mt-1">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]">
                                {symbol}
                              </span>
                              <Input
                                className="h-9 bg-white pl-8"
                                type="number"
                                min="0.01"
                                step="0.01"
                                {...form.register(
                                  `items.${itemIndex}.colors.${colorIndex}.lineTotal`,
                                  { valueAsNumber: true },
                                )}
                              />
                            </div>
                            {colorError?.lineTotal && (
                              <span className="text-xs text-[var(--danger)]">
                                {colorError.lineTotal.message}
                              </span>
                            )}
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
                  disabled={
                    !item?.productId ||
                    (item.colors ?? []).filter((color) => color.variantId)
                      .length >= baseColorOptions.length
                  }
                  onClick={() => addColor(itemIndex)}
                >
                  <Plus className="size-4" /> Add another color
                </Button>
              </div>
            </section>
          );
        })}
        <Button
          type="button"
          variant="outline"
          className="w-full border-dashed"
          onClick={() => fields.append(blankItem())}
        >
          <Plus className="size-4" /> Add another item
        </Button>
        <section className="rounded-2xl bg-[var(--sidebar)] p-5">
          <h2 className="font-semibold">Payment summary</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--muted)]">Subtotal</span>
                <strong>
                  {symbol}
                  {subtotal.toLocaleString()}
                </strong>
              </div>
              <label className="flex items-center justify-between gap-4">
                <span className="text-[var(--muted)]">Discount</span>
                <Input
                  className="h-10 w-36 bg-white text-right"
                  type="number"
                  min="0"
                  step="0.01"
                  {...form.register("discountAmount", {
                    setValueAs: numberValue,
                  })}
                />
              </label>
              <div className="flex justify-between border-t border-[var(--border-strong)] pt-3 text-base">
                <span>Grand Total</span>
                <strong>
                  {symbol}
                  {grandTotal.toLocaleString()}
                </strong>
              </div>
            </div>
            <div className="space-y-3 text-sm">
              <label>
                <span className="font-medium">
                  Customer Gave / Amount Received
                </span>
                <Input
                  className="mt-2 bg-white"
                  type="number"
                  min="0"
                  step="0.01"
                  {...form.register("receivedAmount", {
                    setValueAs: numberValue,
                  })}
                />
              </label>
              <div>
                <span className="font-medium">Payment method</span>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {(
                    [
                      ["CASH", "Cash"],
                      ["BANK", "Bank"],
                      ["MOBILE_BANKING", "Mobile Banking"],
                      ["OTHER", "Other"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      type="button"
                      key={value}
                      onClick={() => form.setValue("paymentMethod", value)}
                      className={`min-h-11 rounded-xl border bg-white px-2 text-xs ${values.paymentMethod === value ? "border-[var(--accent)] ring-1 ring-[var(--accent)]" : "border-[var(--border)]"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl bg-white p-3">
                  <span className="text-xs text-[var(--muted)]">Paid</span>
                  <strong className="mt-1 block">
                    {symbol}
                    {paid.toLocaleString()}
                  </strong>
                </div>
                <div className="rounded-xl bg-white p-3">
                  <span className="text-xs text-[var(--muted)]">Due</span>
                  <strong className="mt-1 block text-[var(--warning)]">
                    {symbol}
                    {due.toLocaleString()}
                  </strong>
                </div>
                <div className="rounded-xl bg-white p-3">
                  <span className="text-xs text-[var(--muted)]">Change</span>
                  <strong className="mt-1 block">
                    {symbol}
                    {change.toLocaleString()}
                  </strong>
                </div>
              </div>
            </div>
          </div>
        </section>
        <label className="block rounded-xl border border-[var(--border)] bg-white p-4 text-sm font-medium shadow-[var(--shadow-card)]">
          Notes{" "}
          <span className="font-normal text-[var(--muted)]">(optional)</span>
          <Input className="mt-2" {...form.register("notes")} />
        </label>
        <div className="sticky bottom-20 z-20 rounded-xl border border-[var(--border)] bg-white/95 p-3 shadow-[var(--shadow-float)] backdrop-blur lg:bottom-4">
          <Button
            variant="premium"
            className="w-full"
            disabled={save.isPending || subtotal <= 0}
          >
            {save.isPending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <ReceiptText className="size-4" />
            )}{" "}
            Complete Sale
          </Button>
        </div>
      </form>
    </div>
  );
}
