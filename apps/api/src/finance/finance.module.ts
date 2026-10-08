import { Module } from '@nestjs/common';
import { FinanceController } from './finance.controller.js';
import { FinanceService } from './finance.service.js';
import { FinanceAccessGuard } from './finance-access.guard.js';
@Module({
  controllers: [FinanceController],
  providers: [FinanceService, FinanceAccessGuard],
})
export class FinanceModule {}
