import { useState } from "react";
import type {
  InvoiceImportDraftResponse,
  InvoiceImportIssue,
} from "@afia/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ApiFieldError,
  resetInvoiceReview,
  saveInvoiceReview,
} from "@/lib/api";

import {
  editableReview,
  liveTotals,
  reviewPayload,
  type EditableColor,
  type EditableReview,
} from "./invoice-review-form";

function ReviewField({
  label,
  path,
  value,
  onChange,
  errors,
  hint,
  numeric: numberField = false,
  type = "text",
}: {
  label: string;
  path: string;
  value: string;
  onChange: (value: string) => void;
  errors: InvoiceImportIssue[];
  hint?: string;
  numeric?: boolean;
  type?: "text" | "date";
}) {
  const error = errors.find((e) => e.field === path)?.message;
  const id = `review-${path.replaceAll(".", "-")}`;
  return (
    <div className="min-w-0">
      <label
        htmlFor={id}
        className="mb-1 block text-xs font-medium text-[var(--muted)]"
      >
        {label}
      </label>
      <Input
        id={id}
        type={type}
        value={value}
        inputMode={numberField ? "decimal" : "text"}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error || hint ? `${id}-help` : undefined}
      />
      {(error || hint) && (
        <p
          id={`${id}-help`}
          className={`mt-1 text-xs ${error ? "text-[var(--danger)]" : "text-[var(--muted)]"}`}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function InvoiceReviewEditor({
  draft,
  onSaved,
  onCancel,
  onDirtyChange,
  onBusyChange,
}: {
  draft: InvoiceImportDraftResponse;
  onSaved: (draft: InvoiceImportDraftResponse) => void;
  onCancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const original = draft.originalExtractedData!;
  const [initial] = useState(() => editableReview(draft.review!, original));
  const [edit, setEdit] = useState(initial);
  const [errors, setErrors] = useState<InvoiceImportIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(edit) !== JSON.stringify(initial);
  const update = (next: EditableReview) => {
    setEdit(next);
    setErrors([]);
    setError(null);
    onDirtyChange(JSON.stringify(next) !== JSON.stringify(initial));
  };
  const itemChange = (
    i: number,
    key: "itemCode" | "description",
    value: string,
  ) =>
    update({
      ...edit,
      items: edit.items.map((item, index) =>
        index === i ? { ...item, [key]: value } : item,
      ),
    });
  const colorChange = (
    i: number,
    j: number,
    key: "color" | "rolls" | "meter",
    value: string,
  ) =>
    update({
      ...edit,
      items: edit.items.map((item, index) =>
        index === i
          ? {
              ...item,
              colors: item.colors.map((color, ci) =>
                ci === j ? { ...color, [key]: value } : color,
              ),
            }
          : item,
      ),
    });
  const save = async (reset = false) => {
    if (busy) return;
    if (
      reset &&
      !window.confirm(
        "Reset all saved and unsaved corrections to the original extracted data?",
      )
    )
      return;
    if (!reset) {
      const invalid: InvoiceImportIssue[] = [];
      edit.items.forEach((item, i) =>
        item.colors.forEach((color, j) => {
          const path = `items.${i}.colors.${j}`;
          if (
            !/^\d+$/.test(color.rolls) ||
            Number(color.rolls) <= 0 ||
            Number(color.rolls) > 2147483647 ||
            !Number.isSafeInteger(Number(color.rolls))
          )
            invalid.push({
              code: "INVALID_FIELD",
              field: `${path}.rolls`,
              message: "Rolls must be a positive whole number.",
            });
          if (
            color.meter !== "" &&
            (!/^\d+(?:\.\d{1,2})?$/.test(color.meter) ||
              !Number.isFinite(Number(color.meter)) ||
              Number(color.meter) > 9999999999.99)
          )
            invalid.push({
              code: "INVALID_FIELD",
              field: `${path}.meter`,
              message:
                "Enter zero or greater, with at most two decimals, or leave blank.",
            });
        }),
      );
      if (invalid.length) {
        setErrors(invalid);
        setError("Check the highlighted review fields.");
        return;
      }
    }
    setBusy(true);
    onBusyChange(true);
    setError(null);
    setErrors([]);
    try {
      const result = reset
        ? await resetInvoiceReview(draft.id)
        : await saveInvoiceReview(draft.id, reviewPayload(edit));
      onDirtyChange(false);
      onSaved(result);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not save review. Retry.",
      );
      if (e instanceof ApiFieldError) setErrors(e.fieldErrors);
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };
  const totals = liveTotals(edit);
  const fieldHint = (color: EditableColor, field: string) => {
    if (!color.sourceRow) return undefined;
    const source =
      original.items[color.sourceRow.item]?.colors[color.sourceRow.color]
        ?.source;
    const warning = original.warnings.find(
      (w) =>
        source &&
        w.page === source.page &&
        w.line === source.line &&
        (w.field?.includes(field) ||
          (field === "color" && w.code.includes("OCR"))),
    );
    if (warning) return `Original extraction: ${warning.message}`;
    if (field === "meter" && original.totalsMatch.meter === false)
      return "Original Meter total did not reconcile. Verify against the invoice.";
    return undefined;
  };
  const itemHint = (index: number, field: "item" | "description") => {
    for (const color of edit.items[index].colors) {
      if (!color.sourceRow) continue;
      const source =
        original.items[color.sourceRow.item]?.colors[color.sourceRow.color]
          ?.source;
      const warning = original.warnings.find(
        (w) =>
          w.field === `items.${field}` &&
          source &&
          w.page === source.page &&
          w.line === source.line,
      );
      if (warning) return `Original extraction: ${warning.message}`;
    }
    return undefined;
  };
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">Edit imported data</h3>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Correct the rows using your invoice. Saving changes only this
          temporary review.
        </p>
      </div>
      <fieldset disabled={busy} className="space-y-5 disabled:opacity-60">
        <legend className="sr-only">
          Imported supplier, shipment and items
        </legend>
        <div className="grid gap-3 border-y border-[var(--border)] py-4 sm:grid-cols-2 lg:grid-cols-3">
          <ReviewField
            label="Purchase Date"
            type="date"
            path="purchasedAt"
            value={edit.purchasedAt ?? ""}
            onChange={(value) => update({ ...edit, purchasedAt: value })}
            errors={errors}
            hint="Use the date on the Commercial Invoice."
          />
          <ReviewField
            label="Purchase Reference"
            path="purchaseNumber"
            value={edit.purchaseNumber ?? ""}
            onChange={(value) => update({ ...edit, purchaseNumber: value })}
            errors={errors}
            hint="Same editable reference as manual receiving."
          />
          {(
            [
              ["name", "Supplier name"],
              ["phone", "Phone"],
              ["fax", "Fax"],
              ["address", "Address"],
              ["contactPerson", "Contact person"],
            ] as const
          ).map(([key, label]) => (
            <ReviewField
              key={key}
              label={label}
              path={`supplier.${key}`}
              value={edit.supplier[key] ?? ""}
              onChange={(value) =>
                update({
                  ...edit,
                  supplier: { ...edit.supplier, [key]: value },
                })
              }
              errors={errors}
            />
          ))}
          <ReviewField
            label="Container Number"
            path="containerNumber"
            value={edit.containerNumber}
            onChange={(value) => update({ ...edit, containerNumber: value })}
            errors={errors}
          />
        </div>
        <div className="divide-y divide-[var(--border)]">
          {edit.items.map((item, i) => (
            <section
              key={i}
              aria-label={`Item ${i + 1}`}
              className="space-y-3 py-4 first:pt-0"
            >
              <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto]">
                <ReviewField
                  label="Item Code"
                  hint={itemHint(i, "item")}
                  path={`items.${i}.itemCode`}
                  value={item.itemCode}
                  onChange={(value) => itemChange(i, "itemCode", value)}
                  errors={errors}
                />
                <ReviewField
                  label="Description / Size (optional)"
                  hint={itemHint(i, "description")}
                  path={`items.${i}.description`}
                  value={item.description}
                  onChange={(value) => itemChange(i, "description", value)}
                  errors={errors}
                />
                <Button
                  type="button"
                  variant="ghost"
                  className="self-end"
                  aria-label={`Remove item ${item.itemCode || i + 1}`}
                  onClick={() =>
                    update({
                      ...edit,
                      items: edit.items.filter((_, index) => index !== i),
                    })
                  }
                >
                  Remove item
                </Button>
              </div>
              <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
                {item.colors.map((color, j) => (
                  <div
                    key={j}
                    className="grid grid-cols-2 gap-3 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
                  >
                    <div className="col-span-2 sm:col-span-1">
                      <ReviewField
                        label="Color Code"
                        path={`items.${i}.colors.${j}.color`}
                        value={color.color}
                        onChange={(value) => colorChange(i, j, "color", value)}
                        errors={errors}
                        hint={fieldHint(color, "color")}
                      />
                    </div>
                    <ReviewField
                      label="Rolls"
                      path={`items.${i}.colors.${j}.rolls`}
                      value={color.rolls}
                      onChange={(value) => colorChange(i, j, "rolls", value)}
                      errors={errors}
                      hint={fieldHint(color, "rolls")}
                      numeric
                    />
                    <ReviewField
                      label="Meter (optional)"
                      path={`items.${i}.colors.${j}.meter`}
                      value={color.meter}
                      onChange={(value) => colorChange(i, j, "meter", value)}
                      errors={errors}
                      hint={fieldHint(color, "meter")}
                      numeric
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      className="justify-self-start self-start sm:self-center"
                      aria-label={`Remove color ${color.color || j + 1} from ${item.itemCode || `item ${i + 1}`}`}
                      onClick={() =>
                        update({
                          ...edit,
                          items: edit.items.map((it, index) =>
                            index === i
                              ? {
                                  ...it,
                                  colors: it.colors.filter((_, ci) => ci !== j),
                                }
                              : it,
                          ),
                        })
                      }
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
              {errors
                .filter((e) => e.field === `items.${i}.colors`)
                .map((e) => (
                  <p key={e.field} className="text-sm text-[var(--danger)]">
                    {e.message}
                  </p>
                ))}
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  update({
                    ...edit,
                    items: edit.items.map((it, index) =>
                      index === i
                        ? {
                            ...it,
                            colors: [
                              ...it.colors,
                              { color: "", rolls: "", meter: "" },
                            ],
                          }
                        : it,
                    ),
                  })
                }
              >
                Add color
              </Button>
            </section>
          ))}
        </div>
        {errors
          .filter((e) => e.field === "items")
          .map((e) => (
            <p key={e.field} className="text-sm text-[var(--danger)]">
              {e.message}
            </p>
          ))}
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            update({
              ...edit,
              items: [
                ...edit.items,
                {
                  itemCode: "",
                  description: "",
                  colors: [{ color: "", rolls: "", meter: "" }],
                },
              ],
            })
          }
        >
          Add item
        </Button>
      </fieldset>
      <div
        className="border-y border-[var(--border)] py-3 text-sm"
        aria-live="polite"
      >
        <p className="font-medium">
          Reviewed data ·{" "}
          {totals.valid
            ? `${totals.rolls.toLocaleString()} Rolls · ${totals.meter.toLocaleString(undefined, { maximumFractionDigits: 2 })} Meter`
            : "Complete valid Rolls and Meter to calculate totals"}
        </p>
        <p className="mt-1 text-[var(--muted)]">
          Invoice total ·{" "}
          {original.invoiceTotals.rolls?.toLocaleString() ?? "Not available"}{" "}
          Rolls ·{" "}
          {original.invoiceTotals.meter?.toLocaleString() ?? "Not available"}{" "}
          Meter
        </p>
        {totals.valid &&
          ((original.invoiceTotals.rolls !== null &&
            totals.rolls !== original.invoiceTotals.rolls) ||
            (original.invoiceTotals.meter !== null &&
              Math.round(totals.meter * 100) !==
                Math.round(original.invoiceTotals.meter * 100))) && (
            <p className="mt-1 text-[var(--danger)]">
              Reviewed totals do not match the source invoice.
            </p>
          )}
      </div>
      {error && (
        <div role="alert" className="text-sm text-[var(--danger)]">
          <p>{error}</p>
          {errors
            .filter((e) => !e.field || e.field.includes("sourceRow"))
            .map((e, i) => (
              <p key={i}>{e.message}</p>
            ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving review…" : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => {
            onDirtyChange(false);
            onCancel();
          }}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => void save(true)}
        >
          Reset to extracted data
        </Button>
        <span role="status" className="text-xs text-[var(--muted)]">
          {dirty ? "Unsaved changes" : "No unsaved changes"}
        </span>
      </div>
    </div>
  );
}
