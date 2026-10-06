import { useQuery } from "@tanstack/react-query";
import { NavLink, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { getPurchase } from "@/lib/api";
import { SourceDocument } from "./source-document";

export function PurchaseDetailsPage() {
  const { id = "" } = useParams();
  const q = useQuery({
    queryKey: ["purchase", id],
    queryFn: () => getPurchase(id),
  });
  return (
    <div className="mx-auto max-w-350 px-4 pb-28 pt-6 md:px-7 lg:px-8 lg:pb-10">
      <Button asChild variant="ghost">
        <NavLink to="/purchases">Back to Purchases</NavLink>
      </Button>
      {q.isLoading ? (
        <p role="status" className="mt-5 text-sm">
          Loading purchase…
        </p>
      ) : q.isError ? (
        <div role="alert" className="mt-5 text-sm">
          <p>Could not load this purchase.</p>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => void q.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : (
        q.data && (
          <>
            <h1 className="mt-4 break-words text-2xl font-semibold">
              {q.data.purchaseNumber}
            </h1>
            <p className="mt-1 break-words text-sm text-[var(--muted)]">
              {q.data.supplierName} · Container {q.data.containerNumber} ·{" "}
              {q.data.purchasedAt.slice(0, 10)}
            </p>
            <p className="mt-3 text-sm font-medium">
              {q.data.status === "CANCELLED"
                ? "Reversed · Source document retained"
                : "Stock received"}{" "}
              · {q.data.totalRolls.toLocaleString()} Rolls ·{" "}
              {q.data.totalMeters.toLocaleString()} Meter
            </p>
            <ul className="mt-5 divide-y divide-[var(--border)] border-y border-[var(--border)]">
              {q.data.lines.map((line) => (
                <li
                  key={line.id}
                  className="grid grid-cols-2 gap-2 py-3 text-sm sm:grid-cols-[1fr_1fr_auto_auto]"
                >
                  <div className="min-w-0">
                    <p className="break-words font-medium">{line.itemCode}</p>
                    <p className="mt-1 break-words text-xs text-[var(--muted)]">
                      {line.description ?? "Description not supplied"}
                    </p>
                  </div>
                  <p className="break-words">{line.color}</p>
                  <p className="tabular-nums sm:text-right">
                    {line.rolls} Rolls
                  </p>
                  <p className="tabular-nums sm:text-right">
                    {line.meter.toLocaleString()} Meter
                  </p>
                </li>
              ))}
            </ul>
            {q.data.documents.map((document) => (
              <SourceDocument key={document.id} document={document} />
            ))}
          </>
        )
      )}
    </div>
  );
}
