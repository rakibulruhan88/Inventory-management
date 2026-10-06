import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, Upload } from "lucide-react";
import type {
  InvoiceImportDraftResponse,
  InvoiceImportReview,
} from "@afia/contracts";
import { InvoiceReviewEditor } from "./invoice-review-editor";
import { Button } from "@/components/ui/button";
import {
  getInvoiceImport,
  getInvoiceImportLimits,
  parseInvoiceImport,
  uploadInvoiceImport,
} from "@/lib/api";

const displayNumber = (n: number | null) =>
  n === null
    ? "Needs review"
    : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
const matchLabel = (match: boolean | null) =>
  match === null ? "Not available" : match ? "Matches" : "Does not match";
const statusLabel = (status: string) =>
  status.toLowerCase().replaceAll("_", " ");

export function InvoiceImportPanel({
  onDirtyChange,
  discardVersion,
}: {
  onDirtyChange: (dirty: boolean) => void;
  discardVersion: number;
}) {
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const changeDirty = (value: boolean) => {
    setDirty(value);
    onDirtyChange(value);
  };
  useEffect(() => {
    setEditing(false);
    setDirty(false);
    onDirtyChange(false);
  }, [discardVersion, onDirtyChange]);
  const limits = useQuery({
    queryKey: ["invoice-import-limits"],
    queryFn: getInvoiceImportLimits,
  });
  const input = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const [file, setFile] = useState<File | null>(null);
  const [draft, setDraft] = useState<InvoiceImportDraftResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const [phase, setPhase] = useState<
    "idle" | "uploading" | "reading" | "refreshing" | "saving"
  >("idle");
  const busy = phase !== "idle";
  const chooseFile = (selected?: File) => {
    if (inFlight.current) return;
    if (
      dirty &&
      !window.confirm("Discard unsaved review edits and choose another file?")
    )
      return;
    setEditing(false);
    changeDirty(false);
    setSavedMessage(null);
    setError(null);
    setDraft(null);
    setDuplicate(null);
    setFile(null);
    if (!selected) return;
    if (!limits.data) {
      setError("Upload limits are unavailable. Retry loading them first.");
      return;
    }
    if (
      !limits.data.supportedMimeTypes.includes(selected.type) ||
      !/\.(pdf|jpe?g|png)$/i.test(selected.name)
    ) {
      setError("Choose a PDF, JPG, or PNG file.");
      return;
    }
    if (!selected.size || selected.size > limits.data.maxFileBytes) {
      setError(
        `Choose a nonempty file under ${limits.data.maxFileBytes / 1024 / 1024} MB.`,
      );
      return;
    }
    setFile(selected);
  };
  const readDraft = async (id: string) => {
    setPhase("reading");
    const result = await parseInvoiceImport(id);
    setDraft(result);
  };
  const run = async (action: "upload" | "parse" | "refresh") => {
    if (inFlight.current) return;
    if (
      dirty &&
      !window.confirm("Discard unsaved review edits and reload this draft?")
    )
      return;
    setEditing(false);
    changeDirty(false);
    setSavedMessage(null);
    inFlight.current = true;
    setError(null);
    try {
      if (action === "upload" && file) {
        setPhase("uploading");
        const uploaded = await uploadInvoiceImport(file);
        setDraft(uploaded);
        setDuplicate(
          uploaded.duplicateFile
            ? uploaded.previousDraftId
              ? "This exact file was already uploaded. Showing your previous draft."
              : "This exact file was already uploaded by another account. Review this document before receiving stock in a later step."
            : null,
        );
        if (
          uploaded.status === "UPLOADED" ||
          uploaded.status === "FAILED" ||
          uploaded.requiresReparse
        )
          await readDraft(uploaded.id);
      } else if (draft && action === "parse") await readDraft(draft.id);
      else if (draft && action === "refresh") {
        setPhase("refreshing");
        setDraft(await getInvoiceImport(draft.id));
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not read the document. Please retry.",
      );
    } finally {
      setPhase("idle");
      inFlight.current = false;
    }
  };
  return (
    <section
      aria-labelledby="invoice-import-title"
      className="mt-5 border border-[var(--border)] bg-[var(--surface)]"
    >
      <div className="border-b border-[var(--border)] p-4 sm:p-5">
        <h2 id="invoice-import-title" className="text-base font-semibold">
          Import Commercial Invoice
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Upload and review the document. This step does not receive stock.
        </p>
      </div>
      <div className="space-y-4 p-4 sm:p-5">
        <div
          className="border border-dashed border-[var(--border)] p-4 transition-colors focus-within:border-[var(--primary)]"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length !== 1)
              setError("Choose one invoice at a time.");
            else chooseFile(e.dataTransfer.files[0]);
          }}
        >
          <label
            htmlFor="commercial-invoice-file"
            className="block text-sm font-medium"
          >
            Commercial Invoice file
          </label>
          <input
            ref={input}
            id="commercial-invoice-file"
            type="file"
            accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
            disabled={busy || !limits.data}
            aria-describedby="invoice-file-help invoice-import-error"
            className="mt-3 block min-h-11 w-full text-sm file:mr-3 file:rounded-md file:border file:border-[var(--border)] file:bg-[var(--surface-soft)] file:px-3 file:py-2 file:text-sm file:text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-[var(--primary)] disabled:opacity-50"
            onChange={(e) => chooseFile(e.target.files?.[0])}
          />
          <p
            id="invoice-file-help"
            className="mt-2 text-xs text-[var(--muted)]"
          >
            Select or drop one PDF, JPG, or PNG
            {limits.data
              ? ` · Maximum ${limits.data.maxFileBytes / 1024 / 1024} MB`
              : ""}
            .
          </p>
          {file && (
            <p className="mt-2 break-all text-sm">
              {file.name}{" "}
              <span className="text-[var(--muted)]">
                · {(file.size / 1024 / 1024).toFixed(2)} MB
              </span>
            </p>
          )}
        </div>
        {limits.isError && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 text-sm text-[var(--danger)]"
          >
            Could not load upload limits.
            <Button variant="outline" onClick={() => void limits.refetch()}>
              Retry
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={!file || busy || !limits.data}
            onClick={() => void run("upload")}
          >
            {busy ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            {phase === "uploading"
              ? "Uploading document"
              : phase === "reading"
                ? "Reading document"
                : phase === "refreshing"
                  ? "Refreshing result"
                  : phase === "saving"
                    ? "Saving review"
                    : "Upload and read"}
          </Button>
          {draft &&
            !busy &&
            (["UPLOADED", "FAILED"].includes(draft.status) ||
              draft.requiresReparse) && (
              <Button variant="outline" onClick={() => void run("parse")}>
                Read document again
              </Button>
            )}
          {draft && !busy && (
            <Button variant="ghost" onClick={() => void run("refresh")}>
              Refresh result
            </Button>
          )}
          <span
            role="status"
            aria-live="polite"
            className="text-sm text-[var(--muted)]"
          >
            {busy
              ? phase === "saving"
                ? "Saving corrections to this temporary draft."
                : "Keep this page open while the document is read."
              : "Review data only · No inventory changes"}
          </span>
        </div>
        <div id="invoice-import-error">
          {error && (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {error}
            </p>
          )}
        </div>
        {duplicate && (
          <p
            role="status"
            className="border-l-2 border-[var(--primary)] pl-3 text-sm"
          >
            {duplicate}
          </p>
        )}
        {draft && (
          <div
            aria-live="polite"
            className="space-y-3 border-t border-[var(--border)] pt-4"
          >
            <div className="flex flex-wrap justify-between gap-2 text-xs text-[var(--muted)]">
              <span className="break-all">
                {draft.originalFileName} · {statusLabel(draft.status)}
                {draft.parsingMethod &&
                  ` · ${draft.parsingMethod.replaceAll("_", " ")}`}
              </span>
              <span>
                Temporary · Expires {new Date(draft.expiresAt).toLocaleString()}
              </span>
            </div>
            {draft.requiresReparse && (
              <p role="alert" className="text-sm text-[var(--danger)]">
                This draft was read by an older parser. Read it again before
                reviewing item ownership.
              </p>
            )}
            {draft.status === "PARSING" && (
              <p className="text-sm">
                This document is being read. Refresh the result shortly.
              </p>
            )}
            {draft.status === "EXPIRED" && (
              <p role="alert" className="text-sm text-[var(--danger)]">
                This draft has expired. Upload the file again.
              </p>
            )}
            {draft.status === "FAILED" && (
              <div
                role="alert"
                className="space-y-1 text-sm text-[var(--danger)]"
              >
                {draft.errors.map((issue, i) => (
                  <p key={i}>{issue.message}</p>
                ))}
              </div>
            )}
            {savedMessage && (
              <p role="status" className="text-sm text-[var(--muted)]">
                {savedMessage}
              </p>
            )}
            {draft.review &&
              (editing ? (
                <InvoiceReviewEditor
                  draft={draft}
                  onBusyChange={(value) => {
                    inFlight.current = value;
                    setPhase(value ? "saving" : "idle");
                  }}
                  onDirtyChange={changeDirty}
                  onCancel={() => setEditing(false)}
                  onSaved={(result) => {
                    setDraft(result);
                    setEditing(false);
                    setSavedMessage(
                      "Review saved. No stock or master records changed.",
                    );
                  }}
                />
              ) : (
                <>
                  <InvoiceReview review={draft.review} draft={draft} />
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setSavedMessage(null);
                      setEditing(true);
                    }}
                  >
                    Edit imported data
                  </Button>
                </>
              ))}
          </div>
        )}
      </div>
    </section>
  );
}

