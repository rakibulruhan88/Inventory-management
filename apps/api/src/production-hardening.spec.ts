import { validate } from 'class-validator';
import { CustomerDto } from './customers/customer.dto.js';
import { createInvoicePdf, invoiceFileName } from './mail/invoice-pdf.js';
import type { SaleInvoice } from '@afia/contracts';

const makeInvoice = (logoUrl: string | null = null) =>
  ({
    id: 'sale', invoiceNumber: 'AF-000123', soldAt: new Date().toISOString(), status: 'COMPLETED',
    voidedAt: null, voidReason: null, customerId: 'customer', currentCustomerEmail: 'accounts@example.com',
    customer: { name: 'Rahim Traders', phone: null, email: 'accounts@example.com', address: null },
    lines: [], subtotal: 100, discountAmount: 0, totalAmount: 100, receivedAmount: 100,
    paidAmount: 100, dueAmount: 0, changeAmount: 0, notes: null, payments: [], lastEmailedAt: null,
    settings: {
      storeName: 'Afia Leather', logoUrl, faviconUrl: null, storePhone: null, storeEmail: null,
      storeAddress: null, currency: 'BDT', currencySymbol: '৳', invoicePrefix: 'AF-',
      defaultPaymentMethod: 'CASH', lowStockRollThreshold: 3, lowStockMeterThreshold: 500,
      brandAccent: '#9A5B35',
    },
  }) satisfies SaleInvoice;

describe('production hardening contracts', () => {
  it('accepts a name-only customer and optional valid email', async () => {
    const nameOnly = Object.assign(new CustomerDto(), {
      name: 'Rahim Traders',
    });
    expect(await validate(nameOnly)).toHaveLength(0);
    const withEmail = Object.assign(new CustomerDto(), {
      name: 'Rahim Traders',
      email: 'accounts@example.com',
    });
    expect(await validate(withEmail)).toHaveLength(0);
  });

  it('rejects an invalid customer email', async () => {
    const customer = Object.assign(new CustomerDto(), {
      name: 'Rahim Traders',
      email: 'not-an-email',
    });
    expect(
      (await validate(customer)).some((error) => error.property === 'email'),
    ).toBe(true);
  });

  it('creates a real PDF with the professional invoice filename', async () => {
    const invoice = makeInvoice();
    const pdf = await createInvoicePdf(invoice);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(invoiceFileName(invoice)).toBe('Afia-Leather-AF-000123.pdf');
  });

  it.each([
    ['PNG', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
    ['JPEG', 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k='],
  ])('embeds a supported %s Data URL without breaking PDF generation', async (_type, logo) => {
    const pdf = await createInvoicePdf(makeInvoice(logo));
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('falls back cleanly for an invalid or unsupported logo', async () => {
    const pdf = await createInvoicePdf(makeInvoice('data:image/svg+xml;base64,not-supported'));
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });
});
