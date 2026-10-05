import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { PurchasesModule } from './purchases/purchases.module.js';
import { SuppliersModule } from './suppliers/suppliers.module.js';
import { ProductsModule } from './products/products.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { ContainersModule } from './containers/containers.module.js';
import { SalesModule } from './sales/sales.module.js';
import { SearchModule } from './search/search.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AuthGuard } from './auth/auth.guard.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    PrismaModule,
    SuppliersModule,
    PurchasesModule,
    InventoryModule,
    ProductsModule,
    CustomersModule,
    ContainersModule,
    SalesModule,
    SearchModule,
    SettingsModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
