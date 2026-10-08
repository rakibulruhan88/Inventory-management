import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FinanceService, financeInput } from './finance.service.js';
import { FinanceController } from './finance.controller.js';
import { FinanceAccessGuard } from './finance-access.guard.js';
import { readFinance } from './finance-ledger.js';
import { ledgerDateRange } from '../sales/sales-ledger.js';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from '../auth/auth.guard.js';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { CreateFinanceEntry, FinanceQuery } from '@afia/contracts';

describe('Cashbook PostgreSQL accounting and security', () => {
  const schema = `cashbook_${randomUUID().replaceAll('-', '')}`;
  const url =
    process.env.DATABASE_URL ??
    'postgresql://afia:afia_local_password@localhost:5433/afia_inventory';
  const admin = new Pool({ connectionString: url });
  let db: PrismaClient, service: FinanceService, app: INestApplication;
  const owner = randomUUID(),
    staff = randomUUID(),
    customer = randomUUID(),
    supplier = randomUUID(),
    otherSupplier = randomUUID();
  const day = '2026-10-07T12:00:00+06:00';
  const jwt = new JwtService({ secret: 'cashbook-test-only' });
  const base = (): CreateFinanceEntry => ({
    type: 'OTHER_IN',
    amount: 10,
    method: 'CASH',
    occurredAt: day,
    idempotencyKey: randomUUID(),
  });
  const q: FinanceQuery = { date: 'specific', from: '2026-10-07' };
  beforeAll(async () => {
    const c = await admin.connect();
    try {
      await c.query(`CREATE SCHEMA "${schema}"`);
      await c.query(`SET search_path TO "${schema}"`);
      const migrations = new URL('../../prisma/migrations/', import.meta.url);
      for (const folder of readdirSync(migrations).sort())
        if (!folder.endsWith('.toml'))
          await c.query(
            readFileSync(
              new URL(`${folder}/migration.sql`, migrations),
              'utf8',
            ),
          );
    } finally {
      c.release();
    }
    const scoped = new URL(url);
    scoped.searchParams.set('options', `-c search_path=${schema}`);
    db = new PrismaClient({
      adapter: new PrismaPg(scoped.toString(), { schema }),
    });
    await db.user.createMany({
      data: [
        { id: owner, name: 'Owner', role: 'OWNER', passwordHash: 'test' },
        { id: staff, name: 'Staff', role: 'STAFF', passwordHash: 'test' },
      ],
    });
    await db.customer.create({ data: { id: customer, name: 'Test Customer' } });
    await db.supplier.createMany({
      data: [
        { id: supplier, name: 'Leather Supplier' },
        { id: otherSupplier, name: 'Other Supplier' },
      ],
    });
    service = new FinanceService(db as PrismaService);
    const mod = await Test.createTestingModule({
      controllers: [FinanceController],
      providers: [
        FinanceService,
        FinanceAccessGuard,
        { provide: PrismaService, useValue: db },
        {
          provide: ConfigService,
          useValue: new ConfigService({ WEB_ORIGIN: 'http://localhost:5174' }),
        },
        { provide: JwtService, useValue: jwt },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  beforeEach(async () => {
    await db.auditLog.deleteMany();
    await db.financialEntry.deleteMany();
    await db.customerPaymentAllocation.deleteMany();
    await db.customerPaymentReceipt.deleteMany();
    await db.customerOpeningBalance.deleteMany();
    await db.payment.deleteMany();
    await db.sale.deleteMany();
    await db.purchase.deleteMany();
    await db.container.deleteMany();
  });
  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  });
  const sale = async (total = 100, paid = 0) =>
    db.sale.create({
      data: {
        invoiceNumber: randomUUID(),
        customerId: customer,
        status: 'COMPLETED',
        soldAt: new Date(day),
        totalAmount: total,
        paidAmount: paid,
        receivedAmount: paid,
      },
    });
  const checkout = async (total = 100, paid = 40) => {
    const s = await sale(total, paid);
    if (paid)
      await db.payment.create({
        data: {
          customerId: customer,
          saleId: s.id,
          amount: paid,
          method: 'CASH',
          receivedAt: new Date(day),
          cashbookType: 'SALE_PAYMENT',
        },
      });
    return s;
  };
  const receipt = async (saleIds: string[], opening = false) => {
    const r = await db.customerPaymentReceipt.create({
      data: {
        receiptNumber: randomUUID(),
        customerId: customer,
        totalAmount: 20,
        method: 'MOBILE_BANKING',
        paidAt: new Date(day),
        createdBy: owner,
        idempotencyKey: randomUUID(),
        requestHash: 'fixture',
        outstandingBefore: 200,
        outstandingAfter: 180,
      },
    });
    const count = saleIds.length + (opening ? 1 : 0);
    for (const id of saleIds)
      await db.customerPaymentAllocation.create({
        data: {
          receiptId: r.id,
          saleId: id,
          amount: 20 / count,
          previousDue: 100,
          remainingDue: 100 - 20 / count,
        },
      });
    if (opening) {
      const o = await db.customerOpeningBalance.create({
        data: {
          customerId: customer,
          originalAmount: 100,
          balanceAsOf: new Date('2026-01-01'),
          createdBy: owner,
          idempotencyKey: randomUUID(),
          requestHash: 'fixture',
        },
      });
      await db.customerPaymentAllocation.create({
        data: {
          receiptId: r.id,
          openingBalanceId: o.id,
          amount: 20 / count,
          previousDue: 100,
          remainingDue: 100 - 20 / count,
        },
      });
    }
    return r;
  };
  it('unpaid Sale adds Sales without Money In', async () => {
    await sale();
    const r = await readFinance(db as PrismaService, q);
    expect(r.summary.sales).toBe('100.00');
    expect(r.summary.moneyIn).toBe('0.00');
  });
  it('partial checkout counts once despite sale paid fields', async () => {
    await checkout();
    const r = await readFinance(db as PrismaService, q);
    expect(r.summary.sales).toBe('100.00');
    expect(r.summary.moneyIn).toBe('40.00');
    expect(r.items).toHaveLength(1);
  });
  it('later payment increases Money In without new Sales; paidAmount is never a source', async () => {
    const s = await checkout();
    await receipt([s.id]);
    await db.sale.update({ where: { id: s.id }, data: { paidAmount: 60 } });
    const r = await readFinance(db as PrismaService, q);
    expect(r.summary.sales).toBe('100.00');
    expect(r.summary.moneyIn).toBe('60.00');
    expect(r.summary.oldDue).toBe('20.00');
  });
  it('Opening Due payment is Money In and no Sales', async () => {
    await receipt([], true);
    const r = await readFinance(db as PrismaService, q);
    expect(r.summary.sales).toBe('0.00');
    expect(r.summary.moneyIn).toBe('20.00');
    expect(r.summary.oldDue).toBe('20.00');
  });
  it('receipt spanning two invoices and Opening Due counts once', async () => {
    const a = await sale(),
      b = await sale();
    const r = await db.customerPaymentReceipt.create({
      data: {
        receiptNumber: randomUUID(),
        customerId: customer,
        totalAmount: 30,
        method: 'CASH',
        paidAt: new Date(day),
        createdBy: owner,
        idempotencyKey: randomUUID(),
        requestHash: 'fixture',
        outstandingBefore: 300,
        outstandingAfter: 270,
      },
    });
    const o = await db.customerOpeningBalance.create({
      data: {
        customerId: customer,
        originalAmount: 100,
        balanceAsOf: new Date('2026-01-01'),
        createdBy: owner,
        idempotencyKey: randomUUID(),
        requestHash: 'fixture',
      },
    });
    await db.customerPaymentAllocation.createMany({
      data: [
        {
          receiptId: r.id,
          saleId: a.id,
          amount: 10,
          previousDue: 100,
          remainingDue: 90,
        },
        {
          receiptId: r.id,
          saleId: b.id,
          amount: 10,
          previousDue: 100,
          remainingDue: 90,
        },
        {
          receiptId: r.id,
          openingBalanceId: o.id,
          amount: 10,
          previousDue: 100,
          remainingDue: 90,
        },
      ],
    });
    const page = await readFinance(db as PrismaService, q);
    expect(page.summary.moneyIn).toBe('30.00');
    expect(page.summary.oldDue).toBe('30.00');
    expect(page.items).toHaveLength(1);
  });
  it('unclassified legacy money is included without guessing old due', async () => {
    const s = await sale();
    await db.payment.create({
      data: {
        customerId: customer,
        saleId: s.id,
        amount: 5,
        receivedAt: new Date(day),
      },
    });
    const p = await readFinance(db as PrismaService, q);
    expect(p.summary.moneyIn).toBe('5.00');
    expect(p.summary.oldDue).toBe('0.00');
    expect(p.items[0].type).toBe('LEGACY_PAYMENT');
  });
  it('proven legacy due fragments are summed without invented receipt identity', async () => {
    const a = await sale(),
      b = await sale();
    await db.payment.createMany({
      data: [a, b].map((s) => ({
        customerId: customer,
        saleId: s.id,
        amount: 3,
        receivedAt: new Date(day),
        cashbookType: 'DUE_PAYMENT',
      })),
    });
    const p = await readFinance(db as PrismaService, q);
    expect(p.summary.moneyIn).toBe('6.00');
    expect(p.summary.oldDue).toBe('6.00');
    expect(p.total).toBe(2);
  });
  it('voided Sale/Payment excluded', async () => {
    const s = await checkout();
    await db.sale.update({ where: { id: s.id }, data: { status: 'VOIDED' } });
    const p = await readFinance(db as PrismaService, q);
    expect(p.summary.moneyIn).toBe('0.00');
    expect(p.summary.sales).toBe('0.00');
  });
  it.each(['OTHER_IN', 'EXPENSE', 'SUPPLIER_PAYMENT', 'OTHER_OUT'] as const)(
    'manual %s preserves type and does not change Sales or stock',
    async (type) => {
      const e = await service.create(
        {
          ...base(),
          type,
          ...(type === 'EXPENSE' ? { expenseType: 'Transport' as const } : {}),
          ...(type === 'SUPPLIER_PAYMENT' ? { supplierId: supplier } : {}),
        },
        owner,
      );
      expect(e.type).toBe(type);
      const p = await readFinance(db as PrismaService, q);
      expect(p.summary.sales).toBe('0.00');
      expect(p.summary[type === 'OTHER_IN' ? 'moneyIn' : 'moneyOut']).toBe(
        '10.00',
      );
      expect(await db.stockMovement.count()).toBe(0);
    },
  );
  it('complete summary and Decimal precision', async () => {
    await checkout();
    const s = await sale(50);
    await receipt([s.id]);
    await service.create({ ...base(), amount: 0.1 }, owner);
    await service.create({ ...base(), amount: 0.2 }, owner);
    await service.create(
      { ...base(), type: 'EXPENSE', expenseType: 'Food', amount: 8 },
      owner,
    );
    await service.create(
      { ...base(), type: 'SUPPLIER_PAYMENT', supplierId: supplier, amount: 25 },
      owner,
    );
    await service.create({ ...base(), type: 'OTHER_OUT', amount: 2 }, owner);
    const p = await readFinance(db as PrismaService, q);
    expect(p.summary).toMatchObject({
      sales: '150.00',
      moneyIn: '60.30',
      moneyOut: '35.00',
      netMoney: '25.30',
      oldDue: '20.00',
    });
    expect(p.summary.byType).toMatchObject({
      SALE_PAYMENT: '40.00',
      DUE_PAYMENT: '20.00',
      OTHER_IN: '0.30',
      EXPENSE: '8.00',
      SUPPLIER_PAYMENT: '25.00',
      OTHER_OUT: '2.00',
    });
  });
  it('void preserves entry, actor, reason, audit and removes active total', async () => {
    const e = await service.create(
      { ...base(), type: 'EXPENSE', expenseType: 'Rent' },
      owner,
    );
    await service.void(e.id, 'Wrong amount', owner);
    const detail = await service.detail(e.id);
    expect(detail.voidReason).toBe('Wrong amount');
    expect(detail.voiderName).toBe('Owner');
    expect((await readFinance(db as PrismaService, q)).summary.moneyOut).toBe(
      '0.00',
    );
    expect(await db.auditLog.count({ where: { entityId: e.id } })).toBe(2);
    await expect(service.void(e.id, 'Again', owner)).rejects.toThrow(
      'already been voided',
    );
  });
  it('concurrent void writes one audit', async () => {
    const e = await service.create(base(), owner);
    const results = await Promise.allSettled([
      service.void(e.id, 'Mistake', owner),
      service.void(e.id, 'Mistake', owner),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      await db.auditLog.count({ where: { action: 'FINANCIAL_ENTRY_VOIDED' } }),
    ).toBe(1);
  });
  it('idempotent exact retry and concurrent creates have one audit', async () => {
    const input = base();
    const all = await Promise.all(
      Array.from({ length: 5 }, () => service.create(input, owner)),
    );
    expect(new Set(all.map((e) => e.id)).size).toBe(1);
    expect(await db.financialEntry.count()).toBe(1);
    expect(await db.auditLog.count()).toBe(1);
  });
  it('changed payload or actor cannot reuse another key', async () => {
    const input = base();
    await service.create(input, owner);
    await expect(
      service.create({ ...input, amount: 12 }, owner),
    ).rejects.toThrow('different details');
    await expect(service.create(input, staff)).rejects.toThrow(
      'different details',
    );
  });
  it('supplier links validate supplier and purchase/container pair', async () => {
    const c = await db.container.create({
      data: {
        containerNumber: 'C1',
        normalizedContainerNumber: 'C1',
        supplierId: supplier,
      },
    });
    const p = await db.purchase.create({
      data: { purchaseNumber: 'P1', supplierId: supplier, containerId: c.id },
    });
    const input = {
      ...base(),
      type: 'SUPPLIER_PAYMENT' as const,
      supplierId: supplier,
      purchaseId: p.id,
      containerId: c.id,
    };
    expect((await service.create(input, owner)).supplierId).toBe(supplier);
    await expect(
      service.create(
        { ...input, idempotencyKey: randomUUID(), supplierId: otherSupplier },
        owner,
      ),
    ).rejects.toThrow('does not match');
    expect(
      (
        await db.purchase.findUniqueOrThrow({ where: { id: p.id } })
      ).paidAmount.toString(),
    ).toBe('0');
  });
  it('bad supplier and container IDs rejected', async () => {
    await expect(
      service.create(
        { ...base(), type: 'SUPPLIER_PAYMENT', supplierId: 'missing' },
        owner,
      ),
    ).rejects.toThrow('active supplier');
    await expect(
      service.create(
        {
          ...base(),
          type: 'SUPPLIER_PAYMENT',
          supplierId: supplier,
          containerId: 'missing',
        },
        owner,
      ),
    ).rejects.toThrow('does not match');
  });
  it('voided history stays readable but contributes nothing to totals', async () => {
    const e = await service.create(
      { ...base(), type: 'EXPENSE', expenseType: 'Food' },
      owner,
    );
    await service.void(e.id, 'Wrong entry', owner);
    const all = await readFinance(db as PrismaService, { ...q, status: 'all' });
    expect(all.items).toHaveLength(1);
    expect(all.items[0].voidedAt).not.toBeNull();
    expect(all.summary.moneyOut).toBe('0.00');
    expect(
      (await readFinance(db as PrismaService, { ...q, status: 'voided' }))
        .items,
    ).toHaveLength(1);
  });
  it('Money In section is filtered on the server', async () => {
    await checkout();
    await service.create(
      { ...base(), type: 'EXPENSE', expenseType: 'Transport' },
      owner,
    );
    const p = await readFinance(db as PrismaService, { ...q, direction: 'IN' });
    expect(p.items).toHaveLength(1);
    expect(p.summary.moneyIn).toBe('40.00');
    expect(p.summary.moneyOut).toBe('0.00');
  });
  it('migration classifies only posting evidence and never changes money', async () => {
    let initialId = '',
      dueId = '';
    const s = await db.$transaction(async (tx) => {
      const invoice = await tx.sale.create({
        data: {
          invoiceNumber: 'CHECKOUT-EVIDENCE',
          customerId: customer,
          status: 'COMPLETED',
          soldAt: new Date(day),
          receivedAmount: 40,
          paidAmount: 40,
          totalAmount: 100,
        },
      });
      const pay = await tx.payment.create({
        data: {
          saleId: invoice.id,
          customerId: customer,
          amount: 40,
          receivedAt: new Date(day),
        },
      });
      initialId = pay.id;
      await tx.auditLog.create({
        data: {
          action: 'SALE_CREATED',
          entityType: 'Sale',
          entityId: invoice.id,
          userId: owner,
        },
      });
      return invoice;
    });
    await db.$transaction(async (tx) => {
      const stamp = new Date('2026-10-08T10:00:00Z');
      const pay = await tx.payment.create({
        data: {
          saleId: s.id,
          customerId: customer,
          amount: 20,
          createdAt: stamp,
          receivedAt: new Date(day),
        },
      });
      dueId = pay.id;
      await tx.auditLog.create({
        data: {
          action: 'PAYMENT_RECEIVED',
          entityType: 'Customer',
          entityId: customer,
          userId: owner,
          createdAt: stamp,
        },
      });
    });
    const unknown = await db.payment.create({
      data: {
        saleId: s.id,
        customerId: customer,
        amount: 5,
        receivedAt: new Date(day),
      },
    });
    const script = readFileSync(
      new URL(
        '../../prisma/migrations/20261007060000_cashbook/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const updates = script
      .slice(
        script.indexOf('UPDATE "Payment"'),
        script.indexOf('ALTER TABLE "Payment" ADD CONSTRAINT'),
      )
      .split(';')
      .filter((v) => v.trim());
    for (const sql of updates) await db.$executeRawUnsafe(sql);
    await db.$executeRawUnsafe(
      readFileSync(
        new URL(
          '../../prisma/migrations/20261008043000_cashbook_checkout_evidence/migration.sql',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    const pays = await db.payment.findMany();
    expect(pays.find((p) => p.id === initialId)?.cashbookType).toBe(
      'SALE_PAYMENT',
    );
    expect(pays.find((p) => p.id === dueId)?.cashbookType).toBe('DUE_PAYMENT');
    expect(pays.find((p) => p.id === unknown.id)?.cashbookType).toBeNull();
    expect(pays.reduce((sum, p) => sum + Number(p.amount), 0)).toBe(65);
  });
  it('pagination stable and summary covers all rows', async () => {
    await Promise.all(
      Array.from({ length: 30 }, () => service.create(base(), owner)),
    );
    const a = await readFinance(db as PrismaService, { ...q, pageSize: 25 }),
      b = await readFinance(db as PrismaService, {
        ...q,
        page: 2,
        pageSize: 25,
      });
    expect(a.total).toBe(30);
    expect(a.items).toHaveLength(25);
    expect(b.items).toHaveLength(5);
    expect(a.summary.moneyIn).toBe('300.00');
    expect(b.summary.moneyIn).toBe('300.00');
    expect(new Set([...a.items, ...b.items].map((r) => r.id)).size).toBe(30);
    expect(
      (
        await readFinance(db as PrismaService, { ...q, pageSize: 25 })
      ).items.map((r) => r.id),
    ).toEqual(a.items.map((r) => r.id));
  });
  it('filters method/type/search (including invoice and receipt)', async () => {
    const s = await checkout();
    const r = await receipt([s.id]);
    await service.create(
      {
        ...base(),
        reference: 'Owner deposit',
        note: 'Opening float',
        method: 'BANK',
      },
      owner,
    );
    expect(
      (
        await readFinance(db as PrismaService, {
          ...q,
          type: 'OTHER_IN',
          method: 'BANK',
          search: 'float',
        })
      ).summary.moneyIn,
    ).toBe('10.00');
    expect(
      (
        await readFinance(db as PrismaService, {
          ...q,
          search: s.invoiceNumber,
        })
      ).items,
    ).toHaveLength(2);
    expect(
      (
        await readFinance(db as PrismaService, {
          ...q,
          search: r.receiptNumber,
        })
      ).items,
    ).toHaveLength(1);
    expect(
      (
        await readFinance(db as PrismaService, {
          ...q,
          search: "%' OR true --",
        })
      ).items,
    ).toHaveLength(0);
  });
  it('shows the newest recorded receipt before noon entries and checkout payments across server pages', async () => {
    const entry = await service.create(
      { ...base(), type: 'OTHER_OUT', occurredAt: '2026-10-08T12:00:00+06:00' },
      owner,
    );
    const payment = await db.payment.create({
      data: {
        customerId: customer,
        amount: 10,
        receivedAt: new Date('2026-10-08T10:00:00+06:00'),
        createdAt: new Date('2026-10-08T04:30:00Z'),
        cashbookType: 'SALE_PAYMENT',
      },
    });
    const r = await receipt([]);
    await db.financialEntry.update({
      where: { id: entry.id },
      data: { createdAt: new Date('2026-10-08T04:00:00Z') },
    });
    await db.customerPaymentReceipt.update({
      where: { id: r.id },
      data: {
        paidAt: new Date('2026-10-08T00:00:00+06:00'),
        createdAt: new Date('2026-10-08T04:51:00Z'),
      },
    });
    const all = await readFinance(db as PrismaService, {});
    expect(all.items.map((item) => item.id)).toEqual([
      `receipt:${r.id}`,
      `payment:${payment.id}`,
      `entry:${entry.id}`,
    ]);
    expect(all.items[0].occurredAt).toBe('2026-10-07T18:00:00.000Z');
    const first = await readFinance(db as PrismaService, { pageSize: 1 });
    const second = await readFinance(db as PrismaService, {
      pageSize: 1,
      page: 2,
    });
    expect(first.items[0].id).toBe(`receipt:${r.id}`);
    expect(second.items[0].id).toBe(`payment:${payment.id}`);
    expect(first.summary).toEqual(all.summary);
  });
  it('date filters include full Bangladesh days', async () => {
    await service.create(
      { ...base(), occurredAt: '2026-10-06T18:00:00Z' },
      owner,
    );
    await service.create(
      { ...base(), occurredAt: '2026-10-07T17:59:59.999Z' },
      owner,
    );
    await service.create(
      { ...base(), occurredAt: '2026-10-07T18:00:00Z' },
      owner,
    );
    expect((await readFinance(db as PrismaService, q)).summary.moneyIn).toBe(
      '20.00',
    );
    expect(
      (
        await readFinance(db as PrismaService, {
          date: 'range',
          from: '2026-10-07',
          to: '2026-10-08',
        })
      ).summary.moneyIn,
    ).toBe('30.00');
  });
  it.each([0, -1, NaN, Infinity, 1.001, 1000000000000])(
    'rejects tampered amount %s',
    (amount) => expect(() => financeInput({ ...base(), amount })).toThrow(),
  );
  it('rejects manual system categories and invalid enum/category', () => {
    expect(() =>
      financeInput({
        ...base(),
        type: 'SALE_PAYMENT',
      } as unknown as CreateFinanceEntry),
    ).toThrow();
    expect(() =>
      financeInput({
        ...base(),
        method: 'INVALID',
      } as unknown as CreateFinanceEntry),
    ).toThrow();
    expect(() =>
      financeInput({
        ...base(),
        type: 'EXPENSE',
        expenseType: 'Invalid',
      } as unknown as CreateFinanceEntry),
    ).toThrow();
    expect(() =>
      financeInput({ ...base(), type: 'EXPENSE', expenseType: 'Other' }),
    ).toThrow('Note');
  });
  const auth = (role: 'OWNER' | 'STAFF') =>
    jwt.sign({ id: role === 'OWNER' ? owner : staff, role });
  it('unauthenticated read/create/void rejected', async () => {
    expect((await request(app.getHttpServer()).get('/finance')).status).toBe(
      401,
    );
    expect(
      (await request(app.getHttpServer()).post('/finance/entries').send(base()))
        .status,
    ).toBe(401);
    expect(
      (
        await request(app.getHttpServer())
          .post('/finance/entries/no/void')
          .send({ reason: 'bad' })
      ).status,
    ).toBe(401);
  });
  it('staff view but cannot create or void', async () => {
    const token = auth('STAFF');
    expect(
      (
        await request(app.getHttpServer())
          .get('/finance')
          .set('Authorization', `Bearer ${token}`)
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app.getHttpServer())
          .post('/finance/entries')
          .set('Authorization', `Bearer ${token}`)
          .set('X-Afia-Finance', '1')
          .send(base())
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app.getHttpServer())
          .post('/finance/entries/no/void')
          .set('Authorization', `Bearer ${token}`)
          .set('X-Afia-Finance', '1')
          .send({ reason: 'bad' })
      ).status,
    ).toBe(403);
  });
  it('write header and cookie origin checks', async () => {
    const token = auth('OWNER');
    expect(
      (
        await request(app.getHttpServer())
          .post('/finance/entries')
          .set('Authorization', `Bearer ${token}`)
          .send(base())
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app.getHttpServer())
          .post('/finance/entries')
          .set('Cookie', `afia_session=${token}`)
          .set('X-Afia-Finance', '1')
          .set('Origin', 'https://evil.example')
          .send(base())
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app.getHttpServer())
          .post('/finance/entries')
          .set('Cookie', `afia_session=${token}`)
          .set('X-Afia-Finance', '1')
          .set('Origin', 'http://localhost:5174')
          .send(base())
      ).status,
    ).toBe(201);
  });
  it('DTO blocks mass assignment and oversized pages', async () => {
    expect(
      (
        await request(app.getHttpServer())
          .post('/finance/entries')
          .set('Authorization', `Bearer ${auth('OWNER')}`)
          .set('X-Afia-Finance', '1')
          .send({ ...base(), createdBy: staff, direction: 'OUT' })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app.getHttpServer())
          .get('/finance?pageSize=101')
          .set('Authorization', `Bearer ${auth('OWNER')}`)
      ).status,
    ).toBe(400);
  });
  it('inactive user cannot view even with valid JWT', async () => {
    await db.user.update({ where: { id: staff }, data: { isActive: false } });
    expect(
      (
        await request(app.getHttpServer())
          .get('/finance')
          .set('Authorization', `Bearer ${auth('STAFF')}`)
      ).status,
    ).toBe(401);
    await db.user.update({ where: { id: staff }, data: { isActive: true } });
  });
  it('DB errors are not exposed', async () => {
    await expect(service.create(base(), 'missing-user')).rejects.toThrow(
      'Payment could not be saved. Please try again.',
    );
  });
  it('missing entry and empty void reason rejected', async () => {
    await expect(service.detail('missing')).rejects.toThrow('not found');
    await expect(service.void('missing', 'Reason', owner)).rejects.toThrow(
      'not found',
    );
    await expect(service.void('missing', ' ', owner)).rejects.toThrow('reason');
  });
});
describe('Cashbook Bangladesh date boundaries', () => {
  const now = new Date('2026-10-06T18:30:00Z');
  it.each([
    ['today', '2026-10-06T18:00:00.000Z', '2026-10-07T18:00:00.000Z'],
    ['yesterday', '2026-10-05T18:00:00.000Z', '2026-10-06T18:00:00.000Z'],
    ['week', '2026-10-04T18:00:00.000Z', '2026-10-11T18:00:00.000Z'],
    ['month', '2026-09-30T18:00:00.000Z', '2026-10-31T18:00:00.000Z'],
  ] as const)('%s uses Dhaka', (date, from, until) => {
    const r = ledgerDateRange({ date }, now)!;
    expect(r.from.toISOString()).toBe(from);
    expect(r.until.toISOString()).toBe(until);
  });
  it('invalid dates and reversed ranges rejected', () => {
    expect(() =>
      ledgerDateRange({ date: 'specific', from: '2026-02-30' }, now),
    ).toThrow();
    expect(() =>
      ledgerDateRange(
        { date: 'range', from: '2026-10-08', to: '2026-10-07' },
        now,
      ),
    ).toThrow();
  });
});
