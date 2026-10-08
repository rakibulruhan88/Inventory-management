import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { readSalesLedger } from './sales-ledger.js';
import { CustomersService } from '../customers/customers.service.js';
import type { SalesLedgerQuery } from '@afia/contracts';

// Test fixtures are isolated from production records; only this schema is removed.
describe('sales ledger and customer account PostgreSQL reads', () => {
  const schema = `ledger_test_${randomUUID().replaceAll('-', '')}`;
  const url =
    process.env.DATABASE_URL ??
    'postgresql://afia:afia_local_password@localhost:5433/afia_inventory?schema=public';
  const admin = new PrismaClient({ adapter: new PrismaPg(url) });
  let client: PrismaClient;
  let prisma: PrismaService;
  const tables = [
    'CustomerOpeningBalance',
    'CustomerPaymentReceipt',
    'CustomerPaymentAllocation',
    'Customer',
    'Sale',
    'Payment',
    'Product',
    'ProductVariant',
    'SaleLine',
    'AuditLog',
  ];
  beforeAll(async () => {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    for (const table of tables)
      await admin.$executeRawUnsafe(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    for (const name of ['SaleStatus', 'PaymentMethod', 'SaleMode']) {
      const labels = await admin.$queryRaw<{ label: string }[]>(
        Prisma.sql`SELECT e.enumlabel::text AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typname = ${name} ORDER BY e.enumsortorder`,
      );
      await admin.$executeRawUnsafe(
        `CREATE TYPE "${schema}"."${name}" AS ENUM (${labels.map((r) => "'" + r.label.replaceAll("'", "''") + "'").join(',')})`,
      );
      const table =
          name === 'SaleStatus'
            ? 'Sale'
            : name === 'SaleMode'
              ? 'SaleLine'
              : 'Payment',
        column =
          name === 'SaleStatus'
            ? 'status'
            : name === 'SaleMode'
              ? 'mode'
              : 'method';
      await admin.$executeRawUnsafe(
        `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column}" DROP DEFAULT`,
      );
      await admin.$executeRawUnsafe(
        `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column}" TYPE "${schema}"."${name}" USING "${column}"::text::"${schema}"."${name}"`,
      );
    }
    const scoped = new URL(url);
    scoped.searchParams.set('options', `-c search_path=${schema}`);
    client = new PrismaClient({
      adapter: new PrismaPg(scoped.toString(), { schema }),
    });
    prisma = client as PrismaService;
    await client.customer.createMany({
      data: [
        {
          id: 'c1',
          name: 'Rahim Traders',
          phone: '01711111111',
          email: 'rahim@example.test',
          address: 'Dhaka',
        },
        { id: 'c2', name: 'Karim Leather', phone: '01822222222' },
      ],
    });
    await client.product.create({
      data: {
        id: 'product',
        itemCode: 'L100',
        normalizedItemCode: 'L100',
        description: '1.2mm*54',
        variants: {
          create: { id: 'variant', color: '02#Pine green', variantKey: 'PINE' },
        },
      },
    });
    const fixtures = [
      ['s1', 'AF-001', 'c1', 'COMPLETED', 100, 100, '2026-10-06T17:59:59Z'],
      ['s2', 'AF-002', 'c1', 'COMPLETED', 200, 50, '2026-10-06T18:00:00Z'],
      ['s3', 'AF-003', 'c2', 'COMPLETED', 300, 0, '2026-10-07T17:59:59Z'],
      ['s4', 'AF-004', 'c1', 'VOIDED', 400, 0, '2026-10-07T18:00:00Z'],
      ['s5', 'AF-005', 'c1', 'COMPLETED', 50, 0, '2026-10-05T18:00:00Z'],
    ] as const;
    for (const [
      id,
      invoiceNumber,
      customerId,
      status,
      totalAmount,
      paidAmount,
      date,
    ] of fixtures) {
      await client.sale.create({
        data: {
          id,
          invoiceNumber,
          customerId,
          status,
          totalAmount,
          paidAmount,
          createdAt: new Date(date),
          soldAt: new Date(date),
          lines: {
            create: {
              id: `l-${id}`,
              variantId: 'variant',
              mode: 'FULL_ROLL',
              rollsSold: 1,
              meterSold: 0,
              lineTotal: totalAmount,
              itemCodeSnapshot: id === 's2' ? 'HIST-ITEM' : null,
              descriptionSnapshot: id === 's2' ? 'Historical size' : null,
              colorNameSnapshot: id === 's2' ? '09#Vintage brown' : null,
            },
          },
        },
      });
    }
    await client.payment.createMany({
      data: [
        {
          id: 'p1',
          customerId: 'c1',
          saleId: 's1',
          amount: 100,
          method: 'CASH',
          receivedAt: new Date('2026-10-06'),
        },
        {
          id: 'p2',
          customerId: 'c1',
          saleId: 's2',
          amount: 30,
          method: 'BANK',
          reference: 'BANK-REF',
          notes: 'Transfer',
          receivedAt: new Date('2026-10-07'),
        },
        {
          id: 'p3',
          customerId: 'c1',
          saleId: 's2',
          amount: 20,
          method: 'MOBILE_BANKING',
          receivedAt: new Date('2026-10-08'),
        },
        {
          id: 'p4',
          customerId: 'c1',
          saleId: 's4',
          amount: 400,
          method: 'OTHER',
          voidedAt: new Date(),
        },
        {
          id: 'p5',
          customerId: 'c1',
          amount: 1,
          method: 'OTHER',
          notes: 'Legacy unlinked record',
          receivedAt: new Date('2026-10-09'),
        },
      ],
    });
  }, 30000);
  afterAll(async () => {
    await client?.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.$disconnect();
  });
  const ids = async (q: SalesLedgerQuery) =>
    (await readSalesLedger(prisma, q)).items.map((s) => s.id);
  it('includes exactly one local day at both boundaries', async () => {
    expect(await ids({ date: 'specific', from: '2026-10-07' })).toEqual([
      's3',
      's2',
    ]);
    expect(
      await ids({ date: 'range', from: '2026-10-06', to: '2026-10-07' }),
    ).toEqual(['s3', 's2', 's1', 's5']);
  });
  it.each([
    [{ customer: 'RAHIM' }, ['s4', 's2', 's1', 's5']],
    [{ phone: '01822' }, ['s3']],
    [{ invoice: 'AF-002' }, ['s2']],
    [{ status: 'PAID' }, ['s1']],
    [{ status: 'PARTIAL' }, ['s2']],
    [{ status: 'UNPAID' }, ['s3', 's5']],
    [{ status: 'VOIDED' }, ['s4']],
    [{ method: 'CASH' }, ['s1']],
    [{ method: 'BANK' }, ['s2']],
    [{ method: 'MOBILE_BANKING' }, ['s2']],
    [{ method: 'OTHER' }, []],
    [{ minTotal: 100, maxTotal: 200 }, ['s2', 's1']],
    [{ minDue: 100, maxDue: 200 }, ['s2']],
    [{ maxDue: 0 }, ['s1']],
    [{ product: 'HIST-ITEM' }, ['s2']],
    [{ product: 'Historical size' }, ['s2']],
    [{ product: '09#Vintage brown' }, ['s2']],
    [{ product: 'Pine green' }, ['s4', 's3', 's1', 's5']],
    [{ search: 'BANK-REF' }, ['s2']],
    [{ search: '01822' }, ['s3']],
    [{ search: 'HIST-ITEM' }, ['s2']],
    [{ search: "' OR TRUE --" }, []],
  ] as [SalesLedgerQuery, string[]][])(
    'filters the complete dataset using %j',
    async (q, expected) => expect(await ids(q)).toEqual(expected),
  );
  it('combines date, customer, phone, invoice, status, method, totals, due and product', async () => {
    expect(
      await ids({
        date: 'specific',
        from: '2026-10-07',
        customer: 'Rahim',
        phone: '017',
        invoice: '002',
        status: 'PARTIAL',
        method: 'BANK',
        minTotal: 200,
        maxTotal: 200,
        minDue: 150,
        maxDue: 150,
        product: 'Vintage',
      }),
    ).toEqual(['s2']);
  });
  it.each([
    ['oldest', ['s5', 's1', 's2', 's3', 's4']],
    ['highest-total', ['s4', 's3', 's2', 's1', 's5']],
    ['lowest-total', ['s5', 's1', 's2', 's3', 's4']],
    ['highest-due', ['s3', 's2', 's5', 's1', 's4']],
  ] as const)('sorts %s deterministically', async (sort, expected) =>
    expect(await ids({ sort })).toEqual(expected),
  );
  it('paginates with full matching counts and no unlimited history', async () => {
    const first = await readSalesLedger(prisma, { page: 1, pageSize: 2 });
    const second = await readSalesLedger(prisma, { page: 2, pageSize: 2 });
    expect(first.total).toBe(5);
    expect(first.items.map((s) => s.id)).toEqual(['s4', 's3']);
    expect(second.items.map((s) => s.id)).toEqual(['s2', 's1']);
    expect(
      (await readSalesLedger(prisma, { page: 10, pageSize: 2 })).items,
    ).toEqual([]);
  });
  it('returns authoritative completed-invoice totals, histories and outstanding invoices', async () => {
    const c = await new CustomersService(prisma).account('c1', {
      page: 1,
      pageSize: 25,
    });
    expect(c).toMatchObject({
      name: 'Rahim Traders',
      totalSales: 350,
      totalPaid: 150,
      totalDue: 200,
    });
    expect(c.sales.items.map((s) => s.id)).toEqual(['s4', 's2', 's1', 's5']);
    expect(c.outstandingInvoices.items.map((s) => s.id)).toEqual(['s2', 's5']);
    expect(c.payments.total).toBe(4);
    expect(c.payments.items.find((p) => p.id === 'p2')).toMatchObject({
      amount: 30,
      method: 'BANK',
      reference: 'BANK-REF',
      notes: 'Transfer',
      invoiceNumber: 'AF-002',
      saleId: 's2',
    });
    expect(c.payments.items.find((p) => p.id === 'p5')).toMatchObject({
      saleId: null,
      invoiceNumber: null,
    });
    expect(c.payments.items.find((p) => p.id === 'p4')).toBeUndefined();
    expect(await client.auditLog.count()).toBe(0);
    const paged = await new CustomersService(prisma).account('c1', {
      page: 2,
      pageSize: 1,
    });
    expect(paged.sales.total).toBe(4);
    expect(paged.sales.items).toHaveLength(1);
    expect(paged.outstandingInvoices.items).toHaveLength(1);
    expect(paged.payments.items).toHaveLength(1);
    await expect(
      new CustomersService(prisma).account('missing', {
        page: 1,
        pageSize: 25,
      }),
    ).rejects.toThrow('Customer not found');
  });
  it('uses business date presets against persisted timestamps', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-06T19:00:00Z'));
    try {
      expect(await ids({ date: 'today' })).toEqual(['s3', 's2']);
      expect(await ids({ date: 'yesterday' })).toEqual(['s1', 's5']);
      expect(await ids({ date: 'week' })).toEqual([
        's4',
        's3',
        's2',
        's1',
        's5',
      ]);
      expect(await ids({ date: 'month' })).toEqual([
        's4',
        's3',
        's2',
        's1',
        's5',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
  it('finds filtered invoices beyond the first 50 records and keeps pages bounded', async () => {
    await client.customer.create({
      data: { id: 'many', name: 'Large daily ledger' },
    });
    await client.sale.createMany({
      data: Array.from({ length: 61 }, (_, i) => ({
        id: `many-${String(i).padStart(2, '0')}`,
        customerId: 'many',
        invoiceNumber: `BULK-${i}`,
        status: 'COMPLETED' as const,
        totalAmount: i,
        paidAmount: 0,
        soldAt: new Date('2026-10-09T00:00:00Z'),
      })),
    });
    try {
      const first = await readSalesLedger(prisma, { customerId: 'many' });
      expect(first.items).toHaveLength(25);
      expect(first.total).toBe(61);
      expect(
        (await readSalesLedger(prisma, { customerId: 'many', page: 3 })).items,
      ).toHaveLength(11);
      expect(
        await ids({ invoice: 'BULK-60', customerId: 'many', minTotal: 60 }),
      ).toEqual(['many-60']);
      const c = await new CustomersService(prisma).account('many', {
        page: 3,
        pageSize: 25,
      });
      expect(c.sales.items).toHaveLength(11);
      expect(c.sales.total).toBe(61);
      expect(c.totalSales).toBe(1830);
      expect(c.totalPaid).toBe(0);
      expect(c.totalDue).toBe(1830);
    } finally {
      await client.sale.deleteMany({ where: { customerId: 'many' } });
      await client.customer.delete({ where: { id: 'many' } });
    }
  });
});
