import type { UseFormReturn } from "react-hook-form";
import { Input } from "@/components/ui/input";
import type { NewSaleFormData } from "./new-sale-form";
import { saleInputNumber } from "./new-sale-domain";
import { formatSaleMoney } from "./new-sale-presentation";

type Props = {
  form: UseFormReturn<NewSaleFormData>;
  symbol: string;
  subtotal: number;
  total: number;
  paid: number;
  due: number;
  change: number;
  paymentMethod: NewSaleFormData["paymentMethod"];
};

export function SalePaymentPanel({
  form,
  symbol,
  subtotal,
  total,
  paid,
  due,
  change,
  paymentMethod,
}: Props) {
  return (
    <section
      className="sale-payment border-y border-[var(--border)] py-3"
      aria-label="Payment summary"
    >
      <h2 className="sale-settlement-title">Payment</h2>
      <div className="sale-financial-grid text-sm tabular-nums">
        <div className="sale-financial-line">
          <span className="text-xs text-[var(--muted)]">Subtotal</span>
          <strong className="font-medium">
            {formatSaleMoney(subtotal, symbol)}
          </strong>
        </div>
        <label className="sale-financial-line">
          <span className="text-xs text-[var(--muted)]">Discount</span>
          <span className="sale-money-input">
            <span aria-hidden="true">{symbol}</span>
            <Input
              inputMode="decimal"
              className="h-9 text-right"
              aria-invalid={Boolean(form.formState.errors.discountAmount)}
              aria-describedby="sale-discount-error"
              {...form.register("discountAmount", {
                setValueAs: saleInputNumber,
              })}
            />
          </span>
        </label>
        {form.formState.errors.discountAmount && (
          <p
            role="alert"
            id="sale-discount-error"
            className="text-xs text-[var(--danger)]"
          >
            Enter a valid nonnegative discount.
          </p>
        )}
        <div className="sale-financial-line sale-total-line">
          <span className="text-sm font-semibold">Total</span>
          <strong className="text-xl font-semibold tracking-tight">
            {formatSaleMoney(total, symbol)}
          </strong>
        </div>
        <label className="sale-financial-line sale-received">
          <span className="text-xs text-[var(--muted)]">Received</span>
          <span className="sale-money-input">
            <span aria-hidden="true">{symbol}</span>
            <Input
              inputMode="decimal"
              className="h-9 text-right"
              aria-invalid={Boolean(form.formState.errors.receivedAmount)}
              aria-describedby="sale-received-error"
              {...form.register("receivedAmount", {
                setValueAs: saleInputNumber,
              })}
            />
          </span>
        </label>
        {form.formState.errors.receivedAmount && (
          <p
            role="alert"
            id="sale-received-error"
            className="text-xs text-[var(--danger)]"
          >
            Enter a valid nonnegative received amount.
          </p>
        )}
        <div className="sale-financial-line">
          <span className="text-xs text-[var(--muted)]">
            {change > 0 ? "Change" : "Due"}
          </span>
          <strong
            aria-label={change > 0 ? "Change" : "Invoice Due"}
            className={
              due > 0 ? "font-semibold text-[var(--warning)]" : "font-semibold"
            }
          >
            {formatSaleMoney(change > 0 ? change : due, symbol)}
          </strong>
        </div>
        <p className="sr-only">Invoice Paid {formatSaleMoney(paid, symbol)}</p>
      </div>
      <div className="sale-payment-method">
        <p className="mb-1 text-xs font-medium">Payment Method</p>
        <div
          role="group"
          aria-label="Payment method"
          className="grid grid-cols-2 gap-1 min-[600px]:grid-cols-4"
        >
          {(
            [
              ["CASH", "Cash"],
              ["BANK", "Bank"],
              ["MOBILE_BANKING", "Mobile Banking"],
              ["OTHER", "Other"],
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              key={value}
              aria-pressed={paymentMethod === value}
              onClick={() => form.setValue("paymentMethod", value)}
              className={`min-h-10 rounded-md border px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${paymentMethod === value ? "border-[var(--primary-border)] bg-[var(--primary-soft)] text-[var(--primary-strong)]" : "border-transparent text-[var(--muted)] hover:bg-[var(--surface-warm)] hover:text-[var(--ink)]"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
