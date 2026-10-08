import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { CustomersService } from './customers.service.js';
import { resolveSaleCustomer } from './customer-resolution.js';
import { SearchService } from '../search/search.service.js';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { CustomersController } from './customers.controller.js';
import request from 'supertest';

describe('customer identity PostgreSQL and HTTP regression', () => {
  const schema = `customer_identity_${randomUUID().replaceAll('-', '')}`;
  const url =
    process.env.DATABASE_URL ??
    'postgresql://afia:afia_local_password@localhost:5433/afia_inventory';
  const admin = new PrismaClient({ adapter: new PrismaPg(url) });
  let client: PrismaClient, customers: CustomersService, app: INestApplication;
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
    'Purchase',
    'AuditLog',
    'User',
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
    customers = new CustomersService(client as PrismaService);
    // Remove method metadata to exercise the tsx runtime path as well.
    const metadata = Reflect.getMetadata(
      'design:paramtypes',
      CustomersController.prototype,
      'create',
    );
    Reflect.deleteMetadata(
      'design:paramtypes',
      CustomersController.prototype,
      'create',
    );
    const module = await Test.createTestingModule({
      controllers: [CustomersController],
      providers: [{ provide: CustomersService, useValue: customers }],
    }).compile();
    app = module.createNestApplication();
    const actor = await client.user.create({ data: { name: 'Identity Tester', passwordHash: 'test-only', role: 'OWNER' } });
    app.use((req: { user?: { id: string } }, _res: unknown, next: () => void) => { req.user = { id: actor.id }; next(); });
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    if (metadata)
      Reflect.defineMetadata(
        'design:paramtypes',
        metadata,
        CustomersController.prototype,
        'create',
      );
  }, 30000);
  afterAll(async () => {
    await app?.close();
    await client?.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.$disconnect();
  });
  it('creates unique phones, allows equal names/emails and multiple null phones', async () => {
    const a = await customers.create({
      name: 'Rahim',
      phone: '01712-345678',
      email: 'same@example.test',
    });
    const b = await customers.create({
      name: 'Rahim',
      phone: '01822222222',
      email: 'same@example.test',
    });
    expect(a.id).not.toBe(b.id);
    expect(
      await client.customer.findUnique({ where: { id: a.id } }),
    ).toMatchObject({
      phone: '01712-345678',
      normalizedPhone: '8801712345678',
    });
    await expect(
      customers.create({ name: 'Duplicate', phone: '+8801712345678' }),
    ).rejects.toMatchObject({
      response: {
        code: 'CUSTOMER_PHONE_CONFLICT',
        existingCustomer: { id: a.id, name: 'Rahim', phone: '01712-345678' },
      },
    });
    const null1 = await customers.create({ name: 'No phone' }),
      null2 = await customers.create({ name: 'No phone', phone: '  ' });
    expect(null1.id).not.toBe(null2.id);
    expect(
      (await client.customer.findUniqueOrThrow({ where: { id: null1.id } }))
        .normalizedPhone,
    ).toBeNull();
  });
  it('finds the same customer by local, international and formatted phone, or contact metadata', async () => {
    for (const search of [
      '01712345678',
      '+8801712345678',
      '8801712345678',
      '+880 1712 345678',
    ]) {
      const results = await customers.list(search);
      expect(results).toHaveLength(1);
      expect(results[0].phone).toBe('01712-345678');
    }
    expect((await customers.list('Rahim')).length).toBe(2);
    expect((await customers.list('same@example.test')).length).toBe(2);
    const global = await new SearchService(client as PrismaService).search(
      '+8801712345678',
    );
    expect(global.filter((g) => g.type === 'customer')).toHaveLength(1);
  });
  it('updates display/canonical phone atomically and blocks another owner, including archived owners', async () => {
    const a = await client.customer.findUniqueOrThrow({
      where: { normalizedPhone: '8801712345678' },
    });
    await customers.update(a.id, { name: 'Rahim', phone: '+880 1712 345678' });
    expect(
      await client.customer.findUnique({ where: { id: a.id } }),
    ).toMatchObject({
      phone: '+880 1712 345678',
      normalizedPhone: '8801712345678',
    });
    await expect(
      customers.update(a.id, { name: 'Rahim', phone: '01822222222' }),
    ).rejects.toThrow('already belongs');
    const archived = await customers.create({
      name: 'Archived owner',
      phone: '01933333333',
    });
    await customers.archive(archived.id);
    await expect(
      customers.create({ name: 'New', phone: '+8801933333333' }),
    ).rejects.toMatchObject({
      response: { existingCustomer: { id: archived.id, archived: true } },
    });
  });
  it('preserves sale/payment IDs, invoice snapshot, account totals and histories when phone changes', async () => {
    const c = await customers.create({ name: 'History', phone: '01644444444' });
    const sale = await client.sale.create({
      data: {
        customerId: c.id,
        invoiceNumber: 'ID-HISTORY',
        status: 'COMPLETED',
        totalAmount: 100,
        paidAmount: 25,
        customerNameSnapshot: 'History',
        customerPhoneSnapshot: '01644444444',
      },
    });
    const payment = await client.payment.create({
      data: { customerId: c.id, saleId: sale.id, amount: 25 },
    });
    const before = await customers.account(c.id, { page: 1, pageSize: 25 });
    await customers.update(c.id, { name: 'History', phone: '01555555555' });
    const after = await customers.account(c.id, { page: 1, pageSize: 25 });
    expect(after).toMatchObject({
      id: c.id,
      totalSales: 100,
      totalPaid: 25,
      totalDue: 75,
    });
    const historicalValues = (page: typeof before.sales) => ({
      ...page,
      items: page.items.map(
        ({ customerPhone: _currentPhone, ...invoice }) => invoice,
      ),
    });
    expect(historicalValues(after.sales)).toEqual(
      historicalValues(before.sales),
    );
    expect(historicalValues(after.outstandingInvoices)).toEqual(
      historicalValues(before.outstandingInvoices),
    );
    expect(after.payments).toEqual(before.payments);
    expect(
      await client.sale.findUnique({ where: { id: sale.id } }),
    ).toMatchObject({ customerId: c.id, customerPhoneSnapshot: '01644444444' });
    expect(
      await client.payment.findUnique({ where: { id: payment.id } }),
    ).toMatchObject({ customerId: c.id, saleId: sale.id });
  });
  it('uses normalized phone for sale resolution, preserves selected ID, and never matches name/email alone', async () => {
    const c = await client.customer.findUniqueOrThrow({
      where: { normalizedPhone: '8801712345678' },
    });
    const matched = await client.$transaction((tx) =>
      resolveSaleCustomer(tx, {
        name: 'Different name',
        phone: '01712345678',
        email: 'other@example.test',
      }),
    );
    expect(matched.id).toBe(c.id);
    expect(matched.name).toBe(c.name);
    const selected = await client.$transaction((tx) =>
      resolveSaleCustomer(tx, {
        id: c.id,
        name: 'Typed',
        phone: '01822222222',
      }),
    );
    expect(selected.id).toBe(c.id);
    const explicit = await client.$transaction((tx) =>
      resolveSaleCustomer(
        tx,
        { id: 'ignored', name: 'Typed', phone: '01822222222' },
        c.id,
      ),
    );
    expect(explicit.id).toBe(c.id);
    const count = await client.customer.count();
    const newName = await client.$transaction((tx) =>
      resolveSaleCustomer(tx, {
        name: 'Rahim',
        phone: '01466666666',
        email: 'same@example.test',
      }),
    );
    expect(newName.id).not.toBe(c.id);
    await client.$transaction((tx) =>
      resolveSaleCustomer(tx, { name: 'Rahim', email: 'same@example.test' }),
    );
    expect(await client.customer.count()).toBe(count + 2);
    const legacy = await client.customer.create({
      data: { name: 'Legacy', phone: '013243558345' },
    });
    expect(
      (
        await client.$transaction((tx) =>
          resolveSaleCustomer(tx, {
            id: legacy.id,
            name: 'Legacy',
            phone: legacy.phone!,
          }),
        )
      ).id,
    ).toBe(legacy.id);
    await expect(
      client.$transaction((tx) =>
        resolveSaleCustomer(tx, { name: 'Invalid', phone: '123' }),
      ),
    ).rejects.toThrow('valid Bangladesh mobile');
  });
  it('DB uniqueness gives one success and a clean conflict for simultaneous same-phone creates', async () => {
    // Force both availability checks to finish before either insert reaches the DB.
    const findUnique = client.customer.findUnique.bind(client.customer);
    let checks = 0,
      release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const lookup = vi
      .spyOn(client.customer, 'findUnique')
      .mockImplementation((async (args: Prisma.CustomerFindUniqueArgs) => {
        const result = await findUnique(args);
        if (
          (args as { where: { normalizedPhone?: string } }).where
            .normalizedPhone === '8801377777777' &&
          checks < 2
        ) {
          checks++;
          if (checks === 2) release();
          await barrier;
        }
        return result;
      }) as unknown as typeof client.customer.findUnique);
    const results = await Promise.allSettled([
      customers.create({ name: 'Concurrent A', phone: '01377777777' }),
      customers.create({ name: 'Concurrent B', phone: '+8801377777777' }),
    ]);
    lookup.mockRestore();
    expect(checks).toBe(2);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(failed.reason.getStatus()).toBe(409);
    expect(failed.reason.getResponse()).toMatchObject({
      code: 'CUSTOMER_PHONE_CONFLICT',
    });
    expect(
      await client.customer.count({
        where: { normalizedPhone: '8801377777777' },
      }),
    ).toBe(1);
  });
  it('HTTP creates/updates validate invalid phones before writing and expose useful existing-customer conflicts', async () => {
    for (const phone of [
      'abc',
      '017123',
      '017123456789',
      '01012345678',
      '01712--345678',
    ])
      await request(app.getHttpServer())
        .post('/customers')
        .send({ name: 'Bad', phone })
        .expect(400);
    const created = await request(app.getHttpServer())
      .post('/customers')
      .send({ name: 'HTTP', phone: '+880 1812 345678' })
      .expect(201);
    const conflict = await request(app.getHttpServer())
      .post('/customers')
      .send({ name: 'Other', phone: '01812345678' })
      .expect(409);
    expect(conflict.body.existingCustomer).toMatchObject({
      id: created.body.id,
      name: 'HTTP',
    });
    expect(conflict.body.existingCustomer.normalizedPhone).toBeUndefined();
    expect(created.body.normalizedPhone).toBeUndefined();
    await request(app.getHttpServer())
      .post('/customers')
      .send({
        name: 'Manual identity',
        phone: '01988888888',
        normalizedPhone: 'manually-edited',
      })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/customers/${created.body.id}`)
      .send({ name: 'HTTP', phone: 'test' })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/customers/${created.body.id}`)
      .send({ name: 'HTTP', phone: '01812-345678' })
      .expect(200);
    expect(
      (
        await client.customer.findUniqueOrThrow({
          where: { id: created.body.id },
        })
      ).normalizedPhone,
    ).toBe('8801812345678');
    const activity = await client.auditLog.findMany({ where: { entityType: 'Customer', entityId: created.body.id } });
    expect(activity.map((row) => row.action).sort()).toEqual(['RECORD_CREATED', 'RECORD_UPDATED']);
  });
});
