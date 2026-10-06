import { ImportAccessGuard } from '../invoice-imports/import-access.guard.js';
import { Module } from '@nestjs/common';
import { PurchasesController } from './purchases.controller.js';
import { PurchasesService } from './purchases.service.js';

@Module({
  controllers: [PurchasesController],
  providers: [PurchasesService, ImportAccessGuard],
  exports: [PurchasesService],
})
export class PurchasesModule {}
