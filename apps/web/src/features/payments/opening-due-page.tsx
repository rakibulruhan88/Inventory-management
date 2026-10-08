import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { customerPhoneError } from "@afia/contracts";
import type { CustomerWithOpeningDueRequest } from "@afia/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ApiResponseError,
  CustomerPhoneConflictError,
  getCustomerAccount,
  saveOpeningDue,
  createCustomer,
} from "@/lib/api";
import {
  ledgerLink,
  LedgerError,
  LedgerLoading,
} from "@/features/sales/ledger-components";
import { moneyCents } from "@/features/records/payment-allocation";
export function OpeningDuePage({ cashbook = false }: { cashbook?: boolean }) {
  const { id } = useParams();
  return <OpeningDueForm key={id ?? "new"} id={id} cashbook={cashbook} />;
}
export function CustomerCreatePage() {
  return <OpeningDueForm cashbook={false} optionalDue />;
}
function OpeningDueForm({
  id,
  cashbook,
  optionalDue = false,
}: {
  id?: string;
  cashbook: boolean;
  optionalDue?: boolean;
}) {
  const qc = useQueryClient(),
    navigate = useNavigate(),
    submitting = useRef(false);
  const key = `afia-opening-pending:${id ?? "new"}`;
  const [pending, setPending] = useState<CustomerWithOpeningDueRequest | null>(
    () => {
      try {
        return JSON.parse(sessionStorage.getItem(key) ?? "null");
      } catch {
        return null;
      }
    },
  );
  const [hasDue, setHasDue] = useState(!optionalDue || !!pending);
  const plainSave = useMutation({
    mutationFn: () =>
      createCustomer({ name: name.trim(), phone, email, address }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["customers"] });
      navigate("/customers", { replace: true });
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
  const [name, setName] = useState(""),
    [phone, setPhone] = useState(""),
    [email, setEmail] = useState(""),
    [address, setAddress] = useState("");
  const [amount, setAmount] = useState(""),
    [note, setNote] = useState("");
  const [date, setDate] = useState(() =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Dhaka",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
  );
  const customer = useQuery({
    queryKey: ["customers", "account", id, 1],
    queryFn: () => getCustomerAccount(id!),
    enabled: !!id,
  });
  const save = useMutation({
    mutationFn: (input: CustomerWithOpeningDueRequest) =>
      saveOpeningDue(id, input),
    retry: false,
    onSuccess: (result) => {
      sessionStorage.removeItem(key);
      setPending(null);
      for (const queryKey of ["customers", "dashboard", "inventory-summary"])
        void qc.invalidateQueries({ queryKey: [queryKey] });
      navigate(
        `/customers/${encodeURIComponent(result.customerId)}${optionalDue ? "" : "/receive-payment"}`,
        { replace: true },
      );
    },
    onError: (error) => {
      if (
        (error instanceof ApiResponseError &&
          [400, 404, 409].includes(error.status)) ||
        error instanceof CustomerPhoneConflictError
      ) {
        sessionStorage.removeItem(key);
        setPending(null);
        if (id) void customer.refetch();
      }
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
  const phoneError = customerPhoneError(phone);
  const emailValid = !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const cents = moneyCents(amount);
  function submit() {
    if (submitting.current || (!pending && !id && (phoneError || !emailValid)))
      return;
    if (optionalDue && !hasDue && !pending) {
      if (!name.trim()) return;
      submitting.current = true;
      plainSave.mutate();
      return;
    }
    if (
      !pending &&
      ((!id && !name.trim()) || cents === null || cents <= 0 || !date)
    )
      return;
    const input = pending ?? {
      name: name.trim(),
      phone,
      email,
      address,
      openingDue: {
        amount: cents! / 100,
        balanceAsOf: date,
        note,
        idempotencyKey: crypto.randomUUID(),
      },
    };
    sessionStorage.setItem(key, JSON.stringify(input));
    setPending(input);
    submitting.current = true;
    save.mutate(input);
  }
  return (
    <div className="mx-auto max-w-2xl px-4 pb-28 pt-6 md:px-7">
      <Link
        className={`${ledgerLink} text-sm`}
        to={
          id
            ? `/customers/${id}`
            : cashbook
              ? "/cashbook/receive-payment"
              : optionalDue
                ? "/customers"
                : "/payments"
        }
      >
        {id
          ? "Customer Account"
          : cashbook
            ? "Receive Payment"
            : optionalDue
              ? "Customers"
              : "Payments"}
      </Link>
      <h1 className="mt-5 text-2xl font-semibold">
        {id ? "Add Old Due" : optionalDue ? "Add Customer" : "Add Old Customer"}
      </h1>
      {!id && (
        <p className="mt-2 text-sm text-[var(--muted)]">
          {optionalDue
            ? "Save customer details. If they already owe money, add their old due below."
            : "Add a previous customer and the amount they already owed. Save their old due, then continue to Receive Payment."}
        </p>
      )}
      {id && customer.isError ? (
        <LedgerError
          message={customer.error.message}
          retry={() => void customer.refetch()}
        />
      ) : id && !customer.data ? (
        <LedgerLoading />
      ) : (
        <>
          {id && <p className="mt-2 text-sm">{customer.data?.name}</p>}
          {(save.error || plainSave.error) && (
            <div role="alert" className="mt-4 text-sm text-[var(--danger)]">
              <p>{(save.error || plainSave.error)?.message}</p>
              {save.error instanceof CustomerPhoneConflictError && (
                <Link
                  className={ledgerLink}
                  to={`/customers/${save.error.existingCustomer.id}`}
                >
                  Open Existing Customer
                </Link>
              )}
            </div>
          )}
          {plainSave.error instanceof CustomerPhoneConflictError && (
            <Link
              className={ledgerLink}
              to={`/customers/${plainSave.error.existingCustomer.id}`}
            >
              Open Existing Customer
            </Link>
          )}
          {pending ? (
            <section className="mt-5 space-y-3 border-y border-[var(--border)] py-4">
              <p className="text-sm">
                {save.isPending ? "Saving…" : "Finish saving the Opening Due."}
              </p>
              <Button disabled={save.isPending} onClick={submit}>
                Retry Save
              </Button>
            </section>
          ) : customer.data?.openingDue ? (
            <p className="mt-5 text-sm">
              This customer already has an Opening Due.
            </p>
          ) : (
            <form
              className="mt-5 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              {!id && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-medium sm:col-span-2">
                    Customer Name *
                    <Input
                      className="mt-2"
                      required
                      autoFocus
                      maxLength={200}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <label className="text-sm font-medium">
                    Phone
                    <Input
                      className="mt-2"
                      type="tel"
                      maxLength={50}
                      value={phone}
                      aria-invalid={!!phoneError}
                      aria-describedby={
                        phoneError ? "opening-phone-error" : undefined
                      }
                      onChange={(e) => setPhone(e.target.value)}
                    />
                    {phoneError && (
                      <span
                        id="opening-phone-error"
                        className="mt-1 block text-xs text-[var(--danger)]"
                      >
                        {phoneError}
                      </span>
                    )}
                  </label>
                  <label className="text-sm font-medium">
                    Email
                    <Input
                      className="mt-2"
                      type="email"
                      maxLength={200}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </label>
                  <label className="text-sm font-medium sm:col-span-2">
                    Address
                    <Input
                      className="mt-2"
                      maxLength={1000}
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                    />
                  </label>
                </div>
              )}
              {optionalDue && (
                <label className="flex min-h-12 items-center gap-3 border-y border-[var(--border)] py-4 text-sm font-medium">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--primary)]"
                    checked={hasDue}
                    onChange={(e) => setHasDue(e.target.checked)}
                  />
                  This customer has old due
                </label>
              )}
              {hasDue && (
                <>
                  <div className="grid gap-4 border-t border-[var(--border)] pt-4 sm:grid-cols-2">
                    <label className="text-sm font-medium">
                      Opening Due *
                      <Input
                        className="mt-2"
                        required
                        inputMode="decimal"
                        autoFocus={!!id}
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        aria-invalid={
                          !!amount && (cents === null || cents <= 0)
                        }
                      />
                      {!!amount && (cents === null || cents <= 0) && (
                        <span className="mt-1 block text-xs text-[var(--danger)]">
                          Enter an amount above ৳0, with up to two decimal
                          places.
                        </span>
                      )}
                    </label>
                    <label className="text-sm font-medium">
                      Balance Date *
                      <Input
                        className="mt-2"
                        type="date"
                        required
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                      />
                    </label>
                  </div>
                  <label className="block text-sm font-medium">
                    Note
                    <Input
                      className="mt-2"
                      maxLength={2000}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </label>
                </>
              )}
              <div className="flex flex-wrap gap-3">
                <Button
                  className="w-full sm:w-auto"
                  disabled={
                    save.isPending ||
                    plainSave.isPending ||
                    (!id && (!!phoneError || !emailValid)) ||
                    (hasDue && (cents === null || cents <= 0 || !date)) ||
                    (!id && !name.trim())
                  }
                  type="submit"
                >
                  {plainSave.isPending
                    ? "Saving…"
                    : optionalDue
                      ? "Save Customer"
                      : "Save & Continue"}
                </Button>
                <Button asChild variant="outline">
                  <Link
                    to={
                      optionalDue
                        ? "/customers"
                        : cashbook
                          ? "/cashbook/receive-payment"
                          : id
                            ? `/customers/${id}`
                            : "/payments"
                    }
                  >
                    Cancel
                  </Link>
                </Button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}
