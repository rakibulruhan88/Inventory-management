import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          status: 'ok',
          service: 'afia-inventory-api',
        });
      });
  });

  it('/inventory/items rejects unauthenticated access', () => {
    return request(app.getHttpServer())
      .get('/inventory/items?search=AL-101')
      .expect(401);
  });


  afterEach(async () => {
    await app.close();
  });
});
