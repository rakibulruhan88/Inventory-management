// This vocabulary is exclusively for structure. Callers slice values from the
// original text using offsets; normalized/fuzzy strings never become data.
export const structuralAliases = {
  item: [
    'Item No',
    'Item Number',
    'Item#',
    'Item Code',
    'Product No',
    'Product Code',
    'Style No',
    'Style Code',
  ],
  description: [
    'Description',
    'Product Description',
    'Item Description',
    'Specification',
    'Description Size',
  ],
  color: [
    'Color code',
    'Colour code',
    'Color',
    'Colour',
    'Shade',
    'Color No',
    'Colour No',
  ],
  meter: [
    'Quantity Meter',
    'Qty Meter',
    'Meter Qty',
    'Meter',
    'Meters',
    'Metre',
    'Metres',
    'Length Meter',
  ],
  rolls: [
    'Rolls quantity',
    'Roll quantity',
    'Rolls Qty',
    'Roll Qty',
    'Qty Rolls',
    'Rolls',
    'Roll',
    'No of Rolls',
    'Number of Rolls',
  ],
  price: ['Unit Price', 'FOB Unit Price', 'FOB QD Unit Price', 'Price', 'Rate'],
  amount: ['Total Amount', 'Amount', 'Line Total', 'Total USD'],
  contract: [
    'Contract No',
    'Contract Number',
    'Contract#',
    'Contract Ref',
    'Contract Reference',
    'Container No',
    'Container Number',
    'Container#',
  ],
  supplier: [
    'Exporter Beneficiary',
    'Exporter',
    'Beneficiary',
    'Supplier',
    'Vendor',
    'Manufacturer',
  ],
  address: ['ADD', 'Address', 'ADDR'],
  phone: ['TEL', 'Telephone', 'Phone', 'Mobile'],
  fax: ['FAX'],
  contact: ['Contact Person', 'Contact', 'Attention', 'ATTN'],
  table: [
    'Order List',
    'Order Details',
    'Item List',
    'Product List',
    'Products',
  ],
  total: ['Total Amount', 'LC Amount', 'Grand Total', 'Invoice Total', 'Total'],
  totalMeter: ['Total Meter', 'Total Meters', 'Total Metre', 'Total Metres'],
  totalRolls: ['Total Rolls', 'Total Roll'],
  invoice: ['Commercial Invoice', 'Proforma Invoice', 'Invoice'],
  size: ['Size', 'Dimensions'],
  backing: ['Brush backing'],
  stop: [
    'Notify Party',
    'Consignee',
    'Buyer',
    'CI No',
    'Shipping Way',
    'Terms of Delivery Payment',
    'Country of Origin',
    'Country of Destination',
    'Date',
    'Freight',
    'Loading',
    'Loading Export Charge',
    'Loading Truck FOB charge',
    'Export charge',
    'Payment',
    'Payment Information',
    'Banking Details',
    'Bank Details',
  ],
} as const;
export type StructuralRole = keyof typeof structuralAliases;
export type LabelMatch = {
  role: StructuralRole;
  start: number;
  end: number;
  fuzzy: boolean;
  score: number;
};
export const columnRoles = [
  'item',
  'description',
  'color',
  'meter',
  'rolls',
  'price',
  'amount',
] as const;
export function normalizeStructuralLabel(text: string) {
  return text
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[\p{P}\p{S}\s]+/gu, '')
    .replace(/[οо]/g, 'o')
    .replace(/[сϲ]/g, 'c')
    .replace(/0/g, 'o')
    .replace(/^s[1lı]ze$/, 'size');
}
// One edit is permitted only in a sufficiently long known label, never arbitrary
// fuzzy prose. Context must additionally approve fuzzy matches at the call site.
function oneEdit(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0,
    j = 0,
    edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return edits + (i < a.length || j < b.length ? 1 : 0) <= 1;
}
export function matchStructuralLabel(
  text: string,
  roles: readonly StructuralRole[],
  fuzzy = false,
): { role: StructuralRole; fuzzy: boolean; score: number } | null {
  const normalized = normalizeStructuralLabel(
    text.replace(/\([^)]*USD[^)]*\)/gi, ''),
  );
  const full = normalizeStructuralLabel(text);
  const exact = roles.filter((role) =>
    structuralAliases[role].some((alias) => {
      const a = normalizeStructuralLabel(alias);
      return a === normalized || a === full;
    }),
  );
  if (exact.length === 1) return { role: exact[0], fuzzy: false, score: 1 };
  if (!fuzzy || exact.length) return null;
  if (
    Object.values(structuralAliases).some((aliases) =>
      aliases.some((alias) => normalizeStructuralLabel(alias) === normalized),
    )
  )
    return null;
  const candidates = roles.filter((role) =>
    structuralAliases[role].some((alias) => {
      const expected = normalizeStructuralLabel(alias);
      return (
        expected.length >= 5 &&
        normalized.length >= 5 &&
        oneEdit(normalized, expected)
      );
    }),
  );
  return candidates.length === 1
    ? { role: candidates[0], fuzzy: true, score: 0.8 }
    : null;
}
export function findStructuralLabels(
  text: string,
  roles: readonly StructuralRole[],
  fuzzy = false,
): LabelMatch[] {
  const words = [...text.matchAll(/[\p{L}\p{N}]+(?:[#＃])?|[#＃]/gu)];
  const matches: LabelMatch[] = [];
  for (let i = 0; i < words.length; i++) {
    let best: LabelMatch | undefined;
    for (let count = 1; count <= 5 && i + count <= words.length; count++) {
      const start = words[i].index!,
        end = words[i + count - 1].index! + words[i + count - 1][0].length;
      const result = matchStructuralLabel(text.slice(start, end), roles, fuzzy);
      if (
        result &&
        (!best || (!result.fuzzy && best.fuzzy) || result.fuzzy === best.fuzzy)
      )
        best = { ...result, start, end };
    }
    if (best) {
      matches.push(best);
      while (i + 1 < words.length && words[i + 1].index! < best.end) i++;
    }
  }
  return matches;
}
export function prefixLabel(
  text: string,
  roles: readonly StructuralRole[],
  fuzzy = false,
) {
  return findStructuralLabels(text, roles, fuzzy).find(
    (match) => !text.slice(0, match.start).trim(),
  );
}
export function labeledValue(
  text: string,
  role: StructuralRole,
  fuzzy = false,
) {
  const match = prefixLabel(text, [role], fuzzy);
  return match
    ? text
        .slice(match.end)
        .replace(/^[\s:：.#＃/|;-]+/, '')
        .trim()
    : null;
}
