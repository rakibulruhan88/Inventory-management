import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import type { AuthUser } from '@afia/contracts';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SuppliersService } from './suppliers.service.js';
import { SuppliersController } from './suppliers.controller.js';

describe('Supplier Cashbook payment summaries', () => {
  const schema = `supplier_payments_${randomUUID().replaceAll('-', '')}`;
  const url =
    process.env.DATABASE_URL ??
    'postgresql://afia:afia_local_password@localhost:5433/afia_inventory';
  const admin = new Pool({ connectionString: url });
  let db: PrismaClient,
    service: SuppliersService,
    controller: SuppliersController;
  const owner = { id: randomUUID(), name: 'Owner', role: 'OWNER' } as AuthUser;
  const supplierId = randomUUID(),
    otherId = randomUUID(),
    unpaidId = randomUUID();
  const paymentIds: string[] = [];
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
    service = new SuppliersService(db as PrismaService);
    controller = new SuppliersController(service);
    await db.user.create({
      data: {
        id: owner.id,
        name: owner.name,
        role: 'OWNER',
        passwordHash: 'test',
      },
    });
    await db.supplier.createMany({
      data: [
        { id: supplierId, name: 'Leather Supplier' },
        { id: otherId, name: 'Leather Supplier' }, // Similar names never merge money.
        { id: unpaidId, name: 'Unpaid Supplier' },
      ],
    });
    const container = await db.container.create({
      data: {
        containerNumber: 'STOCK-ONLY',
        normalizedContainerNumber: 'STOCK-ONLY',
        supplierId,
      },
    });
    await db.purchase.create({
      data: {
        purchaseNumber: 'P-STOCK-ONLY',
        supplierId,
        containerId: container.id,
        purchasedAt: new Date(),
      },
    });
    for (const [supplier, amount, type, voided, method] of [
      [supplierId, 30000, 'SUPPLIER_PAYMENT', false, 'CASH'],
      [supplierId, 50000, 'SUPPLIER_PAYMENT', false, 'BANK'],
      [supplierId, 9000, 'SUPPLIER_PAYMENT', true, 'CASH'],
      [supplierId, 1000, 'OTHER_OUT', false, 'CASH'],
      [otherId, 700, 'SUPPLIER_PAYMENT', false, 'CASH'],
    ] as const) {
      const entry = await db.financialEntry.create({
        data: {
          supplierId: type === 'SUPPLIER_PAYMENT' ? supplier : null,
          amount,
          type,
          direction: 'OUT',
          method,
          occurredAt: new Date(),
          createdBy: owner.id,
          idempotencyKey: randomUUID(),
          requestHash: 'test',
          voidedAt: voided ? new Date() : null,
          voidedBy: voided ? owner.id : null,
          voidReason: voided ? 'Test void' : null,
        },
      });
      if (supplier === supplierId && !voided && type === 'SUPPLIER_PAYMENT')
        paymentIds.push(entry.id);
    }
  });
  afterAll(async () => {
    if (db) await db.$disconnect();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  });
  it('shows 80,000 actually paid separately from unvalued stock purchases', async () => {
    const rows = await controller.search(owner);
    expect(rows.find((row) => row.id === supplierId)).toMatchObject({
      purchaseCount: 1,
      totalPurchases: 0,
      totalPaidToSupplier: 80000,
      supplierPaymentCount: 2,
    });
    expect(rows.find((row) => row.id === otherId)?.totalPaidToSupplier).toBe(
      700,
    );
    expect(rows.find((row) => row.id === unpaidId)).toMatchObject({
      totalPaidToSupplier: 0,
      supplierPaymentCount: 0,
    });
  });
  it('details agree with directory and include only active supplier payment receipts', async () => {
    const result = await controller.details(supplierId, owner);
    expect(result.totalPaidToSupplier).toBe(80000);
    expect(result.recentSupplierPayments?.map((p) => p.id).sort()).toEqual(
      [...paymentIds].sort(),
    );
    expect(result.recentSupplierPayments?.map((p) => p.amount).sort()).toEqual([
      30000, 50000,
    ]);
  });
  it('withholds finance data from staff with supplier-view access only', async () => {
    const staff = {
      id: 'staff',
      name: 'Stock Staff',
      role: 'STAFF',
      permissions: ['suppliers.view'],
    } as AuthUser;
    const rows = await controller.search(staff);
    const details = await controller.details(supplierId, staff);
    expect(rows.find((row) => row.id === supplierId)).not.toHaveProperty(
      'totalPaidToSupplier',
    );
    expect(details).not.toHaveProperty('supplierPaymentCount');
    expect(details).not.toHaveProperty('recentSupplierPayments');
    expect(details.purchaseCount).toBe(1);
  });
  it('allows finance-view staff to see payment totals', async () => {
    const staff = {
      id: 'staff',
      name: 'Cashier',
      role: 'STAFF',
      permissions: ['suppliers.view', 'finance.view'],
    } as AuthUser;
    expect(
      (await controller.details(supplierId, staff)).totalPaidToSupplier,
    ).toBe(80000);
  });
  it('recomputes totals after a payment is voided without changing stock records', async () => {
    await db.financialEntry.update({
      where: { id: paymentIds[0] },
      data: { voidedAt: new Date(), voidedBy: owner.id, voidReason: 'Test void' },
    });
    const result = await service.details(supplierId, true);
    expect(result).toMatchObject({
      totalPaidToSupplier: 50000,
      supplierPaymentCount: 1,
      purchaseCount: 1,
    });
    expect(result.recentSupplierPayments?.map((p) => p.id)).toEqual([
      paymentIds[1],
    ]);
  });
});
