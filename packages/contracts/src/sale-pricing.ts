/** Decimal(14,2) storage limits; integer cents keep roll pricing exact. */
export const MAX_SALE_AMOUNT = 999999999999.99;
const MAX_CENTS = 99999999999999n;
export function saleMoneyCents(value: number): bigint {
  if (!Number.isFinite(value) || value < 0 || value > MAX_SALE_AMOUNT)
    throw new Error('Enter a valid amount within the supported limit.');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw new Error('Use at most two decimal places.');
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
}
export function saleLineAmount(rollsSold: number, unitPricePerRoll: number): number {
  if (!Number.isInteger(rollsSold) || rollsSold < 1 || rollsSold > 2147483647)
    throw new Error('Enter a valid whole number of Rolls.');
  const cents = saleMoneyCents(unitPricePerRoll);
  if (cents <= 0n) throw new Error('Unit Price / Roll must be greater than zero.');
  const amount = cents * BigInt(rollsSold);
  if (amount > MAX_CENTS) throw new Error('Line amount exceeds the supported limit.');
  return Number(amount) / 100;
}

/** Meter has two decimal places; round the product once to the nearest cent. */
export function meterSaleLineAmount(meterSold: number, unitPricePerMeter: number): number {
  const meterHundredths = saleMoneyCents(meterSold);
  if (meterHundredths <= 0n || meterSold > 9999999999.99)
    throw new Error('Enter positive Meter with at most two decimal places.');
  const cents = saleMoneyCents(unitPricePerMeter);
  if (cents <= 0n || unitPricePerMeter > 9999999999.99)
    throw new Error('Enter a valid positive Unit Price / Meter.');
  const amount = (meterHundredths * cents + 50n) / 100n;
  if (amount > MAX_CENTS) throw new Error('Line amount exceeds the supported limit.');
  return Number(amount) / 100;
}
