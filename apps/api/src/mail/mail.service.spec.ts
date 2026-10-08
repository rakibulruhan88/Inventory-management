import type { SaleInvoice } from '@afia/contracts';
import nodemailer from 'nodemailer';
import { MailService } from './mail.service.js';

vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: vi.fn().mockResolvedValue({}) })) },
}));

const invoice = (logoUrl: string | null = null) =>
  ({
    id: 'sale', invoiceNumber: 'AF-1', soldAt: new Date().toISOString(), status: 'COMPLETED',
    voidedAt: null, voidReason: null, customerId: 'customer', currentCustomerEmail: 'buyer@example.com',
    customer: { name: 'Buyer', phone: null, email: 'buyer@example.com', address: null }, lines: [],
    subtotal: 10, discountAmount: 0, totalAmount: 10, receivedAmount: 10, paidAmount: 10,
    dueAmount: 0, changeAmount: 0, notes: null, payments: [], lastEmailedAt: null,
    settings: {
      storeName: 'Afia Leather', logoUrl, faviconUrl: null, storePhone: null, storeEmail: null,
      storeAddress: null, currency: 'BDT', currencySymbol: '৳', invoicePrefix: 'AF-',
      defaultPaymentMethod: 'CASH', lowStockRollThreshold: 3, lowStockMeterThreshold: 500,
      brandAccent: '#2563EB',
    },
  }) satisfies SaleInvoice;

describe('invoice email', () => {
  const config = {
    get: vi.fn((key: string, fallback?: unknown) =>
      ({ MAIL_HOST: 'smtp.example.com', MAIL_USER: 'user', MAIL_APP_PASSWORD: 'pass', MAIL_FROM_EMAIL: 'shop@example.com' })[key] ?? fallback,
    ),
  };
  const tx = { invoiceEmailLog: { create: vi.fn().mockResolvedValue({}) }, auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit' }) } };
  const prisma = { ...tx, $transaction: vi.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) };

  beforeEach(() => vi.clearAllMocks());

  it('remains sendable without a logo and attaches the canonical PDF', async () => {
    const service = new MailService(config as never, prisma as never);
    await expect(service.sendInvoice(invoice())).resolves.toMatchObject({ sent: true });
    const transport = vi.mocked(nodemailer.createTransport).mock.results[0].value;
    const message = vi.mocked(transport.sendMail).mock.calls[0][0];
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments?.[0]).toMatchObject({ contentType: 'application/pdf' });
    expect(message.html).not.toContain('cid:afia-store-logo');
  });

  it('embeds a supported logo as a hidden inline CID attachment', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const service = new MailService(config as never, prisma as never);
    await service.sendInvoice(invoice(png));
    const transport = vi.mocked(nodemailer.createTransport).mock.results[0].value;
    const message = vi.mocked(transport.sendMail).mock.calls[0][0];
    expect(message.html).toContain('src="cid:afia-store-logo"');
    expect(message.attachments?.[1]).toMatchObject({
      cid: 'afia-store-logo', contentDisposition: 'inline', contentType: 'image/png',
    });
  });
});
