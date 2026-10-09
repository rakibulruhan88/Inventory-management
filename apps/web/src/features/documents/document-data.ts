
export const paymentMethod = (method: string) =>
  ({
    CASH: "Cash",
    BANK: "Bank",
    MOBILE_BANKING: "Mobile Banking",
    OTHER: "Other",
  })[method] ?? method.replaceAll("_", " ");

export const documentMoney = (
  value: number | null | undefined,
  symbol = "৳",
) =>
  value == null
    ? "—"
    : `${symbol}${value.toLocaleString("en-BD", { minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

export { invoiceAmounts } from "@afia/contracts";
