import { validPurchaseDate, type SalesLedgerQuery } from "@afia/contracts";

export const dateOptions = [
  ["", "Any date"],
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["week", "This Week"],
  ["month", "This Month"],
  ["specific", "Specific Date"],
  ["range", "Custom Date Range"],
];
export const statusOptions = [
  ["", "Any status"],
  ["PAID", "Paid"],
  ["PARTIAL", "Partial"],
  ["UNPAID", "Unpaid"],
  ["VOIDED", "Voided"],
];
export const methodOptions = [
  ["", "Any payment method"],
  ["CASH", "Cash"],
  ["BANK", "Bank"],
  ["MOBILE_BANKING", "Mobile Banking"],
  ["OTHER", "Other"],
];
export const sortOptions = [
  ["newest", "Newest"],
  ["oldest", "Oldest"],
  ["highest-total", "Highest total"],
  ["lowest-total", "Lowest total"],
  ["highest-due", "Highest due"],
];
export function filterError(q: SalesLedgerQuery) {
  if (q.date === "specific" && !validPurchaseDate(q.from))
    return "Choose a specific date.";
  if (
    q.date === "range" &&
    (!validPurchaseDate(q.from) || !validPurchaseDate(q.to))
  )
    return "Choose both From Date and To Date.";
  if (q.date === "range" && q.from! > q.to!)
    return "From Date cannot be after To Date.";
  for (const [min, max] of [
    [q.minTotal, q.maxTotal],
    [q.minDue, q.maxDue],
  ]) {
    if ((min !== undefined && min < 0) || (max !== undefined && max < 0))
      return "Amounts cannot be negative.";
    if (min !== undefined && max !== undefined && min > max)
      return "Minimum cannot exceed maximum.";
  }
  return "";
}
export function activeFilterLabels(q: SalesLedgerQuery) {
  const labels: { key: keyof SalesLedgerQuery; label: string }[] = [];
  const names: Record<string, string> = {
    customer: "Customer",
    phone: "Phone",
    invoice: "Invoice",
    product: "Product",
    minTotal: "Min total",
    maxTotal: "Max total",
    minDue: "Min invoice due",
    maxDue: "Max invoice due",
    customerId: "Customer account",
  };
  Object.entries(names).forEach(([key, name]) => {
    const v = q[key as keyof SalesLedgerQuery];
    if (v !== undefined && v !== "")
      labels.push({
        key: key as keyof SalesLedgerQuery,
        label: `${name}: ${v}`,
      });
  });
  if (q.date)
    labels.push({
      key: "date",
      label: `${dateOptions.find((o) => o[0] === q.date)?.[1]}${q.from ? `: ${q.from}${q.date === "range" ? ` – ${q.to}` : ""}` : ""}`,
    });
  if (q.status)
    labels.push({
      key: "status",
      label: statusOptions.find((o) => o[0] === q.status)![1],
    });
  if (q.method)
    labels.push({
      key: "method",
      label: methodOptions.find((o) => o[0] === q.method)![1],
    });
  if (q.sort && q.sort !== "newest")
    labels.push({
      key: "sort",
      label: sortOptions.find((o) => o[0] === q.sort)![1],
    });
  return labels;
}
export function readLedgerParams(params: URLSearchParams): SalesLedgerQuery {
  const q: SalesLedgerQuery = {};
  for (const key of [
    "search",
    "customer",
    "phone",
    "invoice",
    "product",
    "customerId",
    "from",
    "to",
  ] as const) {
    const v = params.get(key);
    if (v) q[key] = v;
  }
  for (const key of [
    "minTotal",
    "maxTotal",
    "minDue",
    "maxDue",
    "page",
  ] as const) {
    const raw = params.get(key);
    if (
      raw !== null &&
      raw !== "" &&
      Number.isFinite(Number(raw)) &&
      Number(raw) >= 0
    )
      q[key] =
        key === "page" ? Math.max(1, Math.floor(Number(raw))) : Number(raw);
  }
  const date = params.get("date"),
    status = params.get("status"),
    method = params.get("method"),
    sort = params.get("sort");
  if (date && dateOptions.some((o) => o[0] === date))
    q.date = date as SalesLedgerQuery["date"];
  if (status && statusOptions.some((o) => o[0] === status))
    q.status = status as SalesLedgerQuery["status"];
  if (method && methodOptions.some((o) => o[0] === method))
    q.method = method as SalesLedgerQuery["method"];
  if (sort && sortOptions.some((o) => o[0] === sort))
    q.sort = sort as SalesLedgerQuery["sort"];
  return q;
}
