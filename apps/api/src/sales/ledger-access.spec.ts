import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AuthGuard } from '../auth/auth.guard.js';
import { SalesController } from './sales.controller.js';
import { SalesService } from './sales.service.js';
import { CustomersController } from '../customers/customers.controller.js';
import { CustomersService } from '../customers/customers.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('ledger HTTP authorization and query validation', () => {
  let app: INestApplication;
  const sales = {
    ledger: vi
      .fn()
      .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 }),
  };
  const tx = {
    customer: {
      findUnique: vi
        .fn()
        .mockResolvedValue({
          id: 'c1',
          name: 'Authorized customer',
          phone: null,
          email: null,
          address: null,
        }),
    },
    customerOpeningBalance: {findUnique: vi.fn().mockResolvedValue(null)},
    sale: {
      aggregate: vi
        .fn()
        .mockResolvedValue({ _sum: { totalAmount: 100, paidAmount: 25 } }),
    },
    payment: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn(async (query: { take: number; skip: number }) => {
        // Fail the HTTP regression if a string ever reaches Prisma pagination.
        expect(typeof query.take).toBe('number');
        expect(typeof query.skip).toBe('number');
        expect(Number.isInteger(query.take)).toBe(true);
        expect(Number.isInteger(query.skip)).toBe(true);
        return [];
      }),
    },
    $queryRaw: vi.fn(async (query: { text: string; values: unknown[] }) => {
      if (query.text.includes('AS sales')) return [{customerId: 'c1', sales: 100, paid: 25, due: 75}];
      if (query.text.includes('COUNT(*)')) return [{ total: 0n }];
      // Also verify numeric LIMIT/OFFSET parameters for both invoice histories.
      expect(
        query.values
          .slice(-2)
          .every(
            (value) => typeof value === 'number' && Number.isInteger(value),
          ),
      ).toBe(true);
      return [];
    }),
  };
  const prisma = {
    $transaction: async (read: (client: typeof tx) => unknown) => read(tx),
  };
  const customers = new CustomersService(prisma as unknown as PrismaService);
  vi.spyOn(customers, 'account');
  const accountMetadata = Reflect.getMetadata(
    'design:paramtypes',
    CustomersController.prototype,
    'account',
  );
  const ledgerMetadata = Reflect.getMetadata(
    'design:paramtypes',
    SalesController.prototype,
    'ledger',
  );
  beforeAll(async () => {
    // Reproduce the tsx start/dev runtime, which omits this metadata.
    Reflect.deleteMetadata(
      'design:paramtypes',
      CustomersController.prototype,
      'account',
    );
    Reflect.deleteMetadata(
      'design:paramtypes',
      SalesController.prototype,
      'ledger',
    );
    const module = await Test.createTestingModule({
      controllers: [SalesController, CustomersController],
      providers: [
        { provide: PrismaService, useValue: { ...prisma, user: { findUnique: vi.fn().mockResolvedValue({ id: 'user', name: 'Staff', role: 'STAFF', isActive: true, deletedAt: null, sessionVersion: 0, permissions: ['sales.view', 'customers.view'] }) } } },
        { provide: SalesService, useValue: sales },
        { provide: CustomersService, useValue: customers },
        {
          provide: JwtService,
          useValue: {
            verifyAsync: async (token: string) => {
              if (token !== 'valid-session') throw new Error('Invalid');
              return { id: 'user', role: 'STAFF' };
            },
          },
        },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    if (accountMetadata)
      Reflect.defineMetadata(
        'design:paramtypes',
        accountMetadata,
        CustomersController.prototype,
        'account',
      );
    if (ledgerMetadata)
      Reflect.defineMetadata(
        'design:paramtypes',
        ledgerMetadata,
        SalesController.prototype,
        'ledger',
      );
  });
  beforeEach(() => vi.clearAllMocks());
  it.each(['/sales/ledger', '/customers/c1/account'])(
    'requires a valid session for %s',
    async (path) => {
      await request(app.getHttpServer()).get(path).expect(401);
      await request(app.getHttpServer())
        .get(path)
        .set('Authorization', 'Bearer invalid')
        .expect(401);
      expect(sales.ledger).not.toHaveBeenCalled();
      expect(customers.account).not.toHaveBeenCalled();
    },
  );
  it('allows an authorized customer account read with validated pagination', async () => {
    await request(app.getHttpServer())
      .get('/customers/c1/account?page=2&pageSize=10')
      .set('Cookie', 'afia_session=valid-session')
      .expect(200);
    expect(customers.account).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ page: 2, pageSize: 10 }),
    );
  });
  it('routes ledger queries before :id and accepts combined validated filters', async () => {
    await request(app.getHttpServer())
      .get(
        '/sales/ledger?customer=Rahim&status=PARTIAL&method=CASH&minTotal=100&maxDue=200&page=2',
      )
      .set('Authorization', 'Bearer valid-session')
      .expect(200);
    expect(sales.ledger).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'Rahim',
        status: 'PARTIAL',
        method: 'CASH',
        minTotal: 100,
        maxDue: 200,
        page: 2,
        pageSize: 25,
      }),
    );
  });
  it.each([
    ['', 1, 25, 0],
    ['?page=1&pageSize=25', 1, 25, 0],
    ['?page=3&pageSize=100', 3, 100, 200],
  ] as const)(
    'customer pagination succeeds with numeric Prisma arguments: %s',
    async (query, page, pageSize, skip) => {
      const response = await request(app.getHttpServer())
        .get(`/customers/c1/account${query}`)
        .set('Authorization', 'Bearer valid-session')
        .expect(200);
      expect(customers.account).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ page, pageSize }),
      );
      expect(tx.$queryRaw).toHaveBeenCalled();
      expect(skip).toBe((page - 1) * pageSize);
      expect(response.body).toMatchObject({
        totalSales: 100,
        totalPaid: 25,
        totalDue: 75,
        payments: { page, pageSize },
      });
    },
  );
  it.each([
    ['', 1, 25],
    ['?page=1&pageSize=25', 1, 25],
    ['?page=2&pageSize=100', 2, 100],
  ] as const)(
    'sales pagination transforms the complete DTO without parameter metadata: %s',
    async (query, page, pageSize) => {
      await request(app.getHttpServer())
        .get(`/sales/ledger${query}`)
        .set('Authorization', 'Bearer valid-session')
        .expect(200);
      expect(sales.ledger).toHaveBeenCalledWith(
        expect.objectContaining({ page, pageSize }),
      );
      const dto = sales.ledger.mock.calls[0][0];
      expect(typeof dto.page).toBe('number');
      expect(typeof dto.pageSize).toBe('number');
    },
  );
  it.each(['/customers/c1/account', '/sales/ledger'])(
    'rejects invalid pagination before service/Prisma: %s',
    async (path) => {
      for (const query of [
        'page=abc',
        'pageSize=test',
        'page=0',
        'page=-1',
        'page=1.5',
        'pageSize=-1',
        'pageSize=0',
        'pageSize=1.5',
        'pageSize=101',
        'page=1000001',
      ]) {
        const response = await request(app.getHttpServer())
          .get(`${path}?${query}`)
          .set('Authorization', 'Bearer valid-session')
          .expect(400);
        expect(response.body.statusCode).toBe(400);
        expect(Array.isArray(response.body.message)).toBe(true);
      }
      expect(customers.account).not.toHaveBeenCalled();
      expect(sales.ledger).not.toHaveBeenCalled();
      expect(tx.payment.findMany).not.toHaveBeenCalled();
      expect(tx.$queryRaw).not.toHaveBeenCalled();
    },
  );
  it.each([
    '/sales/ledger?pageSize=1000',
    '/sales/ledger?sort=invalid',
    '/sales/ledger?minDue=-1',
    '/sales/ledger?unknown=field',
    '/customers/c1/account?page=0',
  ])('rejects malformed or unbounded queries: %s', async (path) => {
    await request(app.getHttpServer())
      .get(path)
      .set('Authorization', 'Bearer valid-session')
      .expect(400);
    expect(sales.ledger).not.toHaveBeenCalled();
    expect(customers.account).not.toHaveBeenCalled();
  });
});
