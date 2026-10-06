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

describe('ledger HTTP authorization and query validation', () => {
  let app: INestApplication;
  const sales = {
    ledger: vi
      .fn()
      .mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 }),
  };
  const customers = {
    account: vi.fn().mockResolvedValue({ name: 'Authorized customer' }),
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [SalesController, CustomersController],
      providers: [
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
  afterAll(async () => app?.close());
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
