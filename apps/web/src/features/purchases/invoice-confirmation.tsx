import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import { Drawer } from "vaul";
import type {
  InvoiceImportConfirmationResponse,
  InvoiceImportDraftResponse,
} from "@afia/contracts";
import { Button } from "@/components/ui/button";
import { ApiFieldError, confirmInvoiceImport, getPurchase } from "@/lib/api";
import { SourceDocument } from "./source-document";

export function InvoiceConfirmation({
  draft,
  disabled,
  onBusyChange,
  onConfirmed,
}: {
  draft: InvoiceImportDraftResponse;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onConfirmed: (purchaseId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const flight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] =
    useState<InvoiceImportConfirmationResponse | null>(null);
  const qc = useQueryClient();
  const purchase = useQuery({
    queryKey: ["purchase", draft.confirmedPurchaseId],
    queryFn: () => getPurchase(draft.confirmedPurchaseId!),
    enabled: draft.status === "CONFIRMED" && Boolean(draft.confirmedPurchaseId),
  });
  const receive = async () => {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      const received = await confirmInvoiceImport(draft.id);
      setResult(received);
      setOpen(false);
      onConfirmed(received.purchase.id);
      void qc.invalidateQueries();
    } catch (e) {
      setError(
        e instanceof ApiFieldError
          ? `${e.message} ${e.fieldErrors.map((issue) => issue.message).join(" ")}`
          : e instanceof Error
            ? e.message
            : "Could not confirm. Refresh the review and retry.",
      );
    } finally {
      flight.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  };
  if (draft.status === "CONFIRMED") {
    const details = purchase.data;
    const document = result?.document ?? details?.documents[0];
    const reversed =
      (result?.purchaseStatus ?? details?.status) === "CANCELLED";
    return (
      <section
        className="border-y border-[var(--border)] py-4"
        aria-live="polite"
      >
        <h3 className="text-base font-semibold">
          {reversed
            ? "Purchase reversed · Source invoice retained"
            : "Stock received"}
        </h3>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-[var(--muted)]">Container</dt>
            <dd className="mt-1 break-all font-medium">
              {result?.purchase.containerNumber ??
                details?.containerNumber ??
                draft.review?.containerNumber}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--muted)]">Items</dt>
            <dd className="mt-1">
              {result?.itemCount ??
                (details
                  ? new Set(details.lines.map((line) => line.itemCode)).size
                  : draft.review?.items.length)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--muted)]">Rolls</dt>
            <dd className="mt-1">
              {(
                result?.purchase.totalRolls ??
                details?.totalRolls ??
                draft.review?.parsedTotals.rolls
              )?.toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--muted)]">Meter</dt>
            <dd className="mt-1">
              {(
                result?.purchase.totalMeter ??
                details?.totalMeters ??
                draft.review?.parsedTotals.meter
              )?.toLocaleString()}
            </dd>
          </div>
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild>
            <NavLink to={`/purchases/${draft.confirmedPurchaseId}`}>
              View Purchase
            </NavLink>
          </Button>
          <Button asChild variant="outline">
            <NavLink to="/purchases">Back to Purchases</NavLink>
          </Button>
        </div>
        {document && <SourceDocument document={document} />}
        {purchase.isError && (
          <p role="alert" className="mt-2 text-sm">
            Receipt was saved.{" "}
            <Button variant="ghost" onClick={() => void purchase.refetch()}>
              Retry loading source details
            </Button>
          </p>
        )}
      </section>
    );
  }
  if (draft.status !== "REVIEW" || !draft.review) return null;
  const review = draft.review;
  return (
    <div className="border-t border-[var(--border)] pt-4">
      <Button
        disabled={disabled || !draft.readyForConfirmation || busy}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        Confirm Receive Stock
      </Button>
      {!draft.readyForConfirmation && (
        <p className="mt-2 text-xs text-[var(--muted)]">
          Save the reviewed data and resolve all blocking issues before
          receiving stock.
        </p>
      )}
      <Drawer.Root
        open={open}
        onOpenChange={(value) => !busy && setOpen(value)}
        dismissible={!busy}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-50 bg-black/35" />
          <Drawer.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[90svh] overflow-y-auto rounded-t-lg border-t border-[var(--border)] bg-[var(--surface)] p-5 pb-[max(20px,env(safe-area-inset-bottom))]">
            <div className="mx-auto max-w-lg">
              <Drawer.Title className="text-lg font-semibold">
                Confirm Receive Stock?
              </Drawer.Title>
              <Drawer.Description className="mt-2 text-sm text-[var(--muted)]">
                This receives stock, creates the purchase and archives the
                original Commercial Invoice. Check this summary carefully.
              </Drawer.Description>
              <dl className="my-4 grid grid-cols-2 gap-3 border-y border-[var(--border)] py-4 text-sm">
                {(
                  [
                    ["Supplier", review.supplier.detectedName],
                    ["Container", review.containerNumber],
                    ["Purchase date", review.purchasedAt],
                    ["Reference", review.purchaseNumber],
                    [
                      "Items / Colors",
                      `${review.items.length} / ${review.items.reduce((sum, item) => sum + item.colors.length, 0)}`,
                    ],
                    [
                      "Rolls / Meter",
                      `${review.parsedTotals.rolls.toLocaleString()} / ${review.parsedTotals.meter.toLocaleString()}`,
                    ],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-[var(--muted)]">{label}</dt>
                    <dd className="mt-1 break-words font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
              {error && (
                <p role="alert" className="mb-3 text-sm text-[var(--danger)]">
                  {error}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => void receive()}>
                  {busy ? "Receiving stock…" : "Confirm Receive Stock"}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  );
}
