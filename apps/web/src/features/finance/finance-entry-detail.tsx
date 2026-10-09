import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getFinanceEntry, voidFinanceEntry } from "@/lib/api";
export const cashDate = (date: string, showTime = true) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(showTime
      ? { hour: "2-digit" as const, minute: "2-digit" as const }
      : {}),
  }).format(new Date(date));
export function FinanceEntryDetail({
  id,
  canWrite,
}: {
  id: string;
  canWrite: boolean;
}) {
  const cache = useQueryClient(),
    [reason, setReason] = useState(""),
    [confirm, setConfirm] = useState(false);
  const q = useQuery({
    queryKey: ["finance", "entry", id],
    queryFn: () => getFinanceEntry(id),
  });
  const mutation = useMutation({
    mutationFn: () => voidFinanceEntry(id, reason),
    onSuccess: async () => {
      setConfirm(false);
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["finance"] }),
        cache.invalidateQueries({ queryKey: ["suppliers"] }),
        cache.invalidateQueries({ queryKey: ["supplier"] }),
      ]);
    },
  });
  if (q.isPending)
    return (
      <p role="status" className="py-8">
        Loading entry…
      </p>
    );
  if (q.isError)
    return (
      <div role="alert">
        <p>{q.error.message}</p>
        <Button onClick={() => q.refetch()}>Try again</Button>
      </div>
    );
  const e = q.data;
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold">Record History</h2>
      <dl className="divide-y divide-[var(--border)] text-sm">
        {[
          ["Created By", e.creatorName],
          ["Saved", cashDate(e.createdAt)],
          ["Status", e.voidedAt ? "Voided" : "Saved"],
          ...(e.voidedAt
            ? [
                ["Voided", cashDate(e.voidedAt)],
                ["Voided By", e.voiderName],
                ["Reason", e.voidReason],
              ]
            : []),
        ]
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div className="grid grid-cols-[100px_1fr] gap-3 py-3" key={label}>
              <dt className="text-[var(--muted)]">{label}</dt>
              <dd className="break-words tabular-nums">{value}</dd>
            </div>
          ))}
      </dl>
      {canWrite && !e.voidedAt && (
        <>
          {!confirm ? (
            <Button variant="outline" onClick={() => setConfirm(true)}>
              Void Entry
            </Button>
          ) : (
            <form
              className="space-y-3 border-t border-[var(--border)] pt-4"
              onSubmit={(ev) => {
                ev.preventDefault();
                if (!mutation.isPending) mutation.mutate();
              }}
            >
              <p className="text-sm">
                Void this entry? It stays in history and is removed from totals.
              </p>
              <label className="block text-sm">
                Reason *
                <Input
                  required
                  maxLength={2000}
                  value={reason}
                  onChange={(ev) => setReason(ev.target.value)}
                  className="mt-1"
                />
              </label>
              {mutation.isError && (
                <p role="alert" className="text-sm text-[var(--danger)]">
                  {mutation.error.message}
                </p>
              )}
              <div className="flex gap-3">
                <Button
                  variant="danger"
                  disabled={!reason.trim() || mutation.isPending}
                >
                  {mutation.isPending ? "Voiding…" : "Void Entry"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={mutation.isPending}
                  onClick={() => setConfirm(false)}
                >
                  Keep Entry
                </Button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}
