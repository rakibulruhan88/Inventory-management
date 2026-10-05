import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller.js';
import { SalesService } from './sales.service.js';
import { MailModule } from '../mail/mail.module.js';
@Module({
  imports: [MailModule],
  controllers: [SalesController],
  providers: [SalesService],
})
export class SalesModule {}
