/** Customer business identity only. Supplier phone rules are separate. */
export const CUSTOMER_PHONE_ERROR =
  "Use a valid Bangladesh mobile number, such as 01712345678 or +8801712345678.";
export function normalizeCustomerPhone(value?: string | null): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new Error(CUSTOMER_PHONE_ERROR);
  const clean = value.replace(/^[ \t\r\n\f\v]+|[ \t\r\n\f\v]+$/g, "");
  if (!clean) return null;
  if (clean.length > 50 || !/^\+?[0-9 ()-]+$/.test(clean))
    throw new Error(CUSTOMER_PHONE_ERROR);
  // Only whole, balanced groups of digits may be parenthesized.
  const grouped = clean.replace(/\(([0-9]+)\)/g, "$1");
  if (!/^\+?[0-9]+(?:(?: +| *- *)[0-9]+)*$/.test(grouped))
    throw new Error(CUSTOMER_PHONE_ERROR);
  const compact = grouped.replace(/[ -]/g, "");
  if (/^01[3-9][0-9]{8}$/.test(compact)) return `88${compact}`;
  if (/^\+?8801[3-9][0-9]{8}$/.test(compact)) return compact.replace(/^\+/, "");
  throw new Error(CUSTOMER_PHONE_ERROR);
}
export function customerPhoneError(value?: string | null): string | null {
  try {
    normalizeCustomerPhone(value);
    return null;
  } catch {
    return CUSTOMER_PHONE_ERROR;
  }
}
