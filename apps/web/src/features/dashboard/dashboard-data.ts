import type { FinanceQuery } from "@afia/contracts";
import { dhakaDate } from "@/lib/business-time";

export const overviewPeriods = [
  { value: "today", label: "Today" },
  { value: "week", label: "Last 7 days" },
  { value: "month", label: "This month" },
] as const;
export type OverviewPeriod = (typeof overviewPeriods)[number]["value"];
export type OverviewWindow = { from: string; to: string };
const day = 86400000;
const value = (date: string) => new Date(`${date}T00:00:00Z`).getTime();
const iso = (date: Date) => date.toISOString().slice(0, 10);
export const shiftDay = (date: string, amount: number) => iso(new Date(value(date) + amount * day));

export function overviewWindow(period: OverviewPeriod): OverviewWindow {
  const today = dhakaDate();
  if (period === "week") return { from: shiftDay(today, -6), to: today };
  if (period === "month") return {
    from: `${today.slice(0, 7)}-01`,
    to: iso(new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0))),
  };
  return { from: today, to: today };
}
export function overviewPrevious(period: OverviewPeriod, range: OverviewWindow): OverviewWindow {
  if (period === "month") {
    const end = shiftDay(range.from, -1);
    return { from: `${end.slice(0, 7)}-01`, to: end };
  }
  const days = Math.round((value(range.to) - value(range.from)) / day) + 1;
  return { from: shiftDay(range.from, -days), to: shiftDay(range.from, -1) };
}
export const overviewQuery = (range: OverviewWindow): FinanceQuery => ({ date: "range", ...range, status: "active", page: 1, pageSize: 1 });
export const overviewKey = (range: OverviewWindow) => ["finance", "dashboard", overviewQuery(range)];
export const overviewNumber = (amount: number) => amount.toLocaleString("en-BD", { maximumFractionDigits: 2 });
export const overviewMoney = (amount: number) => `৳${amount.toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const chartMoney = (amount: number) => `৳${amount.toLocaleString("en-BD", { notation: "compact", maximumFractionDigits: 1 })}`;
export function shortDate(date: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}
export function recordDate(date: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Dhaka" }).format(new Date(date));
}
export function overviewRangeLabel(range: OverviewWindow) {
  return range.from === range.to ? shortDate(range.from) : `${shortDate(range.from)} – ${shortDate(range.to)}`;
}
// At most seven aggregate requests, with every selected day included exactly once.
export function trendWindows(range: OverviewWindow) {
  const days = Math.round((value(range.to) - value(range.from)) / day) + 1;
  const step = Math.ceil(days / 7);
  return Array.from({ length: Math.ceil(days / step) }, (_, index) => {
    const from = shiftDay(range.from, index * step);
    const to = shiftDay(range.from, Math.min(days - 1, (index + 1) * step - 1));
    return { from, to, label: from === to ? shortDate(from) : `${new Date(`${from}T00:00:00Z`).getUTCDate()}–${shortDate(to)}` };
  });
}
export function financeLink(path: string, range: OverviewWindow, type?: string) {
  const params = new URLSearchParams({ date: "range", ...range });
  if (type) params.set("type", type);
  return `${path}?${params}`;
}
