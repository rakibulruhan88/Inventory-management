export const financeTypes = [
  "SALE_PAYMENT",
  "DUE_PAYMENT",
  "OTHER_IN",
  "SUPPLIER_PAYMENT",
  "EXPENSE",
  "OTHER_OUT",
  "LEGACY_PAYMENT",
] as const;
export type FinanceType = (typeof financeTypes)[number];
export type ManualFinanceType =
  "OTHER_IN" | "SUPPLIER_PAYMENT" | "EXPENSE" | "OTHER_OUT";
export const expenseTypes = [
  "Transport",
  "Loading",
  "Rent",
  "Electricity",
  "Salary",
  "Food",
  "Delivery",
  "Office",
  "Repair",
  "Other",
] as const;
export const financeLabels: Record<FinanceType, string> = {
  SALE_PAYMENT: "Sale Payment",
  DUE_PAYMENT: "Old Due Payment",
  OTHER_IN: "Other Money In",
  SUPPLIER_PAYMENT: "Supplier Payment",
  EXPENSE: "Expense",
  OTHER_OUT: "Other Money Out",
  LEGACY_PAYMENT: "Older Payment",
};
export type FinanceMethod = "CASH" | "BANK" | "MOBILE_BANKING" | "OTHER";
export interface FinanceQuery {
  direction?: "IN" | "OUT";
  status?: "active" | "voided" | "all";
  date?: "today" | "yesterday" | "week" | "month" | "specific" | "range";
  from?: string;
  to?: string;
  type?: FinanceType;
  method?: FinanceMethod;
  search?: string;
  page?: number;
  pageSize?: number;
}
export interface CreateFinanceEntry {
  type: ManualFinanceType;
  amount: number;
  method: FinanceMethod;
  occurredAt: string;
  expenseType?: (typeof expenseTypes)[number];
  reference?: string;
  note?: string;
  supplierId?: string;
  purchaseId?: string;
  containerId?: string;
  idempotencyKey: string;
}
export interface FinanceRow {
  voidedAt: string | null;
  id: string;
  sourceId: string;
  type: FinanceType;
  direction: "IN" | "OUT";
  amount: string;
  occurredAt: string;
  method: FinanceMethod;
  details: string;
  reference: string | null;
  note: string | null;
  sourceUrl: string;
  oldDue: string;
}
export interface FinanceSummary {
  sales: string;
  moneyIn: string;
  moneyOut: string;
  netMoney: string;
  oldDue: string;
  byType: Record<FinanceType, string>;
  methods: { method: FinanceMethod; moneyIn: string; moneyOut: string }[];
}
export interface FinancePage {
  items: FinanceRow[];
  total: number;
  page: number;
  pageSize: number;
  summary: FinanceSummary;
}
export interface FinanceEntryDetail extends Omit<
  CreateFinanceEntry,
  "amount" | "idempotencyKey"
> {
  id: string;
  amount: string;
  direction: "IN" | "OUT";
  createdAt: string;
  createdBy: string;
  creatorName: string;
  supplierName: string | null;
  purchaseNumber: string | null;
  containerNumber: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  voiderName: string | null;
}
