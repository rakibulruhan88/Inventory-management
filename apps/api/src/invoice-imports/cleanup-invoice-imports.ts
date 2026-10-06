import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module.js';
import { InvoiceImportsModule } from './invoice-imports.module.js';
import { InvoiceImportsService } from './invoice-imports.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    PrismaModule,
    InvoiceImportsModule,
  ],
})
class CleanupModule {}
const app = await NestFactory.createApplicationContext(CleanupModule, {
  logger: ['error'],
});
try {
  console.log(await app.get(InvoiceImportsService).cleanupExpired());
} finally {
  await app.close();
}
