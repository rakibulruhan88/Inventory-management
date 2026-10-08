import { activityCategories } from "@afia/contracts";
import type { ActivityQuery } from "@afia/contracts";
import { dhakaDate } from "@/lib/business-time";
export function activityFilters(params: URLSearchParams): ActivityQuery {
  const category = activityCategories.find(
    (category) => category === params.get("category"),
  );
  const page = Number(params.get("page"));
  return {
    search: (params.get("search") ?? "").slice(0, 200),
    category,
    actorId: params.get("actorId") ?? undefined,
    action: params.get("action") ?? undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    sort: params.get("sort") === "oldest" ? "oldest" : "newest",
    page: Number.isInteger(page) && page > 0 && page <= 1000000 ? page : 1,
    pageSize: 25,
  };
}
export function activityDateRange(preset: string, now = new Date()) {
  const today = dhakaDate(now);
  if (preset === "all") return { from: undefined, to: undefined };
  const date = new Date(`${today}T12:00:00+06:00`);
  if (preset === "week") date.setUTCDate(date.getUTCDate() - 6);
  if (preset === "month") date.setUTCDate(1);
  return { from: dhakaDate(date), to: today };
}
export function activityDateLabel(date: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(date));
}
export function activityTime(date: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(date));
}
export function activityMoney(value: string | null) {
  return value === null
    ? null
    : `৳${Number(value).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;
}
