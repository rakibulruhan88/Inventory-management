import { MAX_SALE_AMOUNT } from "@afia/contracts";
import {
  addColorRow,
  removeColorRow,
  previewSubtotal,
  stockErrors,
} from "./new-sale-domain";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, LoaderCircle, Plus } from "lucide-react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  newSaleSchema,
  type NewSaleFormData as FormData,
} from "./new-sale-form";
import "./new-sale.css";
import { formatSaleMoney } from "./new-sale-presentation";
import { SaleCustomerEntry } from "./sale-customer-entry";
import { SalePaymentPanel } from "./sale-payment-panel";
import { SaleItemGroup } from "./sale-item-group";
import type { CustomerSummary } from "@afia/contracts";
import {
  type InlinePartyValues,
  type PartySuggestion,
} from "@/components/inline-party-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CustomerPhoneConflictError,
  createSale,
  getCustomerAccount,
  getCustomers,
  getProducts,
  getSettings,
} from "@/lib/api";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

const blankColor = (): FormData["items"][number]["colors"][number] => ({
  entryKey: crypto.randomUUID(),
  variantId: "",
  rollsSold: 1,
  meterSold: 0,
  unitPricePerRoll: 0,
});
const blankItem = (): FormData["items"][number] => ({
  productId: "",
  colors: [blankColor()],
});

