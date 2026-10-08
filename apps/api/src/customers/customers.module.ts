import { PaymentsController } from './payments.controller.js';
import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';
@Module({
  controllers: [CustomersController, PaymentsController],
  providers: [CustomersService],
})
export class CustomersModule {}
