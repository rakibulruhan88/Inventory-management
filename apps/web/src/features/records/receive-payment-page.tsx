import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import type { PaymentContext, ReceivePaymentRequest } from "@afia/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ApiResponseError,
  getPaymentContext,
  receiveCustomerPayment,
} from "@/lib/api";
import {
  formatMoney,
  ledgerLink,
  LedgerError,
  LedgerLoading,
} from "@/features/sales/ledger-components";
import {
  PaymentAllocationRows,
  PaymentConfirmation,
  PaymentSuccess,
  paymentMethods as methods,
} from "./payment-components";
import { moneyCents, previewAllocation } from "./payment-allocation";

import { dhakaDate, withDhakaTime } from "@/lib/business-time";
const today = () => dhakaDate();
export function ReceivePaymentPage() {
  const { id = "" } = useParams();
  return <ReceivePaymentForm key={id} id={id} />;
}
function ReceivePaymentForm({ id }: { id: string }) {
  const qc = useQueryClient();
  const storageKey = `afia-payment-pending:${id}`;
  const [pending, setPending] = useState<ReceivePaymentRequest | null>(() => {
    try {
      return JSON.parse(
        sessionStorage.getItem(storageKey) || "null",
      ) as ReceivePaymentRequest | null;
    } catch {
      return null;
    }
  });
  const [amount, setAmount] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [method, setMethod] =
    useState<NonNullable<ReceivePaymentRequest["method"]>>("CASH");
  const [mode, setMode] = useState<"AUTO" | "MANUAL">("AUTO");
  const [manual, setManual] = useState<Record<string, string>>({});
  const [date, setDate] = useState(today);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [reviewContext, setReviewContext] = useState<PaymentContext | null>(
    null,
  );
  const [review, setReview] = useState(false);
  const submitting = useRef(false);
  const q = useQuery({
    queryKey: ["customers", "payment-context", id],
    queryFn: () => getPaymentContext(id),
    enabled: !!id,
  });
  const pay = useMutation({
    mutationFn: (input: ReceivePaymentRequest) =>
      receiveCustomerPayment(id, input),
    retry: false,
    onSuccess: () => {
      sessionStorage.removeItem(storageKey);
      setPending(null);
      for (const key of [
        "customers",
        "sale",
        "sales",
        "dashboard",
        "inventory-summary",
        "reports",
        "finance",
      ])
        void qc.invalidateQueries({ queryKey: [key] });
    },
    onError: (error) => {
      if (
        error instanceof ApiResponseError &&
        [400, 404, 409].includes(error.status)
      ) {
        sessionStorage.removeItem(storageKey);
        setPending(null);
        setReview(false);
        setReviewContext(null);
        void q.refetch();
      }
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
  const c = reviewContext ?? q.data;
  const cents = moneyCents(amount) ?? 0;
  const amountError =
    amountTouched &&
    (moneyCents(amount) === null ||
      cents <= 0 ||
      (!!c && cents > Math.round(c.outstanding * 100)))
      ? "Enter an amount above ৳0 and within the total due."
      : null;
  const rows = c ? previewAllocation(c, cents, mode, manual) : [];
  const allocated = rows.reduce((sum, row) => sum + (row.cents ?? 0), 0);
  const valid =
    !!c &&
    cents > 0 &&
    cents <= Math.round(c.outstanding * 100) &&
    moneyCents(amount) !== null &&
    rows.every((r) => r.valid) &&
    allocated === cents &&
    !!date;
  function confirm() {
    if (submitting.current || (!pending && (!valid || !c))) return;
    const input: ReceivePaymentRequest = pending ?? {
      amount: cents / 100,
      method,
      paidAt: withDhakaTime(date),
      reference,
      notes,
      allocationMode: mode,
      idempotencyKey: crypto.randomUUID(),
      expectedOutstanding: c!.outstanding,
      ...(mode === "MANUAL"
        ? {
            allocations: rows.map((r) => ({
              ...(r.invoice.sourceKind === "OPENING"
                ? { openingBalanceId: r.invoice.id }
                : { saleId: r.invoice.id }),
              amount: (r.cents ?? 0) / 100,
              expectedDue: r.invoice.dueAmount,
            })),
          }
        : {}),
    };
    // Keep the exact submission across connection failures and page reloads.
    sessionStorage.setItem(storageKey, JSON.stringify(input));
    setPending(input);
    submitting.current = true;
    pay.mutate(input);
  }
  if (pay.data)
    return (
      <PaymentSuccess
        receipt={pay.data}
        onAnother={() => {
          pay.reset();
          setReview(false);
          setReviewContext(null);
          setAmount("");
          setAmountTouched(false);
          setManual({});
          setReference("");
          setNotes("");
          void q.refetch();
        }}
      />
    );
  return (
    <div className="mx-auto max-w-4xl px-4 pb-28 pt-6 md:px-7">
      <nav
        aria-label="Payment navigation"
        className="flex flex-wrap gap-x-4 gap-y-2 text-sm"
      >
        <Link className={ledgerLink} to="/payments">
          Payments
        </Link>
        <Link className={ledgerLink} to={`/customers/${id}`}>
          Customer Account
        </Link>
      </nav>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">
        Receive Payment
      </h1>
      {q.isError ? (
        <LedgerError message={q.error.message} retry={() => void q.refetch()} />
      ) : !c ? (
        <LedgerLoading />
      ) : (
        <>
          <p className="mt-2 break-words text-sm">
            {c.customerName}
            {c.customerPhone && ` · ${c.customerPhone}`}
          </p>
          {pay.error && (
            <p role="alert" className="mt-4 text-sm text-[var(--danger)]">
              {pay.error.message}
            </p>
          )}
          {pending ? (
            <section className="mt-5 space-y-4 border-y border-[var(--border)] py-5">
              <h2 className="font-semibold">
                {pay.isPending ? "Saving payment…" : "Finish saving payment"}
              </h2>
              <p className="text-sm">
                {formatMoney(pending.amount)} ·{" "}
                {methods.find((m) => m[0] === pending.method)?.[1]}. Retry this
                payment to finish saving it.
              </p>
              <Button disabled={pay.isPending} onClick={confirm}>
                {pay.isPending ? "Saving…" : "Retry Payment"}
              </Button>
            </section>
          ) : c.outstanding <= 0 ? (
            <p className="mt-6 text-sm">There is no due to pay.</p>
          ) : review ? (
            <PaymentConfirmation
              c={c}
              cents={cents}
              method={method}
              rows={rows}
              busy={pay.isPending}
              onConfirm={confirm}
              onEdit={() => {
                setReview(false);
                setReviewContext(null);
              }}
            />
          ) : (
            <form
              className="mt-5 space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                if (valid) {
                  pay.reset();
                  setReviewContext(c ?? null);
                  setReview(true);
                }
              }}
            >
              <div className="flex items-baseline justify-between gap-3 border-y border-[var(--border)] py-4">
                <span className="text-sm">Total Due</span>
                <strong className="text-xl tabular-nums">
                  {formatMoney(c.outstanding)}
                </strong>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium">
                  Pay Now *
                  <Input
                    autoFocus
                    className="mt-2"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                    onBlur={() => setAmountTouched(true)}
                    aria-invalid={!!amountError}
                    aria-describedby="payment-amount-help payment-amount-error"
                  />
                  <span
                    id="payment-amount-help"
                    className="mt-1 block text-xs text-[var(--muted)]"
                  >
                    Up to {formatMoney(c.outstanding)}.
                  </span>
                  {amountError && (
                    <span
                      role="alert"
                      id="payment-amount-error"
                      className="mt-1 block text-xs text-[var(--danger)]"
                    >
                      {amountError}
                    </span>
                  )}
                </label>
                <label className="text-sm font-medium">
                  Payment Date *
                  <Input
                    className="mt-2"
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
              </div>
              <fieldset>
                <legend className="mb-2 text-sm font-medium">
                  Pay Against
                </legend>
                <div className="flex flex-wrap gap-4 text-sm">
                  {[
                    ["AUTO", "Pay Old Due First"],
                    ["MANUAL", "Choose Invoices"],
                  ].map(([value, label]) => (
                    <label
                      className="flex min-h-11 items-center gap-2"
                      key={value}
                    >
                      <input
                        type="radio"
                        name="allocation-mode"
                        value={value}
                        checked={mode === value}
                        onChange={() => setMode(value as "AUTO" | "MANUAL")}
                        className="accent-[var(--accent)]"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <PaymentAllocationRows
                rows={rows}
                mode={mode}
                manual={manual}
                onManual={(saleId, value) =>
                  setManual((m) => ({ ...m, [saleId]: value }))
                }
              />
              {mode === "MANUAL" && allocated !== cents && (
                <p role="alert" className="text-sm text-[var(--danger)]">
                  Pay Now total must be {formatMoney(cents / 100)}.
                </p>
              )}
              <div className="flex justify-between gap-3 text-sm">
                <span>Due After Payment</span>
                <strong className="tabular-nums">
                  {formatMoney(Math.max(c.outstanding - cents / 100, 0))}
                </strong>
              </div>
              <fieldset>
                <legend className="mb-2 text-sm font-medium">
                  Payment Method
                </legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {methods.map(([value, label]) => (
                    <Button
                      type="button"
                      variant={method === value ? "primary" : "outline"}
                      key={value}
                      aria-pressed={method === value}
                      onClick={() => setMethod(value)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </fieldset>
              <label className="block text-sm font-medium">
                Reference{" "}
                <span className="text-xs text-[var(--muted)]">(optional)</span>
                <Input
                  className="mt-2"
                  value={reference}
                  maxLength={200}
                  onChange={(e) => setReference(e.target.value)}
                />
              </label>
              <label className="block text-sm font-medium">
                Note{" "}
                <span className="text-xs text-[var(--muted)]">(optional)</span>
                <Input
                  className="mt-2"
                  value={notes}
                  maxLength={2000}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
              <Button
                type="submit"
                className="w-full sm:w-auto"
                disabled={!valid || q.isFetching}
              >
                Review Payment
              </Button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
