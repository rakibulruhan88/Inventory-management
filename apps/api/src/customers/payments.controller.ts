import { Controller, Get, Inject, Query, ValidationPipe } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { LedgerPageDto } from '../sales/ledger-query.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { readCustomersWithDue, readGlobalReceipts } from './payments-ledger.js';
export class PaymentListDto extends LedgerPageDto {
  @IsOptional() @IsString() @MaxLength(200) search?: string;
}
const queryPipe = new ValidationPipe({
  expectedType: PaymentListDto,
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});
@Controller('payments')
export class PaymentsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  @Get('outstanding-customers') outstanding(
    @Query(queryPipe) query: PaymentListDto,
  ) {
    return readCustomersWithDue(this.prisma, query);
  }
  @Get('receipts') receipts(@Query(queryPipe) query: PaymentListDto) {
    return readGlobalReceipts(this.prisma, query);
  }
}
