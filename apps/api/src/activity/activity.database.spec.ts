import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ActivityService } from './activity.service.js';
import { ActivityController } from './activity.controller.js';
import { ActivityAccessGuard } from './activity-access.guard.js';
import { auditMutation } from './activity-write.js';
import { CustomersService } from '../customers/customers.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { Test } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';

describe('Activity PostgreSQL history and owner access', () => {
  const schema = `activity_${randomUUID().replaceAll('-', '')}`;
  const url =
    process.env.DATABASE_URL ??
    'postgresql://afia:afia_local_password@localhost:5433/afia_inventory';
  const admin = new PrismaClient({ adapter: new PrismaPg(url) });
  let client: PrismaClient,
    service: ActivityService,
    ownerId: string,
    staffId: string,
    app: INestApplication;
  const tables = [
    'AuditLog',
    'User',
    'Sale',
    'Purchase',
    'Customer',
    'Supplier',
    'Container',
    'Product',
    'ProductVariant',
    'CustomerPaymentReceipt',
    'StoreSettings',
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

    service = new ActivityService(client as PrismaService);
    ownerId = (
      await client.user.create({
        data: {
          name: 'Owner One',
          passwordHash: 'never-display-this-hash',
          role: 'OWNER',
        },
      })
    ).id;
    staffId = (
      await client.user.create({
        data: {
          name: 'Staff One',
          passwordHash: 'never-display-this-hash',
          role: 'STAFF',
        },
      })
    ).id;
    const module = await Test.createTestingModule({
      controllers: [ActivityController],
      providers: [
        ActivityAccessGuard,
        { provide: ActivityService, useValue: service },
        {
          provide: (await import('../prisma/prisma.service.js')).PrismaService,
          useValue: client,
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use(
      (
        req: {
          headers: Record<string, string>;
          user?: { id: string; role: string };
        },
        _res: unknown,
        next: () => void,
      ) => {
        const id = req.headers['x-test-user'];
        if (id) req.user = { id, role: 'OWNER' };
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
    await client.auditLog.deleteMany();
  });
  const event = (extra: Record<string, unknown> = {}) =>
    client.auditLog.create({
      data: {
        action: 'SALE_CREATED',
        entityType: 'Sale',
        entityId: randomUUID(),
        userId: ownerId,
        metadata: {
          reference: 'AF-100',
          label: 'Rahim',
          totalAmount: '6000.00',
        },
        ...extra,
      } as never,
    });
  it('persists an exact before/after edit with actor snapshot and no password fields', async () => {
    const customer = await client.customer.create({ data: { name: 'Before' } });
    await auditMutation(
      client as PrismaService,
      {
        action: 'RECORD_UPDATED',
        entityType: 'Customer',
        entityId: customer.id,
        actorId: ownerId,
      },
      (tx) =>
        tx.customer.update({
          where: { id: customer.id },
          data: { name: 'After' },
        }),
    );
    await client.user.update({
      where: { id: ownerId },
      data: { name: 'Owner Renamed' },
    });
    const page = await service.list({});
    expect(page.items[0]).toMatchObject({
      title: 'Customer updated',
      label: 'After',
      category: 'Customers',
      actor: { name: 'Owner One' },
    });
    const detail = await service.details(page.items[0].id);
    expect(detail.changes).toContainEqual({
      label: 'Name',
      before: 'Before',
      after: 'After',
    });
    expect(JSON.stringify(detail)).not.toContain('passwordHash');
    expect(JSON.stringify(detail)).not.toContain('never-display-this-hash');
  });
  it('rolls the record and event back together if the write fails', async () => {
    const customer = await client.customer.create({
      data: { name: 'Original' },
    });
    await expect(
      auditMutation(
        client as PrismaService,
        {
          action: 'RECORD_UPDATED',
          entityType: 'Customer',
          entityId: customer.id,
          actorId: ownerId,
        },
        async (tx) => {
          await tx.customer.update({
            where: { id: customer.id },
            data: { name: 'Do not save' },
          });
          throw new Error('Rollback');
        },
      ),
    ).rejects.toThrow('Rollback');
    expect(
      (await client.customer.findUniqueOrThrow({ where: { id: customer.id } }))
        .name,
    ).toBe('Original');
    expect(await client.auditLog.count()).toBe(0);
  });
  it('tracks actual customer create/update writes with unchanged return values', async () => {
    const customers = new CustomersService(client as PrismaService);
    const saved = await customers.create({ name: 'New Customer' }, ownerId);
    expect(saved.name).toBe('New Customer');
    await customers.update(saved.id, { name: 'Edited Customer' }, ownerId);
    expect(
      (await service.list({ category: 'Customers' })).items
        .map((row) => row.action)
        .sort(),
    ).toEqual(['RECORD_CREATED', 'RECORD_UPDATED']);
  });
  it('searches snapshots and uses stable page order with all-row summaries', async () => {
    const timestamp = new Date('2026-10-08T18:00:00Z');
    await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        event({
          id: `event-${i}`,
          createdAt: timestamp,
          action: i === 0 ? 'SALE_VOIDED' : 'SALE_CREATED',
        }),
      ),
    );
    const page = await service.list({ search: 'AF-100', page: 2, pageSize: 2 });
    expect(page.items.map((row) => row.id)).toEqual(['event-2', 'event-3']);
    expect(page.summary).toEqual({
      total: 4,
      changes: 0,
      reversals: 1,
      people: 1,
    });
    expect(page.totalPages).toBe(2);
    expect((await service.list({ search: "' OR 1=1 --" })).total).toBe(0);
    expect((await service.list({ search: '%' })).total).toBe(0);
  });
  it('filters complete Bangladesh days, categories, people and actions', async () => {
    await event({ createdAt: new Date('2026-10-08T17:59:59Z') });
    await event({
      createdAt: new Date('2026-10-08T18:00:00Z'),
      userId: staffId,
    });
    await event({
      action: 'STOCK_ADJUSTED',
      entityType: 'ProductVariant',
      createdAt: new Date('2026-10-09T17:59:59Z'),
    });
    expect(
      (await service.list({ from: '2026-10-09', to: '2026-10-09' })).total,
    ).toBe(2);
    expect(
      (
        await service.list({
          category: 'Sales',
          actorId: staffId,
          action: 'SALE_CREATED',
        })
      ).total,
    ).toBe(1);
    expect((await service.list({ category: 'Stock' })).summary.changes).toBe(1);
    await expect(service.list({ from: '2026-02-30' })).rejects.toThrow(
      'valid date',
    );
    await expect(
      service.list({ from: '2026-10-10', to: '2026-10-09' }),
    ).rejects.toThrow('End date');
  });
  it('preserves legacy events and never invents snapshots or actor identity', async () => {
    const saved = await event({ userId: null, metadata: null });
    const detail = await service.details(saved.id);
    expect(detail.actor).toBeNull();
    expect(detail.hasSnapshot).toBe(false);
    expect(detail.changes).toEqual([]);
  });
  it('never returns unexpected secrets from old JSON metadata', async () => {
    const saved = await event({
      metadata: {
        token: 'hidden-token',
        password: 'hidden-password',
        before: { passwordHash: 'hidden-hash' },
        after: { passwordHash: 'hidden-hash' },
      },
    });
    const response = JSON.stringify(await service.details(saved.id));
    expect(response).not.toContain('hidden-');
  });
  it('checks the current database role even when the session claims owner', async () => {
    expect(
      (
        await request(app.getHttpServer())
          .get('/activity')
          .set('x-test-user', staffId)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app.getHttpServer())
          .get('/activity/options')
          .set('x-test-user', staffId)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app.getHttpServer())
          .get('/activity/missing')
          .set('x-test-user', staffId)
      ).status,
    ).toBe(403);
    expect((await request(app.getHttpServer()).get('/activity')).status).toBe(
      401,
    );
    expect(
      (
        await request(app.getHttpServer())
          .get('/activity')
          .set('x-test-user', ownerId)
      ).status,
    ).toBe(200);
    await client.user.update({
      where: { id: ownerId },
      data: { isActive: false },
    });
    expect(
      (
        await request(app.getHttpServer())
          .get('/activity')
          .set('x-test-user', ownerId)
      ).status,
    ).toBe(401);
    await client.user.update({
      where: { id: ownerId },
      data: { isActive: true },
    });
  });
  it.each([
    'pageSize=101',
    'page=0',
    'search=' + 'x'.repeat(201),
    'category=invalid',
    'from=invalid',
    'action=invalid',
    'sort=invalid',
    'secret=1',
  ])('rejects invalid query: %s', async (query) => {
    expect(
      (
        await request(app.getHttpServer())
          .get('/activity?' + query)
          .set('x-test-user', ownerId)
      ).status,
    ).toBe(400);
  });
});
