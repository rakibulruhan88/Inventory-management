import { meterSaleLineAmount, saleLineAmount, saleMoneyCents } from "@afia/contracts";
export type DraftColor = {
  mode?: "FULL_ROLL" | "BY_METER";
  unitPricePerMeter?: number;
  variantId?: string;
  rollsSold?: number;
  meterSold?: number;
  unitPricePerRoll?: number;
};
export type StockColor = {
  variantId: string;
  color: string | null;
  availableRolls: number;
  availableMeter: number;
};
export const addColorRow = <T>(rows: T[], row: T): T[] => [...rows, row];
export const removeColorRow = <T>(rows: T[], index: number): T[] =>
  rows.filter((_, i) => i !== index);
export function previewAmount(row: DraftColor): number {
  try {
    if (row.mode === "BY_METER") return meterSaleLineAmount(row.meterSold ?? 0, row.unitPricePerMeter ?? 0);
    return saleLineAmount(row.rollsSold ?? 0, row.unitPricePerRoll ?? 0);
  } catch {
    return 0;
  }
}
export function previewSubtotal(rows: DraftColor[]): number {
  return (
    Number(
      rows.reduce((sum, row) => sum + saleMoneyCents(previewAmount(row)), 0n),
    ) / 100
  );
}
export function remainingBeforeRow(stock: StockColor, preceding: DraftColor[]) {
  const same = preceding.filter((row) => row.variantId === stock.variantId);
  return {
    rolls: Math.max(
      0,
      stock.availableRolls -
        same.reduce(
          (sum, row) =>
            sum + (Number.isFinite(row.rollsSold) ? row.rollsSold! : 0),
          0,
        ),
    ),
    meter: Math.max(
      0,
      Number(
        (
          stock.availableMeter -
          same.reduce(
            (sum, row) =>
              sum + (Number.isFinite(row.meterSold) ? row.meterSold! : 0),
            0,
          )
        ).toFixed(2),
      ),
    ),
    repeated: same.length > 0,
  };
}
export function stockErrors(
  rows: DraftColor[],
  stock: StockColor[],
): Map<string, { rolls?: string; meter?: string }> {
  const errors = new Map<string, { rolls?: string; meter?: string }>();
  for (const color of stock) {
    const requests = rows.filter((row) => row.variantId === color.variantId);
    const rolls = requests.reduce(
      (sum, row) => sum + (Number.isFinite(row.rollsSold) ? row.rollsSold! : 0),
      0,
    );
    const meter = Number(
      requests
        .reduce(
          (sum, row) =>
            sum + (Number.isFinite(row.meterSold) ? row.meterSold! : 0),
          0,
        )
        .toFixed(2),
    );
    const error = {
      rolls:
        rolls > color.availableRolls
          ? `Only ${color.availableRolls} Rolls are available across all ${color.color} rows.`
          : undefined,
      meter:
        meter > color.availableMeter
          ? `Only ${color.availableMeter.toLocaleString()} Meter is available across all ${color.color} rows.`
          : undefined,
    };
    if (error.rolls || error.meter) errors.set(color.variantId, error);
  }
  return errors;
}
/** Repeated variants stay selectable, even when earlier draft rows consume their stock. */
export function colorOptions(stock: StockColor[]) {
  return stock
    .filter((color) => color.availableRolls > 0 || color.availableMeter > 0)
    .map((color) => ({
      value: color.variantId,
      label: color.color || "Unnamed color",
      description: `${color.availableRolls} Rolls · ${color.availableMeter.toLocaleString()} Meter in stock`,
      keywords: [color.color ?? ""],
    }));
}

export const saleInputNumber = (value: unknown): number => {
  if (value === "") return 0;
  if (typeof value === "number") return value;
  return typeof value === "string" && /^\d+(?:\.\d*)?$/.test(value)
    ? Number(value)
    : Number.NaN;
};
