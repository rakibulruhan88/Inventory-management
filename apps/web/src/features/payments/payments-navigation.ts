import type { CustomerSummary } from "@afia/contracts";
export function readPaymentsParams(params: URLSearchParams) {
  const raw = Number(params.get("page") ?? 1);
  return {
    view:
      params.get("view") === "receipts"
        ? ("receipts" as const)
        : ("outstanding" as const),
    search: (params.get("search") ?? "").slice(0, 200),
    page: Number.isFinite(raw)
      ? Math.min(1000000, Math.max(1, Math.floor(raw)))
      : 1,
  };
}
export const customerAccountPath = (id: string) =>
  `/customers/${encodeURIComponent(id)}`;
export const receivePaymentPath = (id: string) =>
  `${customerAccountPath(id)}/receive-payment`;
export const receiptDetailPath = (customerId: string, receiptId: string) =>
  `${customerAccountPath(customerId)}/receipts/${encodeURIComponent(receiptId)}`;
export function prioritizeDueCustomers(customers: CustomerSummary[]) {
  return [...customers].sort(
    (a, b) =>
      Number(b.totalDue > 0) - Number(a.totalDue > 0) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}
