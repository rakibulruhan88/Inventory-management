import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  expenseTypes,
  financeLabels,
  type CreateFinanceEntry,
  type ManualFinanceType,
} from "@afia/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchablePicker } from "@/components/searchable-picker";
import {
  ApiResponseError,
  createFinanceEntry,
  getSupplier,
  getSuppliers,
} from "@/lib/api";
import { methodNames } from "./financial-summary";
import { useAuth } from "@/features/auth/auth-context";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { dhakaDate, withDhakaTime } from "@/lib/business-time";
const todayFor = (value: string) => dhakaDate(new Date(value));
const today = () => dhakaDate();
export function FinanceEntryForm({
  type: requestedType,
  onSaved,
  onCancel,
}: {
  type: ManualFinanceType;
  onSaved: (id: string) => void;
  onCancel: () => void;
}) {
  const cache = useQueryClient();
  const draftKey = `afia-finance-pending:${useAuth().user?.id}`;
  const [pending] = useState<CreateFinanceEntry | null>(() => {
    try {
      return JSON.parse(
        sessionStorage.getItem(draftKey) ?? "null",
      ) as CreateFinanceEntry | null;
    } catch {
      return null;
    }
  });
  const type = pending?.type ?? requestedType;
  const [amount, setAmount] = useState(pending ? String(pending.amount) : ""),
    [method, setMethod] = useState<CreateFinanceEntry["method"]>(
      pending?.method ?? "CASH",
    ),
    [date, setDate] = useState(pending ? todayFor(pending.occurredAt) : today),
    [note, setNote] = useState(pending?.note ?? ""),
    [reference, setReference] = useState(pending?.reference ?? "");
  const [expense, setExpense] = useState<CreateFinanceEntry["expenseType"]>(
    pending?.expenseType ?? "Transport",
  );
  const [supplier, setSupplier] = useState(pending?.supplierId ?? ""),
    [purchase, setPurchase] = useState(pending?.purchaseId ?? ""),
    [container, setContainer] = useState(pending?.containerId ?? "");
  const [supplierSearch, setSupplierSearch] = useState("");
  const ss = useDebouncedValue(supplierSearch);
  const suppliers = useQuery({
    queryKey: ["suppliers", "finance", ss],
    queryFn: () => getSuppliers(ss),
    enabled: type === "SUPPLIER_PAYMENT",
  });
  const supplierLinks = useQuery({
    queryKey: ["suppliers", "finance-links", supplier],
    queryFn: () => getSupplier(supplier),
    enabled: type === "SUPPLIER_PAYMENT" && !!supplier,
  });
  const linkedPurchases = supplierLinks.data?.purchaseHistory ?? [];
  const linkedContainers = supplierLinks.data?.shipments ?? [];
  const [error, setError] = useState("");
  // Keep the exact submission across transport failures. A changed payload gets
  // a new key only after a definite rejection; unknown outcomes require retry.
  const submission = useRef<CreateFinanceEntry | null>(pending);
  const save = useMutation({
    mutationFn: () => createFinanceEntry(submission.current!),
    onSuccess: async (e) => {
      sessionStorage.removeItem(draftKey);
      await cache.invalidateQueries({ queryKey: ["finance"] });
      onSaved(e.id);
    },
    onError: (e: Error) => {
      if (
        e instanceof ApiResponseError &&
        [400, 403, 404, 409].includes(e.status)
      ) {
        submission.current = null;
        sessionStorage.removeItem(draftKey);
      }
      setError(e.message);
    },
  });
  const locked = !!submission.current;
  return (
    <form
      className="finance-entry-form"
      onSubmit={(e) => {
        e.preventDefault();
        setError("");
        if (save.isPending) return;
        if (!submission.current) {
          if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
            setError("Amount must be more than ৳0.");
            return;
          }
          if (type === "SUPPLIER_PAYMENT" && !supplier) {
            setError("Please choose a supplier.");
            return;
          }
          if (type === "EXPENSE" && expense === "Other" && !note.trim()) {
            setError("Please add a Note.");
            return;
          }
          submission.current = {
            type,
            amount: Number(amount),
            method,
            occurredAt: withDhakaTime(date),
            reference,
            note,
            idempotencyKey: crypto.randomUUID(),
            ...(type === "EXPENSE" ? { expenseType: expense } : {}),
            ...(type === "SUPPLIER_PAYMENT"
              ? {
                  supplierId: supplier,
                  ...(purchase ? { purchaseId: purchase } : {}),
                  ...(container ? { containerId: container } : {}),
                }
              : {}),
          };
        }
        sessionStorage.setItem(draftKey, JSON.stringify(submission.current));
        save.mutate();
      }}
    >
      {pending && (
        <p role="status" className="text-sm">
          An earlier save needs checking. Retry this{" "}
          {financeLabels[pending.type]} of {pending.amount} first.
        </p>
      )}
      <fieldset
        disabled={save.isPending || locked}
        className="disabled:opacity-70"
      >
        {type === "EXPENSE" && (
          <div className="finance-form-wide">
            <label>
              <span>Expense Type *</span>
            </label>
            <SearchablePicker
              label="Expense Type"
              placeholder="Choose Expense Type"
              value={expense}
              options={expenseTypes.map((e) => ({ value: e, label: e }))}
              onChange={(e) =>
                setExpense(e as CreateFinanceEntry["expenseType"])
              }
              purchasePresentation
            />
          </div>
        )}
        {type === "SUPPLIER_PAYMENT" && (
          <div className="finance-form-wide">
            <label>
              <span>Supplier *</span>
            </label>
            <SearchablePicker
              label="Supplier *"
              placeholder="Choose supplier *"
              value={supplier}
              options={(suppliers.data ?? []).map((s) => ({
                value: s.id,
                label: s.name,
              }))}
              onSearchChange={setSupplierSearch}
              onChange={(s) => {
                setSupplier(s);
                setPurchase("");
                setContainer("");
              }}
              purchasePresentation
            />
            <section
              className="finance-supplier-links"
              aria-label="Optional supplier links"
            >
              <div className="finance-supplier-links-heading">
                <h3>
                  Purchase &amp; Container <span>Optional</span>
                </h3>
                <p>
                  {!supplier
                    ? "Choose a supplier to see their purchases and containers."
                    : supplierLinks.isPending
                      ? "Loading this supplier’s purchases and containers…"
                      : "Link this payment to a purchase or container, or leave both blank."}
                </p>
              </div>
              <fieldset
                className="finance-supplier-link-fields"
                disabled={
                  !supplier || supplierLinks.isPending || supplierLinks.isError
                }
              >
                <div>
                  <label>Purchase (optional)</label>
                  <SearchablePicker
                    label="Purchase (optional)"
                    placeholder="No Purchase"
                    value={purchase}
                    options={[
                      { value: "", label: "No Purchase" },
                      ...linkedPurchases.map((p) => ({
                        value: p.id,
                        label: p.purchaseNumber,
                        description: p.containerNumber,
                      })),
                    ]}
                    onChange={(id) => {
                      setPurchase(id);
                      const chosen = linkedPurchases.find((p) => p.id === id);
                      if (chosen) setContainer(chosen.containerId);
                    }}
                    purchasePresentation
                  />
                  {supplierLinks.isSuccess && !linkedPurchases.length && (
                    <p className="finance-link-hint">
                      No purchases for this supplier.
                    </p>
                  )}
                </div>
                <div>
                  <label>Container (optional)</label>
                  <SearchablePicker
                    label="Container (optional)"
                    placeholder="No Container"
                    value={container}
                    options={[
                      { value: "", label: "No Container" },
                      ...linkedContainers.map((c) => ({
                        value: c.id,
                        label: c.containerNumber,
                      })),
                    ]}
                    onChange={(id) => {
                      setContainer(id);
                      if (
                        purchase &&
                        linkedPurchases.find((p) => p.id === purchase)
                          ?.containerId !== id
                      )
                        setPurchase("");
                    }}
                    purchasePresentation
                  />
                  {supplierLinks.isSuccess && !linkedContainers.length && (
                    <p className="finance-link-hint">
                      No containers for this supplier.
                    </p>
                  )}
                </div>
              </fieldset>
            </section>
            {(suppliers.isError || supplierLinks.isError) && (
              <div role="alert" className="mt-3 text-sm text-[var(--danger)]">
                <p>Supplier links could not load.</p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    void suppliers.refetch();
                    if (supplier) void supplierLinks.refetch();
                  }}
                >
                  Try again
                </Button>
              </div>
            )}
          </div>
        )}
        <label className="block text-sm font-medium">
          Amount *
          <Input
            required
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1"
            placeholder="৳0.00"
          />
        </label>
        <div className="finance-form-wide">
          <label>
            <span>Method *</span>
          </label>
          <div
            className="finance-method-options"
            role="group"
            aria-label="Payment Method"
          >
            {Object.entries(methodNames).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={method === value}
                onClick={() => setMethod(value as CreateFinanceEntry["method"])}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <label className="block text-sm font-medium">
          Date *
          <Input
            required
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1"
          />
        </label>
        <label className="block text-sm font-medium">
          Reference
          <Input
            maxLength={200}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className="mt-1"
          />
        </label>
        <label className="finance-form-wide">
          Note
          <textarea
            maxLength={2000}
            className="mt-1 min-h-24 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
      {locked && !save.isPending && (
        <p className="text-sm text-[var(--muted)]">
          Retry the saved submission to check whether it was saved.
        </p>
      )}
      <div className="finance-form-actions">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : locked ? "Retry Save" : "Save"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={save.isPending}
          onClick={onCancel}
        >
          Back to Cashbook
        </Button>
      </div>
    </form>
  );
}
