const wholeMoney = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const decimalMoney = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
export function formatSaleMoney(amount: number, symbol: string) {
  return `${symbol}${(Number.isInteger(amount) ? wholeMoney : decimalMoney).format(amount)}`;
}
