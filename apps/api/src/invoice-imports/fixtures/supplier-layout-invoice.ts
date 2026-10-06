import type { DocumentLine, ExtractedDocument } from '../document-types.js';

// Sanitized structural reproduction: invented supplier/contact data and row
// amounts. Only the user-provided item/color identities and aggregate targets
// are retained. No private invoice or supplier contact data is in this fixture.
export const supplierLayoutGroups = [
  {
    item: 'T902 PVC',
    colors: ['1#Black', '02#Pine green', '03#Deep coffee', '19#Beige'],
  },
  {
    item: 'XTZ182',
    colors: [
      '1#Black',
      '02#Pine green',
      '03#Deep coffee',
      '04#Palm',
      '19#Beige',
    ],
  },
  {
    item: 'New Lamb',
    colors: [
      '401#Black',
      '716#L-Green',
      '826#Brown',
      '835#L-Brown',
      '904#Off white',
    ],
  },
  {
    item: 'F1212',
    colors: [
      '01#Black',
      'F07111#Green',
      'F07119#Grey',
      'F07124#Beige',
      'F07126#Brown',
    ],
  },
  { item: 'K311', colors: ['985#Beige', '906#Khaki'] },
  { item: 'F032 PVC', colors: ['1#Black'] },
  { item: 'Strap', colors: ['1#Black'] },
];
export const supplierLayoutHeader = [
  'Item No.',
  'Description',
  'Color code',
  'Quantity (Meter)',
  'Rolls quantity',
  'Unit Price (USD)',
  'Total Amount (USD)',
];
export const supplierLayoutRows: string[][] = [];
let index = 0;
for (const group of supplierLayoutGroups) {
  group.colors.forEach((color, colorIndex) => {
    const meter =
      index === 0 ? 1499.5 : index === 1 ? 1500.5 : index === 22 ? 2050 : 1500;
    const rolls = index === 22 ? 84 : 40;
    supplierLayoutRows.push([
      colorIndex === 0 ? group.item : '',
      colorIndex === 0 ? 'PVC LEATHER Size: 1.2mm*54"*36.5m Brush backing' : '',
      color,
      String(meter),
      String(rolls),
      '1.00',
      'US$' + meter.toFixed(2),
    ]);
    index++;
  });
}
export const supplierLayoutLines = [
  'Commercial Invoice',
  'Contract No.: B0312614',
  'EXPORTER / BENEFICIARY: SANITIZED LEATHER CO.,LTD ADD: ROOM 10, TEST ROAD, TEST DISTRICT, TEST CITY Tel: +880-000-101 | Fax: +880-000-102 Contact person: Test Operator',
  'NOTIFY PARTY: Sanitized Buyer',
  'Order List',
  supplierLayoutHeader.join(' | '),
  ...supplierLayoutRows.map((row) => row.join(' | ')),
  'Freight | Loading/Export charge | | | | | US$100.00',
  'Total Amount | | | 35050 | 964 | | US$35,150.00',
  'Payment & Banking Details',
];
export function supplierLayoutDocument(
  offset = 0,
  scale = 1,
): ExtractedDocument {
  const x = [50, 160, 450, 630, 750, 850, 970];
  const lines: DocumentLine[] = supplierLayoutLines.map((text, i) => {
    const cells =
      text.includes('|') && i >= 5
        ? text.split('|').map((cell) => cell.trim())
        : [text];
    return {
      text,
      page: 1,
      line: i + 1,
      method: 'PDF_TEXT',
      spans: cells
        .map((cell, column) => ({
          text: cell,
          x: x[column] * scale + offset,
          y: (30 + i * 28) * scale + offset,
          width: cell.length * 4 * scale,
          height: 8 * scale,
        }))
        .filter((span) => span.text),
    };
  });
  return { lines, method: 'PDF_TEXT', warnings: [] };
}
