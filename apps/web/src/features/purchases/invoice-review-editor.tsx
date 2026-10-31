import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
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
  manualTotalIssues,
  reviewPayload,
  type EditableColor,
  type EditableReview,
} from "./invoice-review-form";
import { InvoiceIssueList } from "./invoice-issue-list";
import {
  currentReviewTarget,
  issueCopy,
  reviewIssueTargets,
  reviewTargetId,
  type ReviewIssueSelection,
} from "./invoice-review-issues";

function ReviewField({
  label,
  path,
  value,
  onChange,
  errors,
  hint,
  numeric: numberField = false,
  type = "text",
  activePath,
}: {
  label: string;
  path: string;
  value: string;
  onChange: (value: string) => void;
  errors: InvoiceImportIssue[];
  hint?: string;
  numeric?: boolean;
  type?: "text" | "date";
  activePath?: string;
}) {
  const error = errors.find((e) => e.field === path)?.message;
  const id = reviewTargetId(path);
  return (
    <div
      className={`min-w-0 scroll-mt-52 rounded-md ${activePath === path ? "ring-2 ring-[var(--primary-border)] ring-offset-4 ring-offset-[var(--surface)]" : ""}`}
    >
      <label
        htmlFor={id}
        className="mb-1 block text-xs font-medium text-[var(--muted)]"
      >
        {label}
      </label>
      <Input
        id={id}
        className="aria-invalid:border-[var(--danger)]"
        type={type}
        value={value}
        inputMode={numberField ? "decimal" : "text"}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error || hint ? `${id}-help` : undefined}
      />
      {(error || hint) && (
        <div id={`${id}-help`} className="mt-1 space-y-1 text-xs">
          {error && <p className="text-[var(--danger)]">{error}</p>}
          {hint && <p className="text-[var(--muted)]">{hint}</p>}
        </div>
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
  initialSelection,
  onChooseFile,
}: {
  draft: InvoiceImportDraftResponse;
  onSaved: (draft: InvoiceImportDraftResponse) => void;
  onCancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
  initialSelection: ReviewIssueSelection | null;
  onChooseFile: () => void;
}) {
  const original = draft.originalExtractedData!;
  const [initial] = useState(() => editableReview(draft.review!, original));
  const [edit, setEdit] = useState(initial);
  const [errors, setErrors] = useState<InvoiceImportIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<ReviewIssueSelection | null>(
    initialSelection ? { ...initialSelection, current: true } : null,
  );
  const [structureChanged, setStructureChanged] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const issues = [
    ...errors,
    ...draft.blockingIssues.filter(
      (issue) =>
        !errors.some(
          (fieldError) =>
            fieldError.field === issue.field && fieldError.code === issue.code,
        ),
    ),
  ];
  const fieldErrors = issues.flatMap((issue) =>
    reviewIssueTargets(issue, draft.review!).map((location) => ({
      ...issue,
      field: errors.includes(issue)
        ? location.path
        : currentReviewTarget(
            location,
            draft.review!,
            original,
            edit,
            !structureChanged,
          ).path,
      message: issueCopy(issue).title,
    })),
  );
  const target = selection
    ? selection.current || errors.includes(selection.issue)
      ? selection.target
      : currentReviewTarget(selection.target, draft.review!, original, edit)
    : null;
  const activePath = target?.path;
  const selectedIndex = selection ? issues.indexOf(selection.issue) : -1;
  const selectIssue = (next: ReviewIssueSelection) => {
    setSelection({
      ...next,
      current: true,
      target: next.current
        ? next.target
        : currentReviewTarget(
            next.target,
            draft.review!,
            original,
            edit,
            !structureChanged,
          ),
    });
    setFocusRequest((request) => request + 1);
  };
  const chooseIssue = (index: number) => {
    const issue = issues[index];
    if (issue)
      selectIssue({
        issue,
        index,
        target: reviewIssueTargets(issue, draft.review!)[0],
        current: errors.includes(issue),
      });
  };
  useEffect(() => {
    if (!activePath) return;
    const frame = requestAnimationFrame(() => {
      const element = document.getElementById(reviewTargetId(activePath));
      if (!element || !editorRef.current?.contains(element)) return;
      element.scrollIntoView({
        block: "center",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
      const focusTarget =
        element.matches("input, button") ||
        ["totals", "unassignedRows"].includes(activePath)
          ? element
          : (element.querySelector<HTMLElement>("input, button") ?? element);
      (focusTarget as HTMLElement).focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [activePath, focusRequest]);
  const dirty = JSON.stringify(edit) !== JSON.stringify(initial);
  const update = (next: EditableReview, changedPath?: string) => {
    if (
      !changedPath ||
      changedPath.startsWith("items.") ||
      changedPath === "verifiedInvoiceTotals.rolls" ||
      changedPath === "verifiedInvoiceTotals.meter"
    )
      next = {
        ...next,
        verifiedInvoiceTotals: {
          ...next.verifiedInvoiceTotals,
          confirmed: false,
        },
      };
    setEdit(next);
    setErrors((previous) =>
      changedPath
        ? previous.filter((issue) => issue.field !== changedPath)
        : [],
    );
    if (!changedPath) {
      setSelection(null);
      setStructureChanged(true);
    }
    setError(null);
    onDirtyChange(JSON.stringify(next) !== JSON.stringify(initial));
  };
  const itemChange = (
    i: number,
    key: "itemCode" | "description",
    value: string,
  ) =>
    update(
      {
        ...edit,
        items: edit.items.map((item, index) =>
          index === i ? { ...item, [key]: value } : item,
        ),
      },
      `items.${i}.${key}`,
    );
  const colorChange = (
    i: number,
    j: number,
    key: "color" | "rolls" | "meter",
    value: string,
  ) =>
    update(
      {
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
      },
      `items.${i}.colors.${j}.${key}`,
    );
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
      const invalid: InvoiceImportIssue[] = manualTotalIssues(edit);
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
        selectIssue({
          issue: invalid[0],
          index: 0,
          target: reviewIssueTargets(invalid[0], draft.review!)[0],
          current: true,
        });
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
      if (e instanceof ApiFieldError) {
        setErrors(e.fieldErrors);
        if (e.fieldErrors[0])
          selectIssue({
            issue: e.fieldErrors[0],
            index: 0,
            target: reviewIssueTargets(e.fieldErrors[0], draft.review!)[0],
            current: true,
          });
      }
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
    if (warning) return `Invoice reading note: ${issueCopy(warning).title}`;
    if (field === "meter" && original.totalsMatch.meter === false)
      return "Check this Meter value against your invoice; the totals did not match.";
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
      if (warning) return `Invoice reading note: ${issueCopy(warning).title}`;
    }
    return undefined;
  };
  const descriptionHint = (index: number) => {
    const item = draft.review!.items.find(
      (candidate) => candidate.itemCode === edit.items[index].itemCode,
    );
    const existing =
      item &&
      (item.matchStatus === "DESCRIPTION_CONFLICT" ||
        item.descriptionMissingInExisting)
        ? `Saved item Description / Size: ${item.existingDescription || "Not recorded"}.`
        : undefined;
    return (
      [existing, itemHint(index, "description")].filter(Boolean).join(" ") ||
      undefined
    );
  };
  return (
    <div ref={editorRef} className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">Correct invoice details</h3>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Use your invoice to correct the details. Save and check when you are
          done. Stock is received only after confirmation.
        </p>
      </div>
      <div
        id="review-issues"
        tabIndex={-1}
        className="scroll-mt-28 rounded-md focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
      >
        <InvoiceIssueList
          issues={issues}
          review={draft.review!}
          onSelect={(next) =>
            selectIssue({ ...next, current: errors.includes(next.issue) })
          }
          disabled={busy}
        />
      </div>
      {selection && (
        <div className="sticky top-20 z-10 rounded-md border border-[var(--primary-border)] bg-[var(--surface)] px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-[var(--primary)]">
              {selectedIndex >= 0
                ? `Detail ${selectedIndex + 1} of ${issues.length}`
                : "Changed detail · Save and check again"}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={busy} onClick={() => void save()}>
                {busy ? "Saving…" : "Save and check"}
              </Button>
              <Button
                type="button"
                size="icon"
                variant="outline"
                aria-label="Previous detail"
                disabled={busy || selectedIndex <= 0}
                onClick={() => chooseIssue(selectedIndex - 1)}
              >
                <ArrowLeft aria-hidden="true" className="size-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={
                  busy || !issues.length || selectedIndex >= issues.length - 1
                }
                onClick={() => chooseIssue(selectedIndex + 1)}
              >
                Next detail <ArrowRight aria-hidden="true" className="size-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  const list = document.getElementById("review-issues");
                  list?.scrollIntoView({ block: "start" });
                  list?.focus({ preventScroll: true });
                }}
              >
                All details
              </Button>
            </div>
          </div>
          <p className="mt-2 text-sm font-medium">
            {issueCopy(selection.issue).title}
          </p>
          <p className="mt-1 break-words text-xs text-[var(--muted)]">
            {target?.label}.{" "}
            {dirty
              ? "Changes are not checked yet. Save and check to update the list."
              : issueCopy(selection.issue).help}
          </p>
        </div>
      )}
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
            onChange={(value) =>
              update({ ...edit, purchasedAt: value }, "purchasedAt")
            }
            errors={fieldErrors}
            activePath={activePath}
            hint="Use the date on the Commercial Invoice."
          />
          <ReviewField
            label="Purchase Reference"
            path="purchaseNumber"
            value={edit.purchaseNumber ?? ""}
            onChange={(value) =>
              update({ ...edit, purchaseNumber: value }, "purchaseNumber")
            }
            errors={fieldErrors}
            activePath={activePath}
            hint="Check or enter the reference for this purchase."
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
                update(
                  {
                    ...edit,
                    supplier: { ...edit.supplier, [key]: value },
                  },
                  `supplier.${key}`,
                )
              }
              errors={fieldErrors}
              activePath={activePath}
            />
          ))}
          <ReviewField
            label="Container Number"
            path="containerNumber"
            value={edit.containerNumber}
            onChange={(value) =>
              update({ ...edit, containerNumber: value }, "containerNumber")
            }
            errors={fieldErrors}
            activePath={activePath}
            hint="Use the Contract No. printed on the Commercial Invoice."
          />
        </div>
        <div
          id="review-items"
          tabIndex={-1}
          className={`divide-y divide-[var(--border)] scroll-mt-52 rounded-md ${activePath === "items" ? "ring-2 ring-[var(--primary-border)] ring-offset-4" : ""}`}
        >
          {edit.items.map((item, i) => (
            <section
              key={i}
              id={reviewTargetId(`items.${i}`)}
              tabIndex={-1}
              aria-label={`Item ${i + 1}`}
              className="space-y-3 py-4 first:pt-0"
            >
              <h4 className="text-sm font-semibold">
                Item {i + 1}
                {item.itemCode ? ` · ${item.itemCode}` : ""}
              </h4>
              <div className="grid gap-3 sm:grid-cols-[1fr_2fr_auto]">
                <ReviewField
                  label="Item Code"
                  hint={itemHint(i, "item")}
                  path={`items.${i}.itemCode`}
                  value={item.itemCode}
                  onChange={(value) => itemChange(i, "itemCode", value)}
                  errors={fieldErrors}
                  activePath={activePath}
                />
                <ReviewField
                  label="Description / Size (optional)"
                  hint={descriptionHint(i)}
                  path={`items.${i}.description`}
                  value={item.description}
                  onChange={(value) => itemChange(i, "description", value)}
                  errors={fieldErrors}
                  activePath={activePath}
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
              <div
                id={reviewTargetId(`items.${i}.colors`)}
                tabIndex={-1}
                className={`divide-y divide-[var(--border)] border-y border-[var(--border)] scroll-mt-52 rounded-md ${activePath === `items.${i}.colors` ? "ring-2 ring-[var(--primary-border)] ring-offset-4" : ""}`}
              >
                {item.colors.map((color, j) => (
                  <div
                    key={j}
                    id={reviewTargetId(`items.${i}.colors.${j}`)}
                    tabIndex={-1}
                    className="grid grid-cols-2 gap-3 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
                  >
                    <div className="col-span-2 sm:col-span-1">
                      <ReviewField
                        label={`Color ${j + 1} · Color Code`}
                        path={`items.${i}.colors.${j}.color`}
                        value={color.color}
                        onChange={(value) => colorChange(i, j, "color", value)}
                        errors={fieldErrors}
                        activePath={activePath}
                        hint={fieldHint(color, "color")}
                      />
                    </div>
                    <ReviewField
                      label="Rolls"
                      path={`items.${i}.colors.${j}.rolls`}
                      value={color.rolls}
                      onChange={(value) => colorChange(i, j, "rolls", value)}
                      errors={fieldErrors}
                      activePath={activePath}
                      hint={fieldHint(color, "rolls")}
                      numeric
                    />
                    <ReviewField
                      label="Meter (optional)"
                      path={`items.${i}.colors.${j}.meter`}
                      value={color.meter}
                      onChange={(value) => colorChange(i, j, "meter", value)}
                      errors={fieldErrors}
                      activePath={activePath}
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
      {(activePath === "unassignedRows" ||
        draft.review!.unassignedRows.length > 0 ||
        issues.some((issue) =>
          [
            "ROW_OWNERSHIP",
            "ROW_OWNERSHIP_UNCERTAIN",
            "ROW_LAYOUT_UNAVAILABLE",
            "COLUMN_STRUCTURE_UNCERTAIN",
          ].includes(issue.code),
        )) && (
        <section
          id="review-unassignedRows"
          tabIndex={-1}
          className={`scroll-mt-52 rounded-md border-t border-[var(--border)] py-4 ${activePath === "unassignedRows" ? "ring-2 ring-[var(--primary-border)] ring-offset-4" : ""}`}
        >
          <h3 className="text-sm font-semibold">Unmatched invoice rows</h3>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Check that every item and color on the invoice is included.
            Unmatched rows may require a clearer invoice before stock can be
            received.
          </p>
          {draft.review!.unassignedRows.length ? (
            <ul className="mt-3 divide-y divide-[var(--border)]">
              {draft.review!.unassignedRows.map((row, index) => (
                <li key={index} className="py-3 text-sm">
                  <p className="break-words">{row.text}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Invoice page {row.source.page}, line {row.source.line}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm">
              No unmatched rows were listed. Compare the imported items with
              your invoice.
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            className="mt-3"
            disabled={busy}
            onClick={onChooseFile}
          >
            Choose a clearer invoice
          </Button>
        </section>
      )}
      <section
        id="review-totals"
        tabIndex={-1}
        className={`scroll-mt-52 rounded-md border-y border-[var(--border)] py-4 text-sm ${activePath === "totals" ? "ring-2 ring-[var(--primary-border)] ring-offset-4" : ""}`}
      >
        <h3 className="font-semibold">Compare invoice totals</h3>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Check the uploaded invoice and every item/color. If a total was read
          incorrectly, enter it manually below. If your invoice has no total,
          add its rows yourself and enter that checked total.
        </p>
        <div className="mt-4 grid gap-6 sm:grid-cols-2">
          {(["rolls", "meter"] as const).map((measure) => (
            <div key={measure} className="border-b border-[var(--border)] pb-3">
              <h4 className="font-medium">
                {measure === "rolls" ? "Rolls" : "Meter"}
              </h4>
              <dl className="mt-2 space-y-2 tabular-nums">
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--muted)]">
                    Automatically read total
                  </dt>
                  <dd>
                    {original.invoiceTotals[measure]?.toLocaleString(
                      undefined,
                      { maximumFractionDigits: 2 },
                    ) ?? "Could not be read"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-[var(--muted)]">Your corrected rows</dt>
                  <dd>
                    {totals.valid
                      ? totals[measure].toLocaleString(undefined, {
                          maximumFractionDigits: 2,
                        })
                      : "Check the rows"}
                  </dd>
                </div>
              </dl>
              <div className="mt-4">
                <ReviewField
                  label={`Verified invoice total ${measure === "rolls" ? "Rolls" : "Meter"}`}
                  path={`verifiedInvoiceTotals.${measure}`}
                  value={edit.verifiedInvoiceTotals[measure]}
                  numeric
                  errors={fieldErrors}
                  activePath={activePath}
                  hint="Enter the total you checked against the invoice. Leave both fields blank to use the automatically read totals."
                  onChange={(value) =>
                    update(
                      {
                        ...edit,
                        verifiedInvoiceTotals: {
                          ...edit.verifiedInvoiceTotals,
                          [measure]: value,
                        },
                      },
                      `verifiedInvoiceTotals.${measure}`,
                    )
                  }
                />
                {edit.verifiedInvoiceTotals[measure] !== "" &&
                  totals.valid &&
                  !manualTotalIssues(edit).some(
                    (issue) =>
                      issue.field === `verifiedInvoiceTotals.${measure}`,
                  ) && (
                    <p
                      className={`mt-2 text-xs ${Math.round(Number(edit.verifiedInvoiceTotals[measure]) * 100) === Math.round(totals[measure] * 100) ? "text-[var(--muted)]" : "text-[var(--danger)]"}`}
                    >
                      {Math.round(
                        Number(edit.verifiedInvoiceTotals[measure]) * 100,
                      ) === Math.round(totals[measure] * 100)
                        ? "Matches your corrected rows."
                        : "Does not match your corrected rows. Check the total and the color rows."}
                    </p>
                  )}
              </div>
              <details className="mt-3">
                <summary className="min-h-11 cursor-pointer py-3 text-xs font-semibold text-[var(--primary)] focus-visible:outline-2 focus-visible:outline-[var(--ring)]">
                  Check {measure === "rolls" ? "Rolls" : "Meter"} in color rows
                </summary>
                <div className="flex flex-wrap gap-2">
                  {edit.items.flatMap((item, i) =>
                    item.colors.map((color, j) => (
                      <Button
                        key={`${i}-${j}`}
                        type="button"
                        variant="ghost"
                        disabled={busy}
                        className="max-w-full justify-start px-2 text-xs text-[var(--primary)]"
                        onClick={() => {
                          const issue = selection?.issue ?? {
                            code: "SOURCE_TOTAL_MISMATCH",
                            field: `totals.${measure}`,
                            message: "Check the totals.",
                          };
                          selectIssue({
                            issue,
                            index: selectedIndex,
                            current: true,
                            target: {
                              path: `items.${i}.colors.${j}.${measure}`,
                              label: `Item ${item.itemCode || i + 1} · Color ${j + 1}: ${color.color || "not entered"} · ${measure === "rolls" ? "Rolls" : "Meter"}`,
                            },
                          });
                        }}
                      >
                        <span className="break-words">
                          Check {item.itemCode || `item ${i + 1}`} · Color{" "}
                          {j + 1}
                        </span>
                      </Button>
                    )),
                  )}
                </div>
              </details>
            </div>
          ))}
        </div>
        {!edit.verifiedInvoiceTotals.rolls &&
          !edit.verifiedInvoiceTotals.meter &&
          totals.valid &&
          ((original.invoiceTotals.rolls !== null &&
            totals.rolls !== original.invoiceTotals.rolls) ||
            (original.invoiceTotals.meter !== null &&
              Math.round(totals.meter * 100) !==
                Math.round(original.invoiceTotals.meter * 100))) && (
            <p className="mt-1 text-[var(--danger)]">
              Your corrected rows do not match the printed invoice total yet.
            </p>
          )}
        <div
          className={`mt-4 rounded-md bg-[var(--primary-soft)] p-3 ${activePath === "verifiedInvoiceTotals.confirmed" ? "ring-2 ring-[var(--primary-border)] ring-offset-4" : ""}`}
        >
          <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2">
            <input
              id={reviewTargetId("verifiedInvoiceTotals.confirmed")}
              type="checkbox"
              className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
              checked={edit.verifiedInvoiceTotals.confirmed}
              disabled={busy}
              aria-invalid={fieldErrors.some(
                (issue) => issue.field === "verifiedInvoiceTotals.confirmed",
              )}
              aria-describedby="review-manual-totals-help"
              onChange={(event) =>
                update(
                  {
                    ...edit,
                    verifiedInvoiceTotals: {
                      ...edit.verifiedInvoiceTotals,
                      confirmed: event.target.checked,
                    },
                  },
                  "verifiedInvoiceTotals.confirmed",
                )
              }
            />
            <span>
              I checked these totals and every item/color against the uploaded
              invoice.
            </span>
          </label>
          <div id="review-manual-totals-help" className="space-y-1 text-xs">
            {fieldErrors
              .filter(
                (issue) => issue.field === "verifiedInvoiceTotals.confirmed",
              )
              .map((issue, index) => (
                <p key={index} className="text-[var(--danger)]">
                  {issue.message}
                </p>
              ))}
            <p className="text-[var(--muted)]">
              Required when entering manual totals. After changing any
              item/color or total, check this again. Save and check to update
              the errors; stock is received only after confirmation.
            </p>
          </div>
        </div>
      </section>
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
          {busy ? "Saving and checking…" : "Save and check"}
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
