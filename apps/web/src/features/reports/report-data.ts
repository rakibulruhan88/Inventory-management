import type { FinanceSummary } from "@afia/contracts";
import { dhakaDate } from "@/lib/business-time";

export const periods = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "specific", label: "Specific Date" },
  { value: "range", label: "Custom Dates" },
  { value: "all", label: "All Dates" },
] as const;
export type ReportPeriod = (typeof periods)[number]["value"];
export type DateWindow = { from: string; to: string };
const day = 86400000;
const dateValue = (date: string) => new Date(`${date}T00:00:00Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);
const shift = (date: string, days: number) => iso(new Date(dateValue(date).getTime() + days * day));
const valid = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(dateValue(date).getTime()) && iso(dateValue(date)) === date;

// Match the API's complete Dhaka days, Monday-start weeks and calendar months.
export function reportWindow(period: ReportPeriod, from: string, to: string): DateWindow | null {
  const today = dhakaDate();
  if (period === "all") return null;
  if (period === "specific" || period === "range") {
    const end = period === "specific" ? from : to;
    return valid(from) && valid(end) && from <= end ? { from, to: end } : null;
  }
  if (period === "yesterday") return { from: shift(today, -1), to: shift(today, -1) };
  if (period === "week") {
    const start = shift(today, -((dateValue(today).getUTCDay() + 6) % 7));
    return { from: start, to: shift(start, 6) };
  }
  if (period === "month") {
    const start = `${today.slice(0, 7)}-01`;
    const end = iso(new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)));
    return { from: start, to: end };
  }
  return { from: today, to: today };
}
export function previousWindow(period: ReportPeriod, range: DateWindow | null): DateWindow | null {
  if (!range) return null;
  if (period === "month") {
    const end = shift(range.from, -1);
    return { from: `${end.slice(0, 7)}-01`, to: end };
  }
  const days = Math.round((dateValue(range.to).getTime() - dateValue(range.from).getTime()) / day) + 1;
  return { from: shift(range.from, -days), to: shift(range.from, -1) };
}
export function windowLabel(range: DateWindow | null) {
  if (!range) return "All recorded dates";
  const format = (date: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(dateValue(date));
  return range.from === range.to ? format(range.from) : `${format(range.from)} – ${format(range.to)}`;
}
export const percent = (part: number, total: number) => total > 0 ? part / total * 100 : null;
export const percentage = (value: number | null) => value === null ? "—" : `${value.toLocaleString("en-BD", { maximumFractionDigits: 1 })}%`;
export const compactMoney = (amount: number) => `৳${new Intl.NumberFormat("en-BD", { notation: "compact", maximumFractionDigits: 1 }).format(amount)}`;
export const reportColors = { in: "var(--success)", out: "var(--primary)", other: "var(--warning)", older: "var(--muted-foreground)", previous: "var(--muted-foreground)" };
export function moneyGroups(summary: FinanceSummary, direction: "in" | "out") {
  const types = direction === "in"
    ? ["SALE_PAYMENT", "DUE_PAYMENT", "OTHER_IN", "LEGACY_PAYMENT"] as const
    : ["SUPPLIER_PAYMENT", "EXPENSE", "OTHER_OUT"] as const;
  const names = { SALE_PAYMENT: "Sale Payments", DUE_PAYMENT: "Customer Due Payments", OTHER_IN: "Other Money In", LEGACY_PAYMENT: "Older Payments", SUPPLIER_PAYMENT: "Supplier Payments", EXPENSE: "Expenses", OTHER_OUT: "Other Money Out" };
  const colors = direction === "in" ? [reportColors.in, reportColors.out, reportColors.other, reportColors.older] : [reportColors.out, reportColors.other, reportColors.older];
  return types.map((type, index) => ({ type, name: names[type], amount: summary.byType[type], value: Number(summary.byType[type]), fill: colors[index] }));
}
export function exportReport(summary: FinanceSummary, range: DateWindow | null, previous?: FinanceSummary, previousRange?: DateWindow | null) {
  const rows: (string | number)[][] = [
    ["Afia Leather — Financial Summary"], ["Period", windowLabel(range)], ["Timezone", "Asia/Dhaka"], ["Currency", "BDT"],
    ["Metric", "Selected period", ...(previous ? ["Previous period"] : [])],
    ...(["sales", "moneyIn", "moneyOut", "netMoney", "oldDue"] as const).map((key, i) => [["Sales", "Money In", "Money Out", "Net Money", "Old Due Collected"][i], summary[key], ...(previous ? [previous[key]] : [])]),
    ...(previous ? [["Previous dates", windowLabel(previousRange ?? null)]] : []),
    [], ["Payment type", "Amount BDT"], ...[...moneyGroups(summary, "in"), ...moneyGroups(summary, "out")].map((group) => [group.name, group.amount]),
    [], ["Method", "Money In BDT", "Money Out BDT"], ...summary.methods.map((method) => [method.method, method.moneyIn, method.moneyOut]),
    [], ["Net Money is Money In minus Money Out; it is not profit or a cash balance."],
  ];
  const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `afia-financial-summary-${range?.from ?? "all"}-${range?.to ?? dhakaDate()}.csv`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
