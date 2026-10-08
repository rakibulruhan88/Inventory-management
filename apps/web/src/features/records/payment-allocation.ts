import type { PaymentContext } from "@afia/contracts";
export function moneyCents(text: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(text.trim())) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value > 999999999999.99) return null;
  return Math.round(value * 100);
}
export function previewAllocation(
  context: PaymentContext,
  amount: number,
  mode: "AUTO" | "MANUAL",
  manual: Record<string, string>,
) {
  let left = amount;
  return (
    context.sources ??
    context.invoices.map((i) => ({
      ...i,
      sourceKind: "SALE" as const,
      saleId: i.id,
      openingBalanceId: null,
    }))
  ).map((invoice) => {
    const due = Math.round(invoice.dueAmount * 100);
    const applied =
      mode === "AUTO"
        ? Math.max(0, Math.min(left, due))
        : moneyCents(manual[invoice.id] || "0");
    if (mode === "AUTO") left -= applied ?? 0;
    return {
      invoice,
      cents: applied,
      valid: applied !== null && applied <= due,
    };
  });
}
