import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { SaleInvoice } from '@afia/contracts';
import { createInvoicePdf } from './invoice-pdf.js';
const fixture: SaleInvoice = {
  id: 'sale',
  invoiceNumber: 'AF-123',
  customerId: 'customer',
  soldAt: '2026-10-07T18:30:00Z',
  status: 'COMPLETED',
  voidedAt: null,
  voidReason: null,
  currentCustomerEmail: null,
  lastEmailedAt: null,
  customer: { name: 'Test Shop', phone: null, email: null, address: null },
  subtotal: 10000,
  totalAmount: 10000,
  discountAmount: 0,
  receivedAmount: 4000,
  changeAmount: 0,
  paidAmount: 6000,
  dueAmount: 4000,
  previousOutstandingBeforeSale: 5000,
  outstandingAfterSale: 11000,
  notes: null,
  payments: [],
  lines: [
    {
      id: 'line',
      itemCode: 'F100',
      description: 'Leather 1.2mm',
      itemName: null,
      color: '02#Pine green',
      rollsSold: 2,
      meterSold: null,
      unitPricePerRoll: 5000,
      lineTotal: 10000,
    },
  ],
  settings: {
    storeName: 'Afia Leather',
    logoUrl: null,
    faviconUrl: null,
    storePhone: null,
    storeEmail: null,
    storeAddress: null,
    currency: 'BDT',
    currencySymbol: '৳',
    invoicePrefix: 'AF-',
    defaultPaymentMethod: 'CASH',
    brandAccent: '#895332',
    lowStockRollThreshold: 3,
    lowStockMeterThreshold: 500,
  },
};
async function read(invoice: SaleInvoice) {
  const task = getDocument({
    data: new Uint8Array(await createInvoicePdf(invoice)),
    useSystemFonts: true,
  });
  const pdf = await task.promise;
  try {
    const pages: string[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const text = await (await pdf.getPage(n)).getTextContent();
      pages.push(
        text.items
          .flatMap((i) => ('str' in i ? [i.str] : []))
          .join(' ')
          .replace(/\s+/g, ' '),
      );
    }
    return pages;
  } finally {
    await task.destroy();
  }
}
describe('Invoice PDF formatting', () => {
  it('prints one complete page without extra blank footer pages, with taka and Dhaka date', async () => {
    const pages = await read(fixture);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toContain('৳5,000');
    expect(pages[0]).toContain('08 Oct 2026');
    expect(pages[0]).toContain('Price / Roll');
    expect(pages[0]).toContain('1 / 1');
  });
  it('keeps paid-at-sale, later money and original due snapshots separate', async () => {
    const [text] = await read(fixture);
    expect(text).toContain('Paid at Sale ৳4,000');
    expect(text).toContain('Later Payments ৳2,000');
    expect(text).toContain('Previous Due ৳5,000');
    expect(text).toContain('Total Due After Sale ৳11,000');
  });
  it('repeats headings on long invoices and keeps all rows and totals', async () => {
    const lines = Array.from({ length: 50 }, (_, i) => ({
      ...fixture.lines[0],
      id: String(i),
      itemCode: `ITEM-${String(i).padStart(3, '0')}`,
      description: 'Long supplier description 1.2mm by 54 inches by 36.5m',
    }));
    const pages = await read({ ...fixture, lines });
    expect(pages.length).toBeGreaterThan(1);
    for (const line of lines)
      expect(pages.join(' ').replace(/\s+/g, ' ')).toContain(line.itemCode);
    expect(pages[1]).toContain('Price / Roll');
    expect(pages.at(-1)).toContain('Invoice Total');
    pages.forEach((page, i) =>
      expect(page).toContain(`${i + 1} / ${pages.length}`),
    );
  });
  it('preserves void status and unknown historical due without inventing values', async () => {
    const [text] = await read({
      ...fixture,
      status: 'VOIDED',
      voidReason: 'Wrong Sale',
      previousOutstandingBeforeSale: null,
      outstandingAfterSale: null,
    });
    expect(text).toContain('VOID INVOICE');
    expect(text).toContain('Wrong Sale');
    expect(text).toContain('Previous Due —');
  });
});