function InvoiceReview({
  review,
  draft,
}: {
  review: InvoiceImportReview;
  draft: InvoiceImportDraftResponse;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold">Review imported invoice</h3>
        <p
          className={`mt-1 text-sm ${review.validationPassed ? "text-[var(--muted)]" : "text-[var(--danger)]"}`}
        >
          {draft.readyForConfirmation
            ? "Validation passed. Stock confirmation will be available in a later step."
            : "Needs review before this data can be used to receive stock."}
        </p>
      </div>
      {draft.blockingIssues.length > 0 && (
        <div
          role="alert"
          className="border-l-2 border-[var(--danger)] pl-3 text-sm"
        >
          <h4 className="font-medium">
            Blocking issues · {draft.blockingIssues.length}
          </h4>
          <ul className="mt-2 space-y-1 text-[var(--danger)]">
            {draft.blockingIssues.map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
        </div>
      )}
      <dl className="grid gap-4 border-y border-[var(--border)] py-4 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-xs text-[var(--muted)]">Supplier / Exporter</dt>
          <dd className="mt-1 break-words text-sm font-medium">
            {review.supplier.detectedName ?? "Needs review"}
          </dd>
          <dd className="mt-1 text-xs text-[var(--muted)]">
            {statusLabel(review.supplier.matchStatus)}
          </dd>
          <dd>
            <dl className="mt-3 space-y-2 text-sm">
              {(
                [
                  ["Phone", review.supplier.phone],
                  ["Address", review.supplier.address],
                  ["Contact person", review.supplier.contactPerson],
                  ["Fax", review.supplier.fax],
                ] as const
              ).map(
                ([label, value]) =>
                  value && (
                    <div key={label}>
                      <dt className="text-xs text-[var(--muted)]">{label}</dt>
                      <dd className="mt-0.5 break-words">{value}</dd>
                    </div>
                  ),
              )}
            </dl>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--muted)]">Container Number</dt>
          <dd className="mt-1 break-all text-sm font-medium">
            {review.containerNumber ?? "Needs review"}
          </dd>
        </div>
      </dl>
      <div className="divide-y divide-[var(--border)]">
        {review.items.map((item, index) => (
          <section
            key={`${item.itemCode}-${index}`}
            className="py-4 first:pt-0"
          >
            <div className="mb-3 flex flex-wrap justify-between gap-2">
              <div className="min-w-0">
                <h4 className="break-all text-sm font-semibold">
                  Item Code · {item.itemCode}
                </h4>
                <p className="mt-1 break-words text-sm">
                  <span className="text-[var(--muted)]">
                    Description / Size ·{" "}
                  </span>
                  {item.description ?? "Not supplied (optional)"}
                </p>
                {(item.matchStatus === "DESCRIPTION_CONFLICT" ||
                  item.descriptionMissingInExisting) && (
                  <p className="mt-1 break-words text-xs text-[var(--danger)]">
                    Existing Description / Size:{" "}
                    {item.existingDescription || "Not recorded"}. No item was
                    updated.
                  </p>
                )}
              </div>
              <span className="text-xs text-[var(--muted)]">
                {statusLabel(item.matchStatus)}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-100 text-sm">
                <caption className="sr-only">
                  Colors for {item.itemCode}
                </caption>
                <thead className="border-y border-[var(--border)] bg-[var(--surface-soft)] text-xs text-[var(--muted)]">
                  <tr>
                    <th className="px-2 py-2 text-left font-medium">
                      Color Code
                    </th>
                    <th className="px-2 py-2 text-right font-medium">Rolls</th>
                    <th className="px-2 py-2 text-right font-medium">Meter</th>
                    <th className="px-2 py-2 text-left font-medium">
                      Existing color
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {item.colors.map((color, i) => (
                    <tr key={i} className="hover:bg-[var(--surface-soft)]">
                      <td className="break-words px-2 py-2">{color.color}</td>
                      <td
                        className={`px-2 py-2 text-right tabular-nums ${color.rolls === null ? "text-[var(--danger)]" : ""}`}
                      >
                        {displayNumber(color.rolls)}
                      </td>
                      <td
                        className={`px-2 py-2 text-right tabular-nums ${color.meter === null ? "text-[var(--danger)]" : ""}`}
                      >
                        {color.meter === null
                          ? "Not supplied"
                          : displayNumber(color.meter)}
                      </td>
                      <td className="px-2 py-2 text-xs text-[var(--muted)]">
                        {statusLabel(color.matchStatus)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
      {(review.unassignedRows?.length ?? 0) > 0 && (
        <section
          aria-labelledby="unassigned-invoice-rows"
          className="border-t border-[var(--border)] pt-4"
        >
          <h4 id="unassigned-invoice-rows" className="text-sm font-semibold">
            Rows without confirmed item ownership
          </h4>
          <p className="mt-1 text-sm text-[var(--danger)]">
            These rows are excluded from parsed totals. Their item must be
            reviewed.
          </p>
          <ul className="mt-3 divide-y divide-[var(--border)]">
            {review.unassignedRows.map((row, index) => (
              <li key={index} className="py-3 text-sm">
                <p className="break-words">{row.text}</p>
                <p className="mt-1 text-xs text-[var(--danger)]">
                  {row.reason} · Page {row.source.page}, line {row.source.line}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="overflow-x-auto border-y border-[var(--border)] py-3">
        <table className="w-full min-w-90 text-sm">
          <caption className="mb-2 text-left font-semibold">
            Invoice totals
          </caption>
          <thead className="text-xs text-[var(--muted)]">
            <tr>
              <th className="py-2 text-left font-medium">Measure</th>
              <th className="py-2 text-right font-medium">Invoice</th>
              <th className="py-2 text-right font-medium">Original parsed</th>
              <th className="py-2 text-right font-medium">Reviewed</th>
              <th className="py-2 pl-3 text-left font-medium">Validation</th>
            </tr>
          </thead>
          <tbody>
            {(["rolls", "meter"] as const).map((key) => (
              <tr key={key}>
                <th className="py-2 text-left font-medium">
                  {key === "rolls" ? "Rolls" : "Meter"}
                </th>
                <td className="py-2 text-right tabular-nums">
                  {displayNumber(review.invoiceTotals[key])}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {displayNumber(
                    draft.originalExtractedData?.parsedTotals[key] ?? null,
                  )}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {displayNumber(review.parsedTotals[key])}
                </td>
                <td
                  className={`py-2 pl-3 text-xs ${review.totalsMatch[key] !== true ? "text-[var(--danger)]" : "text-[var(--muted)]"}`}
                >
                  {matchLabel(review.totalsMatch[key])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(draft.originalExtractedData?.warnings.length ?? 0) > 0 && (
        <details className="border-t border-[var(--border)] pt-3">
          <summary className="cursor-pointer text-sm font-medium focus-visible:outline-2 focus-visible:outline-[var(--primary)]">
            Original extraction history ·{" "}
            {draft.originalExtractedData!.warnings.length} warnings
          </summary>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Source warnings stay here after corrections. Current blocking issues
            are listed separately.
          </p>
          <ul className="mt-2 space-y-2 text-sm text-[var(--muted)]">
            {draft.originalExtractedData!.warnings.map((warning, i) => (
              <li key={i}>
                {warning.message}
                {warning.page
                  ? ` · Page ${warning.page}${warning.line ? `, line ${warning.line}` : ""}`
                  : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
