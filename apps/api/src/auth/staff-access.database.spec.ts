import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { StaffController } from './staff.controller.js';
import { StaffService } from './staff.service.js';
import { FinanceController } from '../finance/finance.controller.js';
import { FinanceService } from '../finance/finance.service.js';
import { FinanceAccessGuard } from '../finance/finance-access.guard.js';
import { SalesService } from '../sales/sales.service.js';
import { documentActor } from '../activity/document-actor.js';
import { appendActivity } from '../activity/activity-write.js';
import { expandPermissions, type StaffInput } from '@afia/contracts';
import { compare } from 'bcryptjs';

describe('Staff access, session revocation and attribution in PostgreSQL', () => {
  const schema = `staff_access_${randomUUID().replaceAll('-', '')}`;
  const url =
    process.env.DATABASE_URL ??
    'postgresql://afia:afia_local_password@localhost:5433/afia_inventory';
  const admin = new Pool({ connectionString: url });
  const jwt = new JwtService({ secret: 'staff-test-only' });
  const ownerId = randomUUID();
  let db: PrismaClient, app: INestApplication, auth: AuthService;
  let staffId: string, token: string;
  const ownerToken = jwt.sign({ id: ownerId, role: 'OWNER' });
  const staffInput = (): StaffInput => ({
    name: 'Sales Person',
    username: 'sales.staff',
    password: 'initial-password',
    isActive: true,
    permissions: ['sales.create'],
  });
  const ownerRequest = (method: 'post' | 'patch' | 'delete', path: string) =>
    request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${ownerToken}`);
  beforeAll(async () => {
    const c = await admin.connect();
    try {
      await c.query(`CREATE SCHEMA "${schema}"`);
      await c.query(`SET search_path TO "${schema}"`);
      const directory = new URL('../../prisma/migrations/', import.meta.url);
      for (const folder of readdirSync(directory).sort())
        if (!folder.endsWith('.toml'))
          await c.query(
            readFileSync(new URL(`${folder}/migration.sql`, directory), 'utf8'),
          );
    } finally {
      c.release();
    }
    const scoped = new URL(url);
    scoped.searchParams.set('options', `-c search_path=${schema}`);
    db = new PrismaClient({
      adapter: new PrismaPg(scoped.toString(), { schema }),
    });
    await db.user.create({
      data: {
        id: ownerId,
        name: 'Admin',
        username: 'admin',
        role: 'OWNER',
        passwordHash: 'unused',
      },
    });
    const mod = await Test.createTestingModule({
      controllers: [StaffController, AuthController, FinanceController],
      providers: [
        StaffService,
        AuthService,
        FinanceService,
        FinanceAccessGuard,
        { provide: PrismaService, useValue: db },
        { provide: JwtService, useValue: jwt },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'WEB_ORIGIN' ? 'http://localhost:5174' : undefined,
          },
        },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    }).compile();
    app = mod.createNestApplication();
    await app.init();
    auth = mod.get(AuthService);
  }, 30000);
  afterAll(async () => {
    await app?.close();
    await db?.$disconnect();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  });
  it('creates staff with hashed credentials, dependencies and an atomic safe audit', async () => {
    const result = await ownerRequest('post', '/staff')
      .send(staffInput())
      .expect(201);
    staffId = result.body.id;
    expect(result.body.permissions).toEqual(
      expandPermissions(['sales.create']),
    );
    expect(result.body).not.toHaveProperty('passwordHash');
    const saved = await db.user.findUniqueOrThrow({ where: { id: staffId } });
    expect(await compare('initial-password', saved.passwordHash)).toBe(true);
    const event = await db.auditLog.findFirstOrThrow({
      where: { entityId: staffId, action: 'RECORD_CREATED' },
    });
    expect(JSON.stringify(event.metadata)).not.toContain('initial-password');
    expect(JSON.stringify(event.metadata)).not.toContain(saved.passwordHash);
    expect(event.userId).toBe(ownerId);
    token = (await auth.login('SALES.STAFF', 'initial-password')).token;
  });
  it('rejects duplicate usernames, invalid permissions and creation without a password', async () => {
    await ownerRequest('post', '/staff')
      .send({ ...staffInput(), username: 'SALES.STAFF' })
      .expect(409);
    await ownerRequest('post', '/staff')
      .send({
        ...staffInput(),
        username: 'new.staff',
        permissions: ['staff.manage'],
      })
      .expect(400);
    await ownerRequest('post', '/staff')
      .send({ ...staffInput(), username: 'new.staff', password: undefined })
      .expect(400);
    expect(await db.user.count({ where: { role: 'STAFF' } })).toBe(1);
  });
  it('rejects staff management and financial writes with a forged owner role', async () => {
    await request(app.getHttpServer())
      .get('/staff')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    const forged = jwt.sign({ id: staffId, role: 'OWNER' });
    await request(app.getHttpServer())
      .get('/staff')
      .set('Authorization', `Bearer ${forged}`)
      .expect(403);
    await request(app.getHttpServer())
      .post('/finance/entries')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(403);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect((r) => expect(r.body.user.role).toBe('STAFF'));
  });
  it('requires the staff form header for cookie-authenticated changes', async () => {
    await request(app.getHttpServer())
      .post('/staff')
      .set('Cookie', `afia_session=${ownerToken}`)
      .send({ ...staffInput(), username: 'csrf.staff' })
      .expect(403);
  });
  it('grants explicit money-entry access, invalidates old sessions and keeps void restricted', async () => {
    await ownerRequest('patch', `/staff/${staffId}`)
      .send({
        ...staffInput(),
        password: undefined,
        permissions: ['finance.create'],
      })
      .expect(200);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    token = (await auth.login('sales.staff', 'initial-password')).token;
    const result = await request(app.getHttpServer())
      .post('/finance/entries')
      .set('Authorization', `Bearer ${token}`)
      .set('x-afia-finance', '1')
      .send({
        type: 'OTHER_IN',
        amount: 10,
        method: 'CASH',
        occurredAt: '2026-10-10T12:00:00+06:00',
        idempotencyKey: randomUUID(),
      })
      .expect(201);
    expect(result.body.creatorName).toBe('Sales Person');
    await request(app.getHttpServer())
      .post(`/finance/entries/${result.body.id}/void`)
      .set('Authorization', `Bearer ${token}`)
      .set('x-afia-finance', '1')
      .send({ reason: 'Not allowed' })
      .expect(403);
  });
  it('resets the password with a safe audit and blocks all prior tokens', async () => {
    await ownerRequest('patch', `/staff/${staffId}`)
      .send({
        ...staffInput(),
        password: 'replacement-password',
        permissions: ['finance.create'],
      })
      .expect(200);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    await expect(
      auth.login('sales.staff', 'initial-password'),
    ).rejects.toThrow();
    token = (await auth.login('sales.staff', 'replacement-password')).token;
    expect(
      await db.auditLog.count({
        where: { entityId: staffId, action: 'PASSWORD_CHANGED' },
      }),
    ).toBe(1);
    expect(
      JSON.stringify(
        await db.auditLog.findMany({ where: { entityId: staffId } }),
      ),
    ).not.toContain('replacement-password');
  });
  it('provides owner-only work counts without counting retries, other actors or cashbook voids twice', async () => {
    const priorMonth = new Date();
    priorMonth.setUTCMonth(priorMonth.getUTCMonth() - 2);
    await db.auditLog.createMany({
      data: [
        {
          userId: staffId,
          entityType: 'Sale',
          entityId: 'summary-sale',
          action: 'SALE_CREATED',
        },
        {
          userId: staffId,
          entityType: 'Sale',
          entityId: 'summary-sale',
          action: 'SALE_CREATED',
        },
        {
          userId: staffId,
          entityType: 'Sale',
          entityId: 'summary-sale',
          action: 'SALE_VOIDED',
        },
        {
          userId: ownerId,
          entityType: 'Sale',
          entityId: 'owner-sale',
          action: 'SALE_CREATED',
        },
        {
          userId: staffId,
          entityType: 'Customer',
          entityId: 'old-customer',
          action: 'RECORD_CREATED',
          createdAt: priorMonth,
        },
        {
          userId: staffId,
          entityType: 'FinancialEntry',
          entityId: 'out-entry',
          action: 'FINANCIAL_ENTRY_CREATED',
          metadata: { type: 'EXPENSE' },
        },
        {
          userId: staffId,
          entityType: 'FinancialEntry',
          entityId: 'out-entry',
          action: 'FINANCIAL_ENTRY_VOIDED',
        },
        {
          userId: staffId,
          entityType: 'CustomerPaymentReceipt',
          entityId: 'receipt',
          action: 'CUSTOMER_PAYMENT_RECEIVED',
        },
        {
          userId: staffId,
          entityType: 'ProductVariant',
          entityId: 'same-variant',
          action: 'STOCK_ADJUSTED',
        },
        {
          userId: staffId,
          entityType: 'ProductVariant',
          entityId: 'same-variant',
          action: 'STOCK_ADJUSTED',
        },
      ],
    });
    const summaryPath = `/staff/${staffId}/summary`;
    await request(app.getHttpServer()).get(summaryPath).expect(401);
    await request(app.getHttpServer())
      .get(summaryPath)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    const result = await request(app.getHttpServer())
      .get(summaryPath)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(result.body.counts).toEqual({
      sales: 1,
      customers: 1,
      payments: 1,
      moneyIn: 1,
      moneyOut: 1,
      purchases: 0,
      suppliers: 0,
      adjustments: 2,
    });
    expect(result.body.lastWorkAt).not.toBeNull();
    expect(result.body.staff).not.toHaveProperty('passwordHash');
    const month = await request(app.getHttpServer())
      .get(summaryPath + '?period=month')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(month.body.counts.customers).toBe(0);
    expect(month.body.counts.sales).toBe(1);
    expect(month.body.period).toBe('month');
    await request(app.getHttpServer())
      .get(summaryPath + '?period=invalid')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(400);
    await request(app.getHttpServer())
      .get('/staff/missing/summary')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);
  });
  it('retains original document attribution after staff rename and deletion', async () => {
    const customer = await db.customer.create({ data: { name: 'Customer' } });
    const sale = await db.sale.create({
      data: {
        customerId: customer.id,
        invoiceNumber: 'TEST-1',
        status: 'COMPLETED',
      },
    });
    await db.$transaction((tx) =>
      appendActivity(tx, {
        action: 'SALE_CREATED',
        entityType: 'Sale',
        entityId: sale.id,
        actorId: staffId,
      }),
    );
    await ownerRequest('patch', `/staff/${staffId}`)
      .send({ ...staffInput(), name: 'Renamed Staff', password: undefined })
      .expect(200);
    await ownerRequest('delete', `/staff/${staffId}`).expect(200);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    await expect(
      auth.login('sales.staff', 'replacement-password'),
    ).rejects.toThrow();
    expect(await documentActor(db, 'Sale', sale.id, 'SALE_CREATED')).toBe(
      'Sales Person',
    );
    expect(
      (await new SalesService(db as PrismaService).details(sale.id))
        .creatorName,
    ).toBe('Sales Person');
    expect(await db.user.findUnique({ where: { id: staffId } })).toMatchObject({
      isActive: false,
    });
    await request(app.getHttpServer())
      .get('/staff')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200)
      .expect((r) => expect(r.body).toHaveLength(0));
  });
  it('disables staff immediately, reactivation does not restore old tokens, and logout revokes its token', async () => {
    const result = await ownerRequest('post', '/staff')
      .send({ ...staffInput(), username: 'status.staff' })
      .expect(201);
    const id = result.body.id;
    const original = (await auth.login('status.staff', 'initial-password'))
      .token;
    await ownerRequest('patch', `/staff/${id}`)
      .send({
        ...staffInput(),
        username: 'status.staff',
        password: undefined,
        isActive: false,
      })
      .expect(200);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${original}`)
      .expect(401);
    await expect(
      auth.login('status.staff', 'initial-password'),
    ).rejects.toThrow();
    await ownerRequest('patch', `/staff/${id}`)
      .send({
        ...staffInput(),
        username: 'status.staff',
        password: undefined,
        isActive: true,
      })
      .expect(200);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${original}`)
      .expect(401);
    const current = (await auth.login('status.staff', 'initial-password'))
      .token;
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${current}`)
      .expect(201);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${current}`)
      .expect(401);
    await ownerRequest('delete', `/staff/${id}`).expect(200);
  });
  it('serializes conflicting usernames without duplicate staff or successful audit events', async () => {
    const result = await Promise.all(
      [0, 1].map(() =>
        ownerRequest('post', '/staff').send({
          ...staffInput(),
          username: 'concurrent.staff',
        }),
      ),
    );
    expect(result.map((r) => r.status).sort()).toEqual([201, 409]);
    const created = result.find((r) => r.status === 201)!.body;
    expect(
      await db.user.count({ where: { username: 'concurrent.staff' } }),
    ).toBe(1);
    expect(
      await db.auditLog.count({
        where: { entityId: created.id, action: 'RECORD_CREATED' },
      }),
    ).toBe(1);
    await ownerRequest('delete', `/staff/${created.id}`).expect(200);
  });
  it('protects owner accounts and preserves unknown attribution for historical records', async () => {
    await ownerRequest('delete', `/staff/${ownerId}`).expect(403);
    await ownerRequest('patch', `/staff/${ownerId}`)
      .send(staffInput())
      .expect(403);
    expect(
      await documentActor(
        db,
        'Sale',
        'historical-without-actor',
        'SALE_CREATED',
      ),
    ).toBeNull();
  });
});
