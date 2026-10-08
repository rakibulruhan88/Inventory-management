import { SalesLedgerQueryDto } from './ledger-query.dto.js';
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  ValidationPipe,
  StreamableFile,
} from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '@afia/contracts';
import { SalesService } from './sales.service.js';
import { CreateSaleDto } from './sale.dto.js';
import { createInvoicePdf, invoiceFileName } from '../mail/invoice-pdf.js';
class VoidSaleDto {
  @IsString() @MinLength(2) reason: string;
}
@Controller('sales')
export class SalesController {
  constructor(@Inject(SalesService) private readonly sales: SalesService) {}
  @Get() list(@Query('search') search?: string) {
    return this.sales.list(search);
  }
  @Get('ledger') ledger(
    @Query(
      new ValidationPipe({
        // tsx does not emit design:paramtypes; bind the DTO explicitly.
        expectedType: SalesLedgerQueryDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    query: SalesLedgerQueryDto,
  ) {
    return this.sales.ledger(query);
  }
  @Get(':id') details(@Param('id') id: string) {
    return this.sales.details(id);
  }
  @Get(':id/pdf') async pdf(@Param('id') id: string) {
    const invoice = await this.sales.details(id);
    const pdf = await createInvoicePdf(invoice);
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: `attachment; filename="${invoiceFileName(invoice)}"`,
    });
  }
  @Post() create(@Body(new ValidationPipe({
    expectedType: CreateSaleDto, transform: true, whitelist: true,
    forbidNonWhitelisted: true,
  })) input: CreateSaleDto, @CurrentUser() user: AuthUser) {
    return this.sales.create(input, user.id);
  }
  @Post(':id/email') email(@Param('id') id: string) {
    return this.sales.emailInvoice(id);
  }
  @Post(':id/void') void(
    @Param('id') id: string,
    @Body() input: VoidSaleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sales.void(id, input.reason, user.id);
  }
}
