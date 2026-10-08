import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { SalesService } from './sales.service.js';
import { CustomersService } from '../customers/customers.service.js';
import { SalesController } from './sales.controller.js';
import type { CreateSaleDto } from './sale.dto.js';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { saleLineAmount } from '@afia/contracts';

describe('per-roll pricing and repeated color stock PostgreSQL regression', () => {
  const schema = `sale_rows_${randomUUID().replaceAll('-', '')}`;
  const url =
    process.env.DATABASE_URL ??
    'postgresql://afia:afia_local_password@localhost:5433/afia_inventory';
  const admin = new PrismaClient({ adapter: new PrismaPg(url) });
  let client: PrismaClient,
    sales: SalesService,
    customers: CustomersService,
    app: INestApplication;
  let customerId: string, variantId: string, containerId: string;
  const tables = [
    'CustomerOpeningBalance',
    'CustomerPaymentReceipt',
    'CustomerPaymentAllocation',
    'Customer',
    'Sale',
    'Payment',
    'SaleLine',
    'Product',
    'ProductVariant',
    'InventoryBatch',
    'Container',
    'Supplier',
    'StoreSettings',
    'SaleBatchAllocation',
    'StockMovement',
    'InvoiceEmailLog',
    'AuditLog',
  ];
  beforeAll(async () => {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    for (const table of tables)
      await admin.$executeRawUnsafe(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    const enums = await admin.$queryRaw<
      { name: string; labels: string[] }[]
    >`SELECT t.typname::text AS name, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' GROUP BY t.typname`;
    for (const type of enums)
      await admin.$executeRawUnsafe(
        `CREATE TYPE "${schema}"."${type.name}" AS ENUM (${type.labels.map((label) => "'" + label.replaceAll("'", "''") + "'").join(',')})`,
      );
    const columns = await admin.$queryRaw<
      {
        table_name: string;
        column_name: string;
        udt_name: string;
        column_default: string | null;
      }[]
    >`SELECT table_name::text,column_name::text,udt_name::text,column_default::text FROM information_schema.columns WHERE table_schema='public' AND data_type='USER-DEFINED'`;
    for (const c of columns.filter((c) => tables.includes(c.table_name))) {
      const target = `"${schema}"."${c.table_name}"`,
        col = `"${c.column_name}"`;
      await admin.$executeRawUnsafe(
        `ALTER TABLE ${target} ALTER COLUMN ${col} DROP DEFAULT`,
      );
      await admin.$executeRawUnsafe(
        `ALTER TABLE ${target} ALTER COLUMN ${col} TYPE "${schema}"."${c.udt_name}" USING ${col}::text::"${schema}"."${c.udt_name}"`,
      );
      const label = c.column_default?.match(/'([^']+)'/)?.[1];
      if (label)
        await admin.$executeRawUnsafe(
          `ALTER TABLE ${target} ALTER COLUMN ${col} SET DEFAULT '${label.replaceAll("'", "''")}'::"${schema}"."${c.udt_name}"`,
        );
    }
    const scoped = new URL(url);
    scoped.searchParams.set('options', `-c search_path=${schema}`);
    client = new PrismaClient({
      adapter: new PrismaPg(scoped.toString(), { schema }),
    });
    sales = new SalesService(client as PrismaService);
    customers = new CustomersService(client as PrismaService);
    const module = await Test.createTestingModule({
      controllers: [SalesController],
      providers: [{ provide: SalesService, useValue: sales }],
    }).compile();
    app = module.createNestApplication();
    app.use(
      (req: { user?: { id: string } }, _res: unknown, next: () => void) => {
        req.user = { id: 'staff' };
        next();
      },
    );
    await app.init();
  }, 30000);
  afterAll(async () => {
    await app?.close();
    await client?.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.$disconnect();
  });
  beforeEach(async () => {
    await client.$executeRawUnsafe(
      `TRUNCATE ${tables.map((table) => `"${schema}"."${table}"`).join(',')}`,
    );
    customerId = (await client.customer.create({ data: { name: 'Rahim' } })).id;
    const supplier = await client.supplier.create({
      data: { name: 'Supplier' },
    });
    containerId = (
      await client.container.create({
        data: {
          supplierId: supplier.id,
          containerNumber: 'C1',
          normalizedContainerNumber: 'C1',
          status: 'RECEIVED',
        },
      })
    ).id;
    const product = await client.product.create({
      data: {
        itemCode: 'F032 PVC',
        normalizedItemCode: 'F032 PVC',
        description: '1.2mm*54"*36.5m',
      },
    });
    variantId = (
      await client.productVariant.create({
        data: { productId: product.id, color: '1#Black', variantKey: 'black' },
      })
    ).id;
    await batch(3, 1500);
  });
  const batch = (rolls: number, meter: number, date = '2026-09-01') =>
    client.inventoryBatch.create({
      data: {
        containerId,
        variantId,
        batchCode: randomUUID(),
        originalRolls: rolls,
        originalMeter: meter,
        availableRolls: rolls,
        availableMeter: meter,
        receivedAt: new Date(date),
      },
    });
  const row = (rollsSold = 1, meterSold = 500, unitPricePerRoll = 1000) => ({
    variantId,
    rollsSold,
    meterSold,
    unitPricePerRoll,
  });
  const input = (lines: CreateSaleDto['lines'] = [row()]): CreateSaleDto => ({
    customerId,
    soldAt: new Date('2026-10-07T06:00:00Z').toISOString(),
    discountAmount: 0,
    receivedAmount: 0,
    lines,
  });
  const stock = async () => {
    const { _sum } = await client.inventoryBatch.aggregate({
      where: { variantId },
      _sum: { availableRolls: true, availableMeter: true },
    });
    return { rolls: _sum.availableRolls, meter: Number(_sum.availableMeter) };
  };
  it.each([2, 3])(
    'accepts %i intentional same-color rows and preserves their snapshots',
    async (count) => {
      const result = await sales.create(
        input(Array.from({ length: count }, (_, i) => row(1, 500, 1000 + i))),
      );
      const invoice = await sales.details(result.id);
      expect(invoice.lines).toHaveLength(count);
      expect(new Set(invoice.lines.map((line) => line.id)).size).toBe(count);
      expect(invoice.lines.map((line) => line.unitPricePerRoll).sort()).toEqual(
        Array.from({ length: count }, (_, i) => 1000 + i),
      );
      expect(
        invoice.lines.every(
          (line) =>
            line.itemCode === 'F032 PVC' &&
            line.color === '1#Black' &&
            line.description === '1.2mm*54"*36.5m',
        ),
      ).toBe(true);
      expect(await stock()).toEqual({
        rolls: 3 - count,
        meter: 1500 - count * 500,
      });
      const movements = await client.stockMovement.findMany({
        where: { reference: result.invoiceNumber },
      });
      expect(
        movements.reduce((sum, movement) => sum + movement.rollsChange, 0),
      ).toBe(-count);
      expect(
        movements.reduce(
          (sum, movement) => sum + Number(movement.meterChange),
          0,
        ),
      ).toBe(-count * 500);
    },
  );
  it.each([
    {
      lines: () => [row(2, 500), row(2, 500)],
      message: 'Only 3 Rolls are available across all 1#Black rows.',
    },
    {
      lines: () => [row(1, 900), row(1, 700)],
      message: 'Only 1,500 Meter is available across all 1#Black rows.',
    },
  ])(
    'rejects aggregate oversell with rollback: $message',
    async ({ lines, message }) => {
      await expect(sales.create(input(lines()))).rejects.toThrow(message);
      expect(await stock()).toEqual({ rolls: 3, meter: 1500 });
      expect(await client.sale.count()).toBe(0);
      expect(await client.saleLine.count()).toBe(0);
      expect(await client.stockMovement.count()).toBe(0);
    },
  );
  it.each([
    [1, 1000, 1000],
    [2, 1000, 2000],
    [3, 0.1, 0.3],
    [2, 1000.25, 2000.5],
  ])('calculates %i Rolls × %s exactly', async (rolls, price, amount) => {
    const result = await sales.create(input([row(rolls, 0, price)]));
    expect(result.subtotal).toBe(amount);
    expect((await sales.details(result.id)).lines[0].lineTotal).toBe(amount);
  });
  it('ignores a client-tampered total; preserves discount, due, Customer Account and ledger semantics', async () => {
    const dto = input([{ ...row(2, 1050, 1000.25), lineTotal: 1 }]);
    dto.discountAmount = 100.25;
    dto.receivedAmount = 500.25;
    dto.paymentMethod = 'BANK';
    const result = await sales.create(dto);
    expect(result).toMatchObject({
      subtotal: 2000.5,
      totalAmount: 1900.25,
      paidAmount: 500.25,
      dueAmount: 1400,
      changeAmount: 0,
    });
    const account = await customers.account(customerId, {
      page: 1,
      pageSize: 25,
    });
    expect(account).toMatchObject({
      totalSales: 1900.25,
      totalPaid: 500.25,
      totalDue: 1400,
    });
    expect(account.sales.items).toHaveLength(1);
    expect(account.outstandingInvoices.items).toHaveLength(1);
    expect(account.payments.items).toHaveLength(1);
    expect(
      (await sales.ledger({ page: 1, pageSize: 25 })).items[0],
    ).toMatchObject({ totalAmount: 1900.25, dueAmount: 1400 });
  });
  it('Meter never affects pricing and over-received money remains change', async () => {
    const a = await sales.create({
      ...input([row(1, 0, 1000)]),
      receivedAmount: 1200,
    });
    const b = await sales.create(input([row(1, 1050, 1000)]));
    expect(a).toMatchObject({
      subtotal: 1000,
      paidAmount: 1000,
      dueAmount: 0,
      changeAmount: 200,
    });
    expect(b.subtotal).toBe(a.subtotal);
    expect(a.invoiceNumber).not.toBe(b.invoiceNumber);
  });
  it('allocates oldest batches sequentially without discarding Meter needed by repeated rows; void restores all stock', async () => {
    await client.inventoryBatch.deleteMany();
    const first = await batch(1, 1000);
    const second = await batch(2, 500, '2026-09-02');
    const created = await sales.create({
      ...input([row(1, 100, 100), row(1, 1000, 200)]),
      receivedAmount: 100,
    });
    const invoice = await sales.details(created.id);
    expect(invoice.subtotal).toBe(300);
    expect(await stock()).toEqual({ rolls: 1, meter: 400 });
    const allocations = await client.saleBatchAllocation.findMany({
      where: { saleLine: { saleId: created.id } },
    });
    expect(allocations.reduce((sum, a) => sum + a.rollsSold, 0)).toBe(2);
    expect(allocations.reduce((sum, a) => sum + Number(a.meterSold), 0)).toBe(
      1100,
    );
    expect(
      allocations
        .filter((a) => a.batchId === first.id)
        .reduce((sum, a) => sum + a.rollsSold, 0),
    ).toBe(1);
    expect(
      (
        await client.inventoryBatch.findUniqueOrThrow({
          where: { id: second.id },
        })
      ).availableRolls,
    ).toBe(1);
    await sales.void(created.id, 'Regression check');
    expect(await stock()).toEqual({ rolls: 3, meter: 1500 });
    expect(
      (await customers.account(customerId, { page: 1, pageSize: 25 })).totalDue,
    ).toBe(0);
    expect(await client.auditLog.findMany()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'SALE_CREATED' }),
        expect.objectContaining({ action: 'SALE_VOIDED' }),
      ]),
    );
  });
  it('normalizes unused Meter only after all rows, including a batch exhausted by an earlier row', async () => {
    await client.inventoryBatch.deleteMany();
    const first = await batch(1, 1000);
    await batch(2, 500, '2026-09-02');
    const created = await sales.create(input([row(1, 100), row(1, 100)]));
    expect(await stock()).toEqual({ rolls: 1, meter: 500 });
    const last = await client.saleBatchAllocation.findMany({
      where: { batchId: first.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(
      Number(last.find((a) => Number(a.meterBefore) === 900)?.meterAfter),
    ).toBe(0);
    await sales.void(created.id, 'Undo normalization');
    expect(await stock()).toEqual({ rolls: 3, meter: 1500 });
  });
  it('loads historical manual amounts with unknown/null unit price', async () => {
    const sale = await client.sale.create({
      data: {
        customerId,
        invoiceNumber: 'OLD-001',
        soldAt: new Date(),
        totalAmount: 777,
        paidAmount: 0,
        lines: {
          create: {
            variantId,
            mode: 'FULL_ROLL',
            rollsSold: 3,
            meterSold: 550,
            lineTotal: 777,
            colorCodeSnapshot: '1#Black',
          },
        },
      },
    });
    expect((await sales.details(sale.id)).lines[0]).toMatchObject({
      unitPricePerRoll: null,
      lineTotal: 777,
      rollsSold: 3,
    });
  });
  it('HTTP preserves repeated rows and computes a tampered amount without emitted DTO metadata', async () => {
    const response = await request(app.getHttpServer())
      .post('/sales')
      .send(
        input([{ ...row(1, 500, 1000), lineTotal: 999999 }, row(1, 550, 2000)]),
      );
    expect(response.status).toBe(201);
    expect(response.body.subtotal).toBe(3000);
    expect((await sales.details(response.body.id)).lines).toHaveLength(2);
  });
  it.each([0, -1, 1.001, '1000', null, undefined])(
    'HTTP rejects invalid or missing Unit Price / Roll: %s',
    async (price) => {
      const response = await request(app.getHttpServer())
        .post('/sales')
        .send(
          input([
            { ...row(), unitPricePerRoll: price } as unknown as ReturnType<
              typeof row
            >,
          ]),
        );
      expect(response.status).toBe(400);
      expect(await client.sale.count()).toBe(0);
    },
  );
  it.each([1.5, 0, -1, '1'])(
    'HTTP rejects invalid Rolls: %s',
    async (rolls) => {
      const response = await request(app.getHttpServer())
        .post('/sales')
        .send(
          input([
            { ...row(), rollsSold: rolls } as unknown as ReturnType<typeof row>,
          ]),
        );
      expect(response.status).toBe(400);
    },
  );
  it('rejects missing/invalid price at the service boundary too', async () => {
    await expect(
      sales.create(
        input([
          { ...row(), unitPricePerRoll: undefined } as unknown as ReturnType<
            typeof row
          >,
        ]),
      ),
    ).rejects.toThrow('Row 1:');
    expect(() => saleLineAmount(2, 999999999999.99)).toThrow(
      'Line amount exceeds',
    );
  });
});
