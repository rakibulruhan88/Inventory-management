import { expandPermissions } from '@afia/contracts';
import { InventoryService } from '../inventory/inventory.service.js';
import { PaymentsController } from './payments.controller.js';
import { readCustomersWithDue, readGlobalReceipts } from './payments-ledger.js';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ReceivePaymentRequest } from '@afia/contracts';
import { CustomersService } from './customers.service.js';
import { SalesService } from '../sales/sales.service.js';
import { CustomersController } from './customers.controller.js';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from '../auth/auth.guard.js';
import request from 'supertest';

describe('customer payment receipt PostgreSQL accounting and security', () => {
  const schema = `receipts_${randomUUID().replaceAll('-', '')}`;
  const url =
    process.env.DATABASE_URL ??
    'postgresql://afia:afia_local_password@localhost:5433/afia_inventory';
  const admin = new Pool({ connectionString: url });
  let db: PrismaClient,
    customers: CustomersService,
    sales: SalesService,
    app: INestApplication;
  let customerId: string, actorId: string;
  const migrations = new URL('../../prisma/migrations/', import.meta.url);
  beforeAll(async () => {
    const connection = await admin.connect();
    try {
      await connection.query(`CREATE SCHEMA "${schema}"`);
      await connection.query(`SET search_path TO "${schema}"`);
      // Apply the real migration chain in isolation, including real FKs/checks/sequence.
      for (const folder of readdirSync(migrations).sort()) {
        if (folder.endsWith('.toml')) continue;
        await connection.query(
          readFileSync(new URL(`${folder}/migration.sql`, migrations), 'utf8'),
        );
      }
    } finally {
      connection.release();
    }
    const scoped = new URL(url);
    scoped.searchParams.set('options', `-c search_path=${schema}`);
    db = new PrismaClient({
      adapter: new PrismaPg(scoped.toString(), { schema }),
    });
    customers = new CustomersService(db as PrismaService);
    sales = new SalesService(db as PrismaService);
    const module = await Test.createTestingModule({
      controllers: [CustomersController, PaymentsController],
      providers: [
        { provide: PrismaService, useValue: db },
        { provide: CustomersService, useValue: customers },
        { provide: APP_GUARD, useClass: AuthGuard },
        {
          provide: JwtService,
          useValue: {
            verifyAsync: async (token: string) => {
              if (token !== 'valid') throw new Error('invalid');
              return { id: actorId, role: 'STAFF' };
            },
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  }, 30000);
  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  });
  beforeEach(async () => {
    await db.$executeRawUnsafe(
      `TRUNCATE "Customer", "User", "Supplier", "Product", "Container", "StoreSettings" CASCADE`,
    );
    customerId = (
      await db.customer.create({
        data: {
          name: 'Sattar',
          phone: '01311111111',
          normalizedPhone: '8801311111111',
        },
      })
    ).id;
    actorId = (
      await db.user.create({
        data: { name: 'Staff', username: randomUUID(), passwordHash: 'test', permissions: expandPermissions(['payments.receive', 'payments.opening', 'sales.view']) },
      })
    ).id;
  });
  const invoice = (
    totalAmount = 5000,
    paidAmount = 0,
    soldAt = '2026-10-01T00:00:00Z',
    status: 'COMPLETED' | 'VOIDED' = 'COMPLETED',
    owner = customerId,
    id: string = randomUUID(),
  ) =>
    db.sale.create({
      data: {
        id,
        customerId: owner,
        invoiceNumber: `AF-${randomUUID()}`,
        totalAmount,
        paidAmount,
        soldAt: new Date(soldAt),
        status,
      },
    });
  const input = (
    amount = 6000,
    expectedOutstanding = 8000,
    extra: Partial<ReceivePaymentRequest> = {},
  ): ReceivePaymentRequest => ({
    amount,
    expectedOutstanding,
    method: 'CASH',
    paidAt: '2026-10-07T00:00:00+06:00',
    allocationMode: 'AUTO',
    idempotencyKey: randomUUID(),
    ...extra,
  });
  const receive = (p: ReceivePaymentRequest, id = customerId) =>
    customers.receivePayment(id, p, actorId);
  const account = () =>
    customers.account(customerId, { page: 1, pageSize: 25 });
  it.each([
    [3000, 2000],
    [5000, 0],
    [0.3, 4999.7],
  ])('allocates a one-invoice payment of %s exactly', async (amount, due) => {
    const sale = await invoice();
    const r = await receive(input(amount, 5000));
    expect(r.allocations).toHaveLength(1);
    expect(r.allocations[0]).toMatchObject({
      saleId: sale.id,
      amount,
      previousDue: 5000,
      remainingDue: due,
    });
    expect(await sales.details(sale.id)).toMatchObject({
      totalAmount: 5000,
      paidAmount: amount,
      dueAmount: due,
    });
  });
  it('creates ONE receipt, splits over oldest invoices, and preserves totals and all balances', async () => {
    const a = await invoice(),
      b = await invoice(3000, 0, '2026-10-02');
    const r = await receive(input());
    expect(r).toMatchObject({
      totalAmount: 6000,
      outstandingBefore: 8000,
      outstandingAfter: 2000,
    });
    expect(r.allocations.map((a) => a.amount).sort((a, b) => a - b)).toEqual([
      1000, 5000,
    ]);
    expect(await db.customerPaymentReceipt.count()).toBe(1);
    expect(await db.customerPaymentAllocation.count()).toBe(2);
    expect(await db.payment.count()).toBe(0);
    expect(await db.sale.count()).toBe(2);
    expect(await account()).toMatchObject({
      totalSales: 8000,
      totalPaid: 6000,
      totalDue: 2000,
      payments: { total: 1 },
    });
    expect((await sales.details(a.id)).dueAmount).toBe(0);
    expect((await sales.details(b.id)).dueAmount).toBe(2000);
    expect((await sales.details(b.id)).payments[0]).toMatchObject({
      amount: 1000,
      receiptNumber: r.receiptNumber,
      receiptId: r.id,
    });
  });
  it('settles all invoices exactly', async () => {
    await invoice();
    await invoice(3000);
    const r = await receive(input(8000));
    expect(r.outstandingAfter).toBe(0);
    expect((await account()).outstandingInvoices.total).toBe(0);
  });
  it('uses soldAt, createdAt and id as deterministic oldest-first tie breakers', async () => {
    const b = await invoice(100, 0, '2026-10-02', 'COMPLETED', customerId, 'b');
    const a = await invoice(100, 0, '2026-10-02', 'COMPLETED', customerId, 'a');
    const old = await invoice(
      100,
      0,
      '2026-10-01',
      'COMPLETED',
      customerId,
      'z',
    );
    await db.sale.updateMany({
      where: { id: { in: [a.id, b.id] } },
      data: { createdAt: new Date('2026-10-02') },
    });
    const r = await receive(input(150, 300));
    expect(r.allocations.find((x) => x.saleId === old.id)?.amount).toBe(100);
    expect(r.allocations.find((x) => x.saleId === a.id)?.amount).toBe(50);
    expect(r.allocations.some((x) => x.saleId === b.id)).toBe(false);
  });
  it('accepts a manual split that intentionally skips the oldest invoice', async () => {
    const a = await invoice(),
      b = await invoice(3000);
    const r = await receive(
      input(2000, 8000, {
        allocationMode: 'MANUAL',
        allocations: [
          { saleId: a.id, amount: 500, expectedDue: 5000 },
          { saleId: b.id, amount: 1500, expectedDue: 3000 },
        ],
      }),
    );
    expect(r.allocations.map((a) => a.amount).sort((a, b) => a - b)).toEqual([
      500, 1500,
    ]);
    expect((await account()).totalDue).toBe(6000);
  });
  it.each([499, 501])(
    'rejects manual sum %s for a 500 receipt',
    async (amount) => {
      const s = await invoice();
      await expect(
        receive(
          input(500, 5000, {
            allocationMode: 'MANUAL',
            allocations: [{ saleId: s.id, amount, expectedDue: 5000 }],
          }),
        ),
      ).rejects.toThrow('Pay Now total');
      expect(await db.customerPaymentReceipt.count()).toBe(0);
    },
  );
  it('rejects allocation above due even if total fits the customer balance', async () => {
    const s = await invoice(100);
    await invoice(1000);
    await expect(
      receive(
        input(500, 1100, {
          allocationMode: 'MANUAL',
          allocations: [{ saleId: s.id, amount: 500, expectedDue: 100 }],
        }),
      ),
    ).rejects.toThrow('cannot be more than the due');
  });
  it.each(['VOIDED', 'FOREIGN', 'MISSING', 'SETTLED'] as const)(
    'rejects ineligible %s manual invoices',
    async (kind) => {
      await invoice();
      const other = await db.customer.create({ data: { name: 'Other' } });
      const s =
        kind === 'MISSING'
          ? { id: 'missing' }
          : await invoice(
              500,
              kind === 'SETTLED' ? 500 : 0,
              '2026-10-01',
              kind === 'VOIDED' ? 'VOIDED' : 'COMPLETED',
              kind === 'FOREIGN' ? other.id : customerId,
            );
      const outstanding = (await customers.paymentContext(customerId))
        .outstanding;
      await expect(
        receive(
          input(100, outstanding, {
            allocationMode: 'MANUAL',
            allocations: [{ saleId: s.id, amount: 100, expectedDue: 500 }],
          }),
        ),
      ).rejects.toThrow('This due changed');
    },
  );
  it('rejects duplicate invoice rows', async () => {
    const s = await invoice();
    const row = { saleId: s.id, amount: 100, expectedDue: 5000 };
    await expect(
      receive(
        input(200, 5000, { allocationMode: 'MANUAL', allocations: [row, row] }),
      ),
    ).rejects.toThrow('only once');
  });
  it.each([0, -1, 5000.01, NaN, Infinity, 1.001])(
    'rejects invalid or overpaid amount %s',
    async (amount) => {
      await invoice();
      await expect(receive(input(amount, 5000))).rejects.toThrow();
      expect(await db.customerPaymentReceipt.count()).toBe(0);
    },
  );
  it('rejects no outstanding and missing customers', async () => {
    await expect(receive(input(1, 0))).rejects.toThrow('no due to pay');
    await expect(receive(input(1, 0), 'missing')).rejects.toThrow(
      'Customer not found',
    );
  });
  it('preserves prior paid money when increasing paidAmount', async () => {
    const s = await invoice(10000, 4000);
    await receive(input(3000, 6000));
    expect(await sales.details(s.id)).toMatchObject({
      totalAmount: 10000,
      paidAmount: 7000,
      dueAmount: 3000,
    });
  });
  it('makes simultaneous identical submissions idempotent and records one audit', async () => {
    await invoice();
    const p = input(1000, 5000);
    const [a, b] = await Promise.all([receive(p), receive(p)]);
    expect(a.id).toBe(b.id);
    expect(await db.customerPaymentReceipt.count()).toBe(1);
    expect(await db.auditLog.count()).toBe(1);
    expect((await account()).totalDue).toBe(4000);
    expect(await receive(p)).toMatchObject({ id: a.id });
  });
  it('rejects key reuse with changed payload or actor', async () => {
    await invoice();
    const p = input(1000, 5000);
    await receive(p);
    await expect(receive({ ...p, amount: 2000 })).rejects.toThrow(
      'different details',
    );
    const actor = await db.user.create({
      data: { name: 'Other', passwordHash: 'test' },
    });
    await expect(
      customers.receivePayment(customerId, p, actor.id),
    ).rejects.toThrow('different details');
  });
  it('serializes simultaneous payments and rejects stale balances without overpayment', async () => {
    await invoice();
    const results = await Promise.allSettled([
      receive(input(4000, 5000)),
      receive(input(4000, 5000)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await account()).totalDue).toBe(1000);
    expect(await db.customerPaymentReceipt.count()).toBe(1);
  });
  it('rejects stale invoice due even when account total matches', async () => {
    const s = await invoice();
    await expect(
      receive(
        input(1000, 5000, {
          allocationMode: 'MANUAL',
          allocations: [{ saleId: s.id, amount: 1000, expectedDue: 4999 }],
        }),
      ),
    ).rejects.toThrow('This due changed');
  });
  it('rejects stale automatic account totals', async () => {
    await invoice();
    await expect(receive(input(1000, 4999))).rejects.toThrow(
      'account balance changed',
    );
  });
  it('generates unique human-readable receipt numbers concurrently across customers', async () => {
    const other = await db.customer.create({ data: { name: 'Other' } });
    await invoice();
    await invoice(5000, 0, '2026-10-01', 'COMPLETED', other.id);
    const receipts = await Promise.all([
      receive(input(100, 5000)),
      receive(input(100, 5000), other.id),
    ]);
    expect(new Set(receipts.map((r) => r.receiptNumber)).size).toBe(2);
    for (const r of receipts)
      expect(r.receiptNumber).toMatch(/^PAY-\d{8}-\d{6,}$/);
  });
  it('rolls back receipt, allocations, balances and audit after a forced audit failure', async () => {
    await invoice();
    await invoice(3000);
    await admin.query(
      `CREATE FUNCTION "${schema}".fail_payment_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason = 'FORCED_FAILURE' THEN RAISE EXCEPTION 'private database failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_payment_audit BEFORE INSERT ON "${schema}"."AuditLog" FOR EACH ROW EXECUTE FUNCTION "${schema}".fail_payment_audit()`,
    );
    try {
      await expect(
        receive(input(6000, 8000, { notes: 'FORCED_FAILURE' })),
      ).rejects.toThrow('Payment could not be saved');
      expect(await db.customerPaymentReceipt.count()).toBe(0);
      expect(await db.customerPaymentAllocation.count()).toBe(0);
      expect(await db.auditLog.count()).toBe(0);
      expect((await account()).totalPaid).toBe(0);
    } finally {
      await admin.query(
        `DROP TRIGGER fail_payment_audit ON "${schema}"."AuditLog"; DROP FUNCTION "${schema}".fail_payment_audit()`,
      );
    }
  });
  it('preserves legacy payment rows and displays receipts without duplicate split payment records', async () => {
    const s = await invoice(5000, 100);
    const legacy = await db.payment.create({
      data: { customerId, saleId: s.id, amount: 100, method: 'BANK' },
    });
    const r = await receive(input(1000, 4900));
    const history = (await account()).payments;
    expect((await customers.details(customerId)).payments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ receiptId: r.id }),
        expect.objectContaining({ id: legacy.id }),
      ]),
    );
    expect(history.total).toBe(2);
    expect(
      history.items.find((p) => p.id === legacy.id)?.receiptNumber,
    ).toBeUndefined();
    expect(history.items.find((p) => p.id === r.id)?.allocations).toHaveLength(
      1,
    );
    expect(await db.payment.count()).toBe(1);
    expect(
      (await sales.details(s.id)).previousOutstandingBeforeSale,
    ).toBeNull();
  });
  it('links history through customerId after a phone change, and scopes receipt reads to the routed customer', async () => {
    await invoice();
    const r = await receive(input(1000, 5000));
    await customers.update(customerId, {
      name: 'Sattar',
      phone: '01722222222',
    });
    expect(await customers.receipt(customerId, r.id)).toMatchObject({
      customerId,
      customerPhone: '01722222222',
    });
    const other = await db.customer.create({ data: { name: 'Other' } });
    await expect(customers.receipt(other.id, r.id)).rejects.toThrow(
      'not found',
    );
  });
  it('audits actor, receipt, customer, amount, affected invoices and payment time', async () => {
    const s = await invoice();
    const r = await receive(input(1000, 5000));
    expect(await db.auditLog.findFirst()).toMatchObject({
      action: 'CUSTOMER_PAYMENT_RECEIVED',
      userId: actorId,
      entityId: r.id,
      metadata: {
        customerId,
        receiptId: r.id,
        totalAmount: '1000.00',
        saleIds: [s.id],
        paidAt: '2026-10-06T18:00:00.000Z',
      },
    });
  });
  it('blocks void after receipt allocation without touching history, balance or stock', async () => {
    const s = await invoice();
    const r = await receive(input(1000, 5000));
    await expect(sales.void(s.id, 'Wrong invoice')).rejects.toThrow(
      'cannot be voided',
    );
    expect((await sales.details(s.id)).status).toBe('COMPLETED');
    expect(await customers.receipt(customerId, r.id)).toMatchObject({
      totalAmount: 1000,
    });
    expect((await account()).totalDue).toBe(4000);
  });
  it('payment-versus-void race leaves a consistent account and preserves receipt history', async () => {
    const s = await invoice();
    const results = await Promise.allSettled([
      receive(input(1000, 5000)),
      sales.void(s.id, 'Concurrent void'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const current = await db.sale.findUniqueOrThrow({ where: { id: s.id } });
    const receipts = await db.customerPaymentReceipt.count();
    expect(
      current.status === 'VOIDED'
        ? receipts === 0
        : receipts === 1 && Number(current.paidAmount) === 1000,
    ).toBe(true);
  });
  it('snapshot records previous debt and new sale due without changing invoice total, and stays historical after payment', async () => {
    await invoice(10000);
    const supplier = await db.supplier.create({ data: { name: 'Supplier' } });
    const container = await db.container.create({
      data: {
        containerNumber: 'C1',
        normalizedContainerNumber: 'C1',
        supplierId: supplier.id,
      },
    });
    const product = await db.product.create({
      data: { itemCode: 'P1', normalizedItemCode: 'P1' },
    });
    const variant = await db.productVariant.create({
      data: { productId: product.id, color: 'Black', variantKey: 'black' },
    });
    await db.inventoryBatch.create({
      data: {
        batchCode: 'B1',
        containerId: container.id,
        variantId: variant.id,
        originalRolls: 3,
        availableRolls: 3,
      },
    });
    const s = await sales.create({
      customerId,
      soldAt: new Date().toISOString(),
      discountAmount: 0,
      receivedAmount: 5000,
      lines: [{ variantId: variant.id, rollsSold: 1, unitPricePerRoll: 15000 }],
    });
    expect(await sales.details(s.id)).toMatchObject({
      totalAmount: 15000,
      paidAmount: 5000,
      dueAmount: 10000,
      previousOutstandingBeforeSale: 10000,
      outstandingAfterSale: 20000,
    });
    await receive(input(6000, 20000));
    expect(await sales.details(s.id)).toMatchObject({
      previousOutstandingBeforeSale: 10000,
      outstandingAfterSale: 20000,
    });
    await sales.void(s.id, 'Stock regression');
    expect(
      Number((await db.inventoryBatch.findFirstOrThrow()).availableRolls),
    ).toBe(3);
  });
  it('sales ledger filters discover receipt method, reference and receipt number', async () => {
    await invoice();
    const r = await receive(
      input(1000, 5000, { method: 'BANK', reference: 'TX-XYZ' }),
    );
    expect(await sales.list(r.receiptNumber)).toHaveLength(1);
    expect(await sales.list('TX-XYZ')).toHaveLength(1);
    for (const query of [
      { method: 'BANK' as const },
      { search: 'TX-XYZ' },
      { search: r.receiptNumber },
    ])
      expect((await sales.ledger(query)).items).toHaveLength(1);
  });
  it.each(['context', 'payment', 'receipt'] as const)(
    'protects %s endpoints against unauthenticated access',
    async (kind) => {
      const path = `/customers/${customerId}/${kind === 'context' ? 'payment-context' : kind === 'receipt' ? 'payment-receipts/missing' : 'payments'}`;
      const req =
        kind === 'payment'
          ? request(app.getHttpServer()).post(path).send(input(100, 100))
          : request(app.getHttpServer()).get(path);
      await req.expect(401);
      expect(await db.customerPaymentReceipt.count()).toBe(0);
    },
  );
  it.each([
    { amount: '100' },
    { amount: 1.001 },
    { amount: -1 },
    { amount: null },
    { customerId: 'other' },
    { createdBy: 'other' },
    { receiptNumber: 'PAY-1' },
    { allocationMode: 'INVALID' },
    { idempotencyKey: 'missing' },
    { paidAt: 'bad-date' },
    { reference: 'x'.repeat(201) },
    { expectedOutstanding: '5000' },
    {
      allocations: [{ saleId: 'x', amount: -1, expectedDue: 5000 }],
      allocationMode: 'MANUAL',
    },
  ])(
    'HTTP rejects tampering and malformed data %j without DTO metadata',
    async (extra) => {
      await invoice();
      const response = await request(app.getHttpServer())
        .post(`/customers/${customerId}/payments`)
        .set('Authorization', 'Bearer valid')
        .send({ ...input(100, 5000), ...extra });
      expect(response.status).toBe(400);
      expect(await db.customerPaymentReceipt.count()).toBe(0);
    },
  );
  it('requires a CSRF-resistant custom header for cookie-authenticated payment submissions', async () => {
    await invoice();
    await request(app.getHttpServer())
      .post(`/customers/${customerId}/payments`)
      .set('Cookie', 'afia_session=valid')
      .send(input(100, 5000))
      .expect(403);
    await request(app.getHttpServer())
      .post(`/customers/${customerId}/payments`)
      .set('Cookie', 'afia_session=valid')
      .set('X-Afia-Payment', 'receive-payment')
      .send(input(100, 5000))
      .expect(201);
    expect(await db.customerPaymentReceipt.count()).toBe(1);
  });
  it('preserves receipt allocation balance snapshots after later payments', async () => {
    await invoice();
    const first = await receive(
      input(1000, 5000, {
        method: 'OTHER',
        reference: 'External 001',
        notes: 'Old due',
      }),
    );
    await receive(input(2000, 4000));
    const saved = await customers.receipt(customerId, first.id);
    expect(saved).toMatchObject({
      method: 'OTHER',
      reference: 'External 001',
      notes: 'Old due',
      outstandingBefore: 5000,
      outstandingAfter: 4000,
    });
    expect(saved.allocations[0]).toMatchObject({
      previousDue: 5000,
      remainingDue: 4000,
      amount: 1000,
    });
    expect((await account()).totalDue).toBe(2000);
  });
  it('retains balance consistency when a Sale and payment are submitted simultaneously', async () => {
    await invoice(10000);
    const supplier = await db.supplier.create({ data: { name: 'Supplier' } });
    const container = await db.container.create({
      data: {
        containerNumber: 'C2',
        normalizedContainerNumber: 'C2',
        supplierId: supplier.id,
      },
    });
    const product = await db.product.create({
      data: { itemCode: 'P2', normalizedItemCode: 'P2' },
    });
    const variant = await db.productVariant.create({
      data: { productId: product.id, color: 'Green', variantKey: 'green' },
    });
    await db.inventoryBatch.create({
      data: {
        batchCode: 'B2',
        containerId: container.id,
        variantId: variant.id,
        originalRolls: 1,
        availableRolls: 1,
      },
    });
    const [payment, created] = await Promise.allSettled([
      receive(input(1000, 10000)),
      sales.create({
        customerId,
        soldAt: new Date().toISOString(),
        discountAmount: 0,
        receivedAmount: 0,
        lines: [
          { variantId: variant.id, rollsSold: 1, unitPricePerRoll: 5000 },
        ],
      }),
    ]);
    if (created.status === 'rejected') throw created.reason;
    expect(created.status).toBe('fulfilled');
    const sale = await sales.details(created.value.id);
    expect(sale).toMatchObject({
      totalAmount: 5000,
      previousOutstandingBeforeSale:
        payment.status === 'fulfilled' ? 9000 : 10000,
      outstandingAfterSale: payment.status === 'fulfilled' ? 14000 : 15000,
    });
    expect((await account()).totalDue).toBe(
      payment.status === 'fulfilled' ? 14000 : 15000,
    );
  });
  it('HTTP receives a staff payment and returns safe error text', async () => {
    await invoice();
    const p = input(100, 5000);
    const a = await request(app.getHttpServer())
      .post(`/customers/${customerId}/payments`)
      .set('Authorization', 'Bearer valid')
      .send(p)
      .expect(201);
    const b = await request(app.getHttpServer())
      .post(`/customers/${customerId}/payments`)
      .set('Authorization', 'Bearer valid')
      .send(p)
      .expect(201);
    expect(a.body.id).toBe(b.body.id);
    const error = await request(app.getHttpServer())
      .post(`/customers/${customerId}/payments`)
      .set('Authorization', 'Bearer valid')
      .send(input(5000, 4900))
      .expect(409);
    expect(JSON.stringify(error.body)).not.toMatch(
      /Prisma|SQL|constraint|SELECT/,
    );
  });
  describe('Opening Due and global Payments integration', () => {
    const openingInput = (amount = 25000, extra = {}) => ({
      amount,
      balanceAsOf: '2026-01-01',
      note: 'Before this system',
      idempotencyKey: randomUUID(),
      ...extra,
    });
    const oldDue = (amount = 25000, id = customerId, extra = {}) =>
      customers.addOpeningDue(id, openingInput(amount, extra), actorId);
    const dueList = (query = {}) =>
      readCustomersWithDue(db as PrismaService, query);
    const receipts = (query = {}) =>
      readGlobalReceipts(db as PrismaService, query);
    const auth = () => request(app.getHttpServer());
    it('creates an ordinary customer and opening event atomically with normalized identity', async () => {
      const p = {
        name: 'Karim Traders',
        phone: '+880 1712-345678',
        openingDue: openingInput(),
      };
      const result = await customers.createWithOpeningDue(p, actorId);
      expect(
        await db.customer.findUnique({ where: { id: result.customerId } }),
      ).toMatchObject({
        name: 'Karim Traders',
        normalizedPhone: '8801712345678',
      });
      expect(result.openingDue).toMatchObject({
        originalAmount: 25000,
        remainingDue: 25000,
        balanceAsOf: '2026-01-01',
        note: 'Before this system',
      });
      expect(await db.sale.count()).toBe(0);
      expect(await db.stockMovement.count()).toBe(0);
      expect(await customers.createWithOpeningDue(p, actorId)).toEqual(result);
      expect(await db.customer.count()).toBe(2);
      expect(await db.customerOpeningBalance.count()).toBe(1);
    });
    it('creates an audited existing-customer Opening Due without changing contacts', async () => {
      const before = await db.customer.findUniqueOrThrow({
        where: { id: customerId },
      });
      const result = await oldDue();
      expect(
        await db.customer.findUnique({ where: { id: customerId } }),
      ).toEqual(before);
      const event = await db.auditLog.findFirstOrThrow({
        where: { action: 'CUSTOMER_OPENING_BALANCE_CREATED' },
      });
      expect(event).toMatchObject({
        userId: actorId,
        entityId: result.openingDue.id,
        metadata: {
          actorId,
          customerId,
          openingBalanceId: result.openingDue.id,
          amount: '25000.00',
          balanceAsOf: '2026-01-01',
        },
      });
      expect(await account()).toMatchObject({
        totalSales: 0,
        totalPaid: 0,
        totalDue: 25000,
        openingDue: { originalAmount: 25000 },
      });
      expect(await customers.details(customerId)).toMatchObject({
        totalSales: 0,
        totalDue: 25000,
      });
      expect((await customers.list('Sattar'))[0].totalDue).toBe(25000);
    });
    it.each([0, -1, 1.001, NaN, Infinity, '25000'])(
      'rejects invalid Opening Due %s',
      async (amount) => {
        await expect(oldDue(amount as number)).rejects.toMatchObject({
          status: 400,
        });
        expect(await db.customerOpeningBalance.count()).toBe(0);
      },
    );
    it.each(['', '2026-02-30', 'invalid', '2026-01-01T00:00:00Z'])(
      'rejects invalid Balance Date %s',
      async (balanceAsOf) => {
        await expect(
          oldDue(25000, customerId, { balanceAsOf }),
        ).rejects.toMatchObject({ status: 400 });
      },
    );
    it('rejects duplicate opening even after full payment; preserves exact retries', async () => {
      const p = openingInput();
      const result = await customers.addOpeningDue(customerId, p, actorId);
      expect(await customers.addOpeningDue(customerId, p, actorId)).toEqual(
        result,
      );
      await expect(oldDue()).rejects.toThrow('already has an Opening Due');
      await receive(input(25000, 25000));
      await expect(oldDue()).rejects.toMatchObject({ status: 409 });
      expect(await db.customerOpeningBalance.count()).toBe(1);
    });
    it('concurrent opening creation saves one initial due and one audit', async () => {
      const result = await Promise.allSettled([oldDue(), oldDue()]);
      expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await db.customerOpeningBalance.count()).toBe(1);
      expect(
        await db.auditLog.count({
          where: { action: 'CUSTOMER_OPENING_BALANCE_CREATED' },
        }),
      ).toBe(1);
    });
    it('concurrent exact new-customer retries without a phone create one customer', async () => {
      const p = { name: 'No Phone', openingDue: openingInput() };
      const results = await Promise.all([
        customers.createWithOpeningDue(p, actorId),
        customers.createWithOpeningDue(p, actorId),
      ]);
      expect(results[0].customerId).toBe(results[1].customerId);
      expect(await db.customer.count({ where: { name: 'No Phone' } })).toBe(1);
    });
    it('new-customer duplicate phone resolves to the existing identity without orphan debt', async () => {
      await expect(
        customers.createWithOpeningDue(
          {
            name: 'Another name',
            phone: '+8801311111111',
            openingDue: openingInput(),
          },
          actorId,
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect(await db.customer.count()).toBe(1);
      expect(await db.customerOpeningBalance.count()).toBe(0);
    });
    it.each([10000, 25000, 0.3])(
      'opening-only payment %s preserves sales and one receipt',
      async (amount) => {
        const opening = await oldDue();
        const r = await receive(input(amount, 25000));
        expect(r.allocations).toEqual([
          expect.objectContaining({
            saleId: null,
            invoiceNumber: null,
            sourceKind: 'OPENING',
            openingBalanceId: opening.openingDue.id,
            amount,
            previousDue: 25000,
            remainingDue: 25000 - amount,
          }),
        ]);
        expect(await account()).toMatchObject({
          totalSales: 0,
          totalPaid: amount,
          totalDue: 25000 - amount,
          payments: { total: 1 },
        });
        expect(await db.sale.count()).toBe(0);
        expect(await db.payment.count()).toBe(0);
        expect(await db.customerPaymentReceipt.count()).toBe(1);
        expect(await sales.ledger({})).toMatchObject({ total: 0, items: [] });
        expect(
          await new InventoryService(db as PrismaService).summary(),
        ).toMatchObject({ todaySales: 0, totalCustomerDue: 25000 - amount });
      },
    );
    it('one mixed receipt pays old due and one invoice, with sale-only detail amounts', async () => {
      await oldDue(5000);
      const sale = await invoice(3000);
      const r = await receive(input(6000, 8000));
      expect(r.allocations).toHaveLength(2);
      expect(
        r.allocations.find((a) => a.sourceKind === 'OPENING'),
      ).toMatchObject({ amount: 5000, remainingDue: 0 });
      expect(r.allocations.find((a) => a.saleId === sale.id)).toMatchObject({
        amount: 1000,
        remainingDue: 2000,
      });
      expect(await account()).toMatchObject({
        totalSales: 3000,
        totalPaid: 6000,
        totalDue: 2000,
        payments: { total: 1 },
      });
      expect((await sales.details(sale.id)).payments).toEqual([
        expect.objectContaining({ amount: 1000, receiptId: r.id }),
      ]);
      expect((await customers.paymentContext(customerId)).sources).toEqual([
        expect.objectContaining({ sourceKind: 'SALE', dueAmount: 2000 }),
      ]);
      expect((await receipts()).items).toHaveLength(1);
      await expect(sales.void(sale.id, 'Test')).rejects.toMatchObject({
        status: 409,
      });
    });
    it('orders all dues by their actual date, including sale older than Opening Due', async () => {
      await oldDue(5000, customerId, { balanceAsOf: '2026-10-03' });
      const s = await invoice(3000, 0, '2026-10-01');
      const r = await receive(input(4000, 8000));
      expect(r.allocations.find((a) => a.saleId === s.id)?.amount).toBe(3000);
      expect(
        r.allocations.find((a) => a.sourceKind === 'OPENING')?.amount,
      ).toBe(1000);
    });
    it('Choose Invoices can skip old due or split between both types', async () => {
      const o = await oldDue(5000);
      const s = await invoice(3000);
      await receive(
        input(1000, 8000, {
          allocationMode: 'MANUAL',
          allocations: [{ saleId: s.id, amount: 1000, expectedDue: 3000 }],
        }),
      );
      const r = await receive(
        input(1500, 7000, {
          allocationMode: 'MANUAL',
          allocations: [
            {
              openingBalanceId: o.openingDue.id,
              amount: 1000,
              expectedDue: 5000,
            },
            { saleId: s.id, amount: 500, expectedDue: 2000 },
          ],
        }),
      );
      expect(r.allocations).toHaveLength(2);
      expect((await account()).totalDue).toBe(5500);
    });
    it.each([
      'foreign',
      'both',
      'none',
      'duplicate',
      'stale',
      'sum',
      'overdue',
    ])('rejects unsafe manual opening rows: %s', async (kind) => {
      const o = await oldDue(5000);
      const s = await invoice(3000);
      const row = {
        openingBalanceId: o.openingDue.id,
        amount: 1000,
        expectedDue: 5000,
      };
      const rows =
        kind === 'foreign'
          ? [{ ...row, openingBalanceId: 'other' }]
          : kind === 'both'
            ? [{ ...row, saleId: s.id }]
            : kind === 'none'
              ? [{ amount: 1000, expectedDue: 5000 }]
              : kind === 'duplicate'
                ? [
                    { ...row, amount: 500 },
                    { ...row, amount: 500 },
                  ]
                : kind === 'stale'
                  ? [{ ...row, expectedDue: 4999 }]
                  : kind === 'sum'
                    ? [{ ...row, amount: 999 }]
                    : [{ ...row, amount: 5001 }];
      await expect(
        receive(
          input(kind === 'overdue' ? 5001 : 1000, 8000, {
            allocationMode: 'MANUAL',
            allocations: rows,
          }),
        ),
      ).rejects.toBeDefined();
      expect(await db.customerPaymentReceipt.count()).toBe(0);
      expect((await account()).totalDue).toBe(8000);
    });
    it('rejects opening overpayment and a stale total', async () => {
      await oldDue(5000);
      await expect(receive(input(5001, 5000))).rejects.toThrow(
        'more than the total due',
      );
      await expect(receive(input(1000, 4000))).rejects.toMatchObject({
        status: 409,
      });
    });
    it('simultaneous opening payments do not overpay; stale request refreshes', async () => {
      await oldDue(5000);
      const result = await Promise.allSettled([
        receive(input(3000, 5000)),
        receive(input(3000, 5000)),
      ]);
      expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((await account()).totalDue).toBe(2000);
      expect(await db.customerPaymentReceipt.count()).toBe(1);
    });
    it('simultaneous duplicate opening payment returns one receipt and immutable snapshots', async () => {
      await oldDue(5000);
      const p = input(1000, 5000);
      const [a, b] = await Promise.all([receive(p), receive(p)]);
      expect(a.id).toBe(b.id);
      await receive(input(2000, 4000));
      expect(await customers.receipt(customerId, a.id)).toMatchObject({
        outstandingBefore: 5000,
        outstandingAfter: 4000,
        allocations: [
          expect.objectContaining({ previousDue: 5000, remainingDue: 4000 }),
        ],
      });
      expect(await db.customerPaymentReceipt.count()).toBe(2);
      expect((await account()).totalDue).toBe(2000);
    });
    it('Opening Due prevents archiving, and paid Opening Due is excluded from due customers', async () => {
      await oldDue(5000);
      await expect(customers.archive(customerId)).rejects.toMatchObject({
        status: 409,
      });
      await receive(input(5000, 5000));
      expect(await dueList()).toMatchObject({ total: 0, totalOutstanding: 0 });
      expect((await customers.paymentContext(customerId)).sources).toHaveLength(
        0,
      );
      await customers.archive(customerId);
    });
    it('global due list includes opening-only, mixed and sale-only customers with stable pages', async () => {
      await oldDue(5000);
      const c2 = await db.customer.create({ data: { name: 'Mixed' } }),
        c3 = await db.customer.create({ data: { name: 'Sales only' } });
      await oldDue(2000, c2.id);
      await invoice(1000, 0, '2026-10-01', 'COMPLETED', c2.id);
      await invoice(1000, 0, '2026-10-01', 'COMPLETED', c3.id);
      const first = await dueList({ page: 1, pageSize: 2 });
      const second = await dueList({ page: 2, pageSize: 2 });
      expect(first).toMatchObject({ total: 3, totalOutstanding: 9000 });
      expect(first.items.map((c) => c.id)).toEqual([customerId, c2.id]);
      expect(first.items[0]).toMatchObject({
        oldestDueInvoice: { sourceKind: 'OPENING', invoiceNumber: null },
        lastSoldAt: null,
      });
      expect(second.items.map((c) => c.id)).toEqual([c3.id]);
      expect((await dueList({ page: 3, pageSize: 2 })).items).toHaveLength(0);
    });
    it.each(['Sattar', 'sattar', '01311111111', '+8801311111111'])(
      'due search supports name/phone: %s',
      async (search) => {
        await oldDue(5000);
        expect((await dueList({ search })).items.map((c) => c.id)).toEqual([
          customerId,
        ]);
        expect((await dueList({ search: 'missing' })).total).toBe(0);
      },
    );
    it('receipt query searches receipt/customer/phone and paginates one row per receipt', async () => {
      await oldDue(5000);
      const a = await receive(input(1000, 5000));
      await receive(input(1000, 4000));
      await receive(input(1000, 3000));
      const first = await receipts({ pageSize: 2 }),
        second = await receipts({ page: 2, pageSize: 2 });
      expect(first.total).toBe(3);
      expect(second.items).toHaveLength(1);
      expect(
        new Set([...first.items, ...second.items].map((r) => r.id)).size,
      ).toBe(3);
      for (const search of ['Sattar', '01311111111', '+8801311111111'])
        expect((await receipts({ search })).total).toBe(3);
      expect(
        (await receipts({ search: a.receiptNumber })).items.map((r) => r.id),
      ).toEqual([a.id]);
    });
    it('Previous Due snapshot includes remaining Opening Due plus older sale, excludes the new sale', async () => {
      await oldDue(15000);
      await invoice(5000);
      await receive(input(5000, 20000));
      const supplier = await db.supplier.create({ data: { name: 'Supplier' } }),
        container = await db.container.create({
          data: {
            containerNumber: 'OP1',
            normalizedContainerNumber: 'OP1',
            supplierId: supplier.id,
          },
        });
      const product = await db.product.create({
          data: { itemCode: 'OP1', normalizedItemCode: 'OP1' },
        }),
        variant = await db.productVariant.create({
          data: { productId: product.id, color: 'Black', variantKey: 'black' },
        });
      await db.inventoryBatch.create({
        data: {
          batchCode: 'OP1',
          containerId: container.id,
          variantId: variant.id,
          originalRolls: 2,
          availableRolls: 2,
        },
      });
      const created = await sales.create({
        customerId,
        soldAt: new Date().toISOString(),
        discountAmount: 0,
        receivedAmount: 1000,
        lines: [
          { variantId: variant.id, rollsSold: 1, unitPricePerRoll: 8000 },
        ],
      });
      expect(await sales.details(created.id)).toMatchObject({
        totalAmount: 8000,
        paidAmount: 1000,
        dueAmount: 7000,
        previousOutstandingBeforeSale: 15000,
        outstandingAfterSale: 22000,
      });
      await receive(input(1000, 22000));
      expect(
        (await sales.details(created.id)).previousOutstandingBeforeSale,
      ).toBe(15000);
      expect((await account()).totalSales).toBe(13000);
    });
    it.each(['/payments/outstanding-customers', '/payments/receipts'])(
      'global query is auth protected and bounded: %s',
      async (path) => {
        await auth().get(path).expect(401);
        await auth().get(path).set('Authorization', 'Bearer valid').expect(200);
        for (const query of [
          'page=0',
          'pageSize=101',
          'page=bad',
          'page=1.5',
          'unknown=x',
          'search=' + 'x'.repeat(201),
        ])
          await auth()
            .get(`${path}?${query}`)
            .set('Authorization', 'Bearer valid')
            .expect(400);
      },
    );
    it.each(['opening-due', 'with-opening-due'])(
      'opening creation requires auth and cookie CSRF header: %s',
      async (kind) => {
        const path =
          kind === 'opening-due'
            ? `/customers/${customerId}/opening-due`
            : '/customers/with-opening-due';
        const p =
          kind === 'opening-due'
            ? openingInput()
            : { name: 'New', openingDue: openingInput() };
        await auth().post(path).send(p).expect(401);
        await auth()
          .post(path)
          .set('Cookie', 'afia_session=valid')
          .send(p)
          .expect(403);
        await auth()
          .post(path)
          .set('Cookie', 'afia_session=valid')
          .set('X-Afia-Payment', 'receive-payment')
          .send(p)
          .expect(201);
      },
    );
    it.each([
      { amount: 0 },
      { amount: -1 },
      { amount: '100' },
      { amount: 1.001 },
      { balanceAsOf: '2026-02-30' },
      { customerId: 'other' },
      { createdBy: 'other' },
      { originalAmount: 999 },
      { idempotencyKey: 'bad' },
    ])('opening HTTP rejects tampering: %j', async (extra) => {
      const r = await auth()
        .post(`/customers/${customerId}/opening-due`)
        .set('Authorization', 'Bearer valid')
        .send({ ...openingInput(), ...extra });
      expect(r.status).toBe(400);
      expect(JSON.stringify(r.body)).not.toMatch(
        /Prisma|SELECT|constraint|stack/,
      );
      expect(await db.customerOpeningBalance.count()).toBe(0);
    });
    it('opening route mismatch cannot pay another customer debt or read their receipt', async () => {
      const c = await db.customer.create({ data: { name: 'Other' } });
      const o = await oldDue(5000, c.id);
      await oldDue(5000);
      await expect(
        receive(
          input(1000, 5000, {
            allocationMode: 'MANUAL',
            allocations: [
              {
                openingBalanceId: o.openingDue.id,
                amount: 1000,
                expectedDue: 5000,
              },
            ],
          }),
        ),
      ).rejects.toMatchObject({ status: 409 });
      const r = await receive(input(1000, 5000));
      await expect(customers.receipt(c.id, r.id)).rejects.toMatchObject({
        status: 404,
      });
    });
    it('unknown/archived customers cannot get Opening Due and unsupported edits have no route', async () => {
      await expect(oldDue(5000, 'missing')).rejects.toMatchObject({
        status: 404,
      });
      await customers.archive(customerId);
      await expect(oldDue()).rejects.toMatchObject({ status: 409 });
      await auth()
        .patch(`/customers/${customerId}/opening-due`)
        .set('Authorization', 'Bearer valid')
        .send({ amount: 1 })
        .expect(404);
    });
    it('concurrent exact new-customer retries with a phone return the same record', async () => {
      const p = {
        name: 'One phone',
        phone: '01723456789',
        openingDue: openingInput(),
      };
      const [a, b] = await Promise.all([
        customers.createWithOpeningDue(p, actorId),
        customers.createWithOpeningDue(p, actorId),
      ]);
      expect(a.customerId).toBe(b.customerId);
      expect(
        await db.customer.count({
          where: { normalizedPhone: '8801723456789' },
        }),
      ).toBe(1);
    });
    it('opening idempotency rejects changed amount, actor or customer', async () => {
      const p = openingInput();
      await customers.addOpeningDue(customerId, p, actorId);
      const actor = await db.user.create({
          data: { name: 'Other', passwordHash: 'test' },
        }),
        c = await db.customer.create({ data: { name: 'Other' } });
      for (const operation of [
        () =>
          customers.addOpeningDue(customerId, { ...p, amount: 1000 }, actorId),
        () => customers.addOpeningDue(customerId, p, actor.id),
        () => customers.addOpeningDue(c.id, p, actorId),
      ])
        await expect(operation()).rejects.toMatchObject({ status: 409 });
    });
    it('forced opening audit failure rolls back both new customer and old due', async () => {
      await admin.query(
        `CREATE FUNCTION "${schema}".fail_opening_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason = 'FAIL_OPENING' THEN RAISE EXCEPTION 'private SQL failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_opening_audit BEFORE INSERT ON "${schema}"."AuditLog" FOR EACH ROW EXECUTE FUNCTION "${schema}".fail_opening_audit()`,
      );
      try {
        await expect(
          customers.createWithOpeningDue(
            {
              name: 'Rollback',
              openingDue: openingInput(5000, { note: 'FAIL_OPENING' }),
            },
            actorId,
          ),
        ).rejects.toThrow('Opening Due could not be saved');
        expect(await db.customer.count()).toBe(1);
        expect(await db.customerOpeningBalance.count()).toBe(0);
        expect(await db.auditLog.count()).toBe(0);
      } finally {
        await admin.query(
          `DROP TRIGGER fail_opening_audit ON "${schema}"."AuditLog"; DROP FUNCTION "${schema}".fail_opening_audit()`,
        );
      }
    });
    it('forced mixed-payment audit failure leaves both due sources intact', async () => {
      await oldDue(5000);
      await invoice(3000);
      await admin.query(
        `CREATE FUNCTION "${schema}".fail_mixed_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason = 'FAIL_MIXED' THEN RAISE EXCEPTION 'private SQL failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_mixed_audit BEFORE INSERT ON "${schema}"."AuditLog" FOR EACH ROW EXECUTE FUNCTION "${schema}".fail_mixed_audit()`,
      );
      try {
        await expect(
          receive(input(6000, 8000, { notes: 'FAIL_MIXED' })),
        ).rejects.toThrow('Payment could not be saved');
        expect((await account()).totalDue).toBe(8000);
        expect(await db.customerPaymentReceipt.count()).toBe(0);
        expect(await db.customerPaymentAllocation.count()).toBe(0);
      } finally {
        await admin.query(
          `DROP TRIGGER fail_mixed_audit ON "${schema}"."AuditLog"; DROP FUNCTION "${schema}".fail_mixed_audit()`,
        );
      }
    });
    it('database source constraints reject missing sources, cross-customer opening, and overpayment', async () => {
      const o = await oldDue(5000);
      const r = await receive(input(1000, 5000));
      const other = await db.customer.create({ data: { name: 'Other' } }),
        foreign = await oldDue(5000, other.id);
      for (const data of [
        { receiptId: r.id, amount: 1, previousDue: 1, remainingDue: 0 },
        {
          receiptId: r.id,
          openingBalanceId: foreign.openingDue.id,
          amount: 1,
          previousDue: 5000,
          remainingDue: 4999,
        },
        {
          receiptId: r.id,
          openingBalanceId: o.openingDue.id,
          amount: 4001,
          previousDue: 5000,
          remainingDue: 999,
        },
      ])
        await expect(
          db.customerPaymentAllocation.create({ data }),
        ).rejects.toBeDefined();
      expect((await account()).totalDue).toBe(4000);
      expect(await db.customerPaymentAllocation.count()).toBe(1);
    });
    it('opening HTTP protects nested new-customer amount and requires the opening event', async () => {
      for (const openingDue of [
        null,
        undefined,
        { ...openingInput(), createdBy: 'other' },
        { ...openingInput(), amount: 0 },
      ]) {
        await auth()
          .post('/customers/with-opening-due')
          .set('Authorization', 'Bearer valid')
          .send({ name: 'Bad', openingDue })
          .expect(400);
      }
      expect(await db.customer.count()).toBe(1);
    });
    it('global search treats wildcard and SQL input as literal text', async () => {
      await oldDue(5000);
      await receive(input(1000, 5000));
      for (const search of ['%', '_', "' OR 1=1 --"]) {
        expect((await dueList({ search })).total).toBe(0);
        expect((await receipts({ search })).total).toBe(0);
      }
    });
  });
});