export function NewSalePage() {
  const navigate = useNavigate();
  const [notesOpen, setNotesOpen] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [wideWorkspace, setWideWorkspace] = useState(false);
  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const observer = new ResizeObserver(([entry]) => {
      setWideWorkspace(entry.contentRect.width >= 1120);
    });
    observer.observe(workspace);
    return () => observer.disconnect();
  }, []);
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
    resolver: zodResolver(newSaleSchema),
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
  const selectedAccount = useQuery({
    queryKey: ["customers", "account-context", selectedCustomer?.id],
    queryFn: () => getCustomerAccount(selectedCustomer!.id),
    enabled: !!selectedCustomer?.id,
  });
  const previousOutstanding = selectedAccount.data?.totalDue ?? selectedCustomer?.totalDue ?? 0;
  const fields = useFieldArray({ control: form.control, name: "items" });
  const values = useWatch({ control: form.control });
  const draftRows = (values.items ?? []).flatMap((item) => item.colors ?? []);
  const subtotal = previewSubtotal(draftRows);
  const inventoryErrors = stockErrors(draftRows, products.data ?? []);
  const grandTotal = Math.max(
    Number((subtotal - (values.discountAmount || 0)).toFixed(2)),
    0,
  );
  const notesField = form.register("notes");
  const received = values.receivedAmount || 0;
  const paid = Math.min(received, grandTotal);
  const due = Math.max(Number((grandTotal - received).toFixed(2)), 0);
  const change = Math.max(Number((received - grandTotal).toFixed(2)), 0);

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
  const selectCustomer = (selected: CustomerSummary) => {
    setSelectedCustomer(selected);
    form.setValue(
      "customer",
      {
        id: selected.id,
        name: selected.name,
        email: selected.email ?? "",
        phone: selected.phone ?? "",
        address: selected.address ?? "",
      },
      { shouldValidate: true },
    );
    setCustomerSearch("");
    save.reset();
  };
  const useExistingCustomer = useMutation({
    mutationFn: (id: string) => getCustomerAccount(id),
    onSuccess: selectCustomer,
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
            description: product.description || "Saved item",
            keywords: [product.description || "", product.color || ""],
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
    form.setValue(
      `items.${itemIndex}.colors`,
      addColorRow(colors, blankColor()),
      { shouldValidate: form.formState.isSubmitted },
    );
    requestAnimationFrame(() => document.getElementById(`sale-color-${itemIndex}-${colors.length}`)?.focus());
  };
  const removeColor = (itemIndex: number, colorIndex: number) => {
    const colors = form.getValues(`items.${itemIndex}.colors`);
    form.setValue(
      `items.${itemIndex}.colors`,
      removeColorRow(colors, colorIndex),
      { shouldValidate: form.formState.isSubmitted },
    );
  };
  const selectColor = (
    itemIndex: number,
    colorIndex: number,
    variantId: string,
  ) => {
    form.setValue(
      `items.${itemIndex}.colors.${colorIndex}.variantId`,
      variantId,
      { shouldValidate: true },
    );
  };
  const submit = (data: FormData) => {
    if (inventoryErrors.size) return;
    if (subtotal > MAX_SALE_AMOUNT) {
      toast.error("Sale subtotal exceeds the supported limit.");
      return;
    }
    const { items, ...sale } = data;
    save.mutate({
      ...sale,
      soldAt: new Date(`${data.soldAt}T12:00:00`).toISOString(),
      lines: items.flatMap((item) =>
        item.colors.map((color) => ({
          variantId: color.variantId,
          rollsSold: color.rollsSold,
          unitPricePerRoll: color.unitPricePerRoll,
          meterSold: color.meterSold > 0 ? color.meterSold : undefined,
        })),
      ),
    });
  };

  const completion = (
    <div className="sale-complete flex items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--page)] py-2">
          <div className="sale-completion-figures text-xs text-[var(--muted)]">
            Total{" "}
            <strong className="sale-completion-total block font-semibold leading-tight text-[var(--ink)] tabular-nums">
              {formatSaleMoney(grandTotal, symbol)}
            </strong>
            <span className="sale-completion-balance">{change > 0 ? "Change" : "Due"} <strong>{formatSaleMoney(change > 0 ? change : due, symbol)}</strong></span>
          </div>
          <Button
            form="afia-new-sale"
            variant="premium"
            className="shrink-0 px-3 sm:px-5"
            disabled={
              save.isPending ||
              products.isPending ||
              products.isError ||
              !productOptions.length ||
              subtotal <= 0 ||
              subtotal > MAX_SALE_AMOUNT ||
              inventoryErrors.size > 0
            }
          >
            {save.isPending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : null}{" "}
            Complete Sale
          </Button>
        </div>
  );

  return (
    <div ref={workspaceRef} className={`new-sale mx-auto max-w-350 px-3 pt-3 sm:px-5 lg:px-6 ${wideWorkspace ? "sale-wide" : ""}`}>
      <div className="sale-container">
      <header className="sale-header">
        <Link
          to="/sales"
          aria-label="Back to Sales"
          className="flex size-10 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--surface-warm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">New Sale</h1>
            <label className="sale-date min-w-0 text-xs font-medium">
              <span>Sale Date</span>
              <Input
                form="afia-new-sale"
                disabled={save.isPending}
                className="h-10"
                type="date"
                aria-invalid={Boolean(form.formState.errors.soldAt)}
                aria-describedby="sale-date-error"
                {...form.register("soldAt")}
              />
              {form.formState.errors.soldAt && (
                <span
                  role="alert"
                  id="sale-date-error"
                  className="mt-1 block text-xs text-[var(--danger)]"
                >
                  Choose a sale date.
                </span>
              )}
            </label>
      </header>
      <form
        id="afia-new-sale"
        onSubmit={form.handleSubmit(submit)}
        className="sale-form space-y-3"
        aria-busy={save.isPending}
      >
        <fieldset disabled={save.isPending} className="sale-workspace min-w-0">
          <section className="sale-meta border-b border-[var(--border)]">
            <div className="sale-customer min-w-0">
              {selectedCustomer ? (
                <div className="sale-customer-summary">
                  <div className="sale-customer-details min-w-0">
                    <p className="sale-caption">Customer</p>
                    <p className="sale-identity">
                      {selectedCustomer.name}
                      {selectedCustomer.phone && <span className="sale-customer-phone"> · {selectedCustomer.phone}</span>}
                    </p>
                    <p className="sale-outstanding text-xs text-[var(--muted)]">
                      Previous Due{" "}
                      <strong className="ml-1 font-medium text-[var(--ink)] tabular-nums">
                        {formatSaleMoney(previousOutstanding, symbol)}
                      </strong>
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    className="px-2 text-xs text-[var(--accent)]"
                    onClick={() => {
                      setSelectedCustomer(null);
                      form.setValue("customer.id", undefined);
                    }}
                  >
                    Change
                  </Button>
                </div>
              ) : (
                <div className="sale-customer-entry">
                  <SaleCustomerEntry
                    validateDraft={() => form.trigger("customer")}
                    values={
                      (values.customer ?? {
                        name: "",
                        email: "",
                        phone: "",
                        address: "",
                      }) as InlinePartyValues
                    }
                    suggestions={customerSuggestions}
                    searching={customers.isFetching}
                    symbol={symbol}
                    nameError={form.formState.errors.customer?.name?.message}
                    phoneError={form.formState.errors.customer?.phone?.message}
                    onSearch={setCustomerSearch}
                    onFieldChange={(field, value) => {
                      save.reset();
                      if (selectedCustomer) {
                        setSelectedCustomer(null);
                        form.setValue("customer.id", undefined);
                      }
                      form.setValue(`customer.${field}`, value, {
                        shouldValidate:
                          field === "name" ||
                          field === "email" ||
                          field === "phone",
                      });
                    }}
                    onSelect={(party) => {
                      const selected = customers.data?.find(
                        (x) => x.id === party.id,
                      );
                      if (!selected) return;
                      selectCustomer(selected);
                    }}
                    onClear={() => {
                      setSelectedCustomer(null);
                      form.setValue("customer.id", undefined);
                    }}
                  />
                </div>
              )}
              {save.error instanceof CustomerPhoneConflictError && (
                <div
                  role="alert"
                  className="mt-3 border-l-2 border-[var(--warning)] pl-3 text-sm"
                >
                  <p>{save.error.message}</p>
                  {!save.error.existingCustomer.archived ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-2"
                      disabled={useExistingCustomer.isPending}
                      onClick={() => {
                        if (save.error instanceof CustomerPhoneConflictError)
                          useExistingCustomer.mutate(
                            save.error.existingCustomer.id,
                          );
                      }}
                    >
                      {useExistingCustomer.isPending
                        ? "Loading customer…"
                        : `Use ${save.error.existingCustomer.name}`}
                    </Button>
                  ) : (
                    <Link
                      className="mt-2 block text-[var(--accent)] underline"
                      to={`/customers/${save.error.existingCustomer.id}`}
                    >
                      View existing customer
                    </Link>
                  )}
                </div>
              )}
            </div>
            {values.customer?.email && (
              <label className="sale-email flex min-h-10 min-w-0 items-center gap-2 text-xs">
                <input
                  className="size-4 accent-[var(--accent)]"
                  type="checkbox"
                  {...form.register("emailInvoice")}
                />
                <span>
                  Email invoice{" "}
                  <span className="sr-only">to {values.customer.email}</span>
                </span>
              </label>
            )}
          </section>

          <div className="sale-worksheet">
          {products.isPending && (
            <p
              role="status"
              className="animate-pulse py-3 text-sm text-[var(--muted)]"
            >
              Loading available stock…
            </p>
          )}
          {products.isError && (
            <div role="alert" className="text-sm text-[var(--danger)]">
              Could not load inventory.{" "}
              <Button
                type="button"
                variant="outline"
                onClick={() => products.refetch()}
              >
                Retry
              </Button>
            </div>
          )}
          {products.isSuccess && !productOptions.length && (
            <p className="py-3 text-sm text-[var(--muted)]">
              No Rolls available.{" "}
              <Link
                to="/purchases/new"
                className="text-[var(--accent)] underline"
              >
                Receive a purchase
              </Link>{" "}
              to add stock.
            </p>
          )}
          {fields.fields.map((field, itemIndex) => (
            <SaleItemGroup
              key={field.id}
              itemKey={field.id}
              itemIndex={itemIndex}
              items={values.items ?? []}
              products={products.data ?? []}
              productOptions={productOptions}
              form={form}
              symbol={symbol}
              canRemove={fields.fields.length > 1}
              inventoryErrors={inventoryErrors}
              selectProduct={(value) => selectProduct(itemIndex, value)}
              selectColor={(index, value) =>
                selectColor(itemIndex, index, value)
              }
              addColor={() => addColor(itemIndex)}
              removeColor={(index) => removeColor(itemIndex, index)}
              removeItem={() => fields.remove(itemIndex)}
            />
          ))}
          <Button
            type="button"
            variant="ghost"
            className="sale-add-action px-2 text-[var(--accent)]"
            onClick={() => {
              const index = fields.fields.length;
              fields.append(blankItem(), { shouldFocus: false });
              requestAnimationFrame(() => document.getElementById(`sale-item-${index}`)?.focus());
            }}
          >
            <Plus className="size-4" /> Add item
          </Button>
          </div>
          <div className="sale-settlement">
          <SalePaymentPanel
            form={form}
            symbol={symbol}
            subtotal={subtotal}
            total={grandTotal}
            paid={paid}
            due={due}
            change={change}
            paymentMethod={values.paymentMethod ?? "CASH"}
          />
          {selectedCustomer && <p className="py-2 text-xs text-[var(--muted)]">Total Due After Sale <strong className="ml-1 text-[var(--ink)] tabular-nums">{formatSaleMoney(Math.round((previousOutstanding + due) * 100) / 100, symbol)}</strong></p>}
          <div className="sale-notes">
            {notesOpen ? <label className="block text-xs font-medium">Notes
              <Input autoFocus className="mt-1" {...notesField} onBlur={(event) => { void notesField.onBlur(event); setNotesOpen(false); }} />
            </label> : <Button type="button" variant="ghost" onClick={() => setNotesOpen(true)}>
              {values.notes ? <span className="truncate">Notes: {values.notes}</span> : "+ Notes"}
            </Button>}
          </div>
        {subtotal > MAX_SALE_AMOUNT && (
          <p role="alert" className="text-sm text-[var(--danger)]">
            Sale subtotal exceeds the supported limit.
          </p>
        )}
        {save.error && !(save.error instanceof CustomerPhoneConflictError) && (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {save.error.message} Review the entry and try again.
          </p>
        )}
          {wideWorkspace && completion}
          </div>
        </fieldset>
      </form>
      </div>
      {!wideWorkspace && completion}
    </div>
  );
}
