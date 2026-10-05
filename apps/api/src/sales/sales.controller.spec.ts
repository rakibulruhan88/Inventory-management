import { StreamableFile } from '@nestjs/common';
import type { SaleInvoice } from '@afia/contracts';
import { SalesController } from './sales.controller.js';

describe('invoice PDF endpoint', () => {
  it('returns the canonical PDF with its professional filename', async () => {
    const invoice = {
      id: 'sale', invoiceNumber: 'AF-000124', soldAt: new Date().toISOString(), status: 'COMPLETED',
      voidedAt: null, voidReason: null, customerId: 'customer', currentCustomerEmail: null,
      customer: { name: 'Customer', phone: null, email: null, address: null }, lines: [],
      subtotal: 0, discountAmount: 0, totalAmount: 0, receivedAmount: 0, paidAmount: 0,
      dueAmount: 0, changeAmount: 0, notes: null, payments: [], lastEmailedAt: null,
      settings: {
        storeName: 'Afia Leather', logoUrl: null, faviconUrl: null, storePhone: null,
        storeEmail: null, storeAddress: null, currency: 'BDT', currencySymbol: '৳',
        invoicePrefix: 'AF-', defaultPaymentMethod: 'CASH', lowStockRollThreshold: 3,
        lowStockMeterThreshold: 500, brandAccent: '#2563EB',
      },
    } satisfies SaleInvoice;
    const sales = { details: vi.fn().mockResolvedValue(invoice) };
    const result = await new SalesController(sales as never).pdf(invoice.id);
    expect(result).toBeInstanceOf(StreamableFile);
    expect(result.getHeaders()).toMatchObject({
      type: 'application/pdf',
      disposition: 'attachment; filename="Afia-Leather-AF-000124.pdf"',
    });
    expect(sales.details).toHaveBeenCalledWith(invoice.id);
  });
});
