import { OpeningDueDto, CustomerWithOpeningDueDto } from './opening-due.dto.js';
import { LedgerPageDto } from '../sales/ledger-query.dto.js';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  ForbiddenException,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  ValidationPipe,
} from '@nestjs/common';
import { CustomerDto } from './customer.dto.js';
import { CustomersService } from './customers.service.js';
import { PaymentDto } from './payment.dto.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '@afia/contracts';
@Controller('customers')
export class CustomersController {
  constructor(
    @Inject(CustomersService) private readonly customers: CustomersService,
  ) {}
  @Get() list(@Query('search') search?: string) {
    return this.customers.list(search);
  }
  @Get(':id/account') account(
    @Param('id') id: string,
    @Query(
      new ValidationPipe({
        // tsx does not emit design:paramtypes; bind the DTO explicitly.
        expectedType: LedgerPageDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    query: LedgerPageDto,
  ) {
    return this.customers.account(id, query);
  }
  @Get(':id/payment-context') paymentContext(@Param('id') id: string) {
    return this.customers.paymentContext(id);
  }
  @Get(':id/payment-receipts/:receiptId') receipt(
    @Param('id') id: string,
    @Param('receiptId') receiptId: string,
  ) {
    return this.customers.receipt(id, receiptId);
  }
  @Get(':id') details(@Param('id') id: string) {
    return this.customers.details(id);
  }
  @Post() create(
    @Body(
      new ValidationPipe({
        expectedType: CustomerDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    input: CustomerDto,
  ) {
    return this.customers.create(input);
  }
  @Post('with-opening-due') createWithOpeningDue(
    @Body(
      new ValidationPipe({
        expectedType: CustomerWithOpeningDueDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        exceptionFactory: () =>
          new BadRequestException(
            'Check the customer, Opening Due and Balance Date.',
          ),
      }),
    )
    input: CustomerWithOpeningDueDto,
    @CurrentUser() user: AuthUser,
    @Headers('authorization') authorization?: string,
    @Headers('x-afia-payment') header?: string,
  ) {
    requirePaymentHeader(authorization, header);
    return this.customers.createWithOpeningDue(input, user.id);
  }
  @Post(':id/opening-due') openingDue(
    @Param('id') id: string,
    @Body(
      new ValidationPipe({
        expectedType: OpeningDueDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        exceptionFactory: () =>
          new BadRequestException(
            'Check the Opening Due amount and Balance Date.',
          ),
      }),
    )
    input: OpeningDueDto,
    @CurrentUser() user: AuthUser,
    @Headers('authorization') authorization?: string,
    @Headers('x-afia-payment') header?: string,
  ) {
    requirePaymentHeader(authorization, header);
    return this.customers.addOpeningDue(id, input, user.id);
  }
  @Patch(':id') update(
    @Param('id') id: string,
    @Body(
      new ValidationPipe({
        expectedType: CustomerDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    input: CustomerDto,
  ) {
    return this.customers.update(id, input);
  }
  @Post(':id/payments') payment(
    @Param('id') id: string,
    @Body(
      new ValidationPipe({
        expectedType: PaymentDto,
        exceptionFactory: () =>
          new BadRequestException('Check the payment details and try again.'),
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    input: PaymentDto,
    @CurrentUser() user: AuthUser,
    @Headers('authorization') authorization?: string,
    @Headers('x-afia-payment') paymentHeader?: string,
  ) {
    // Cookie-authenticated submissions require a non-simple header, enforced by
    // the API's existing strict CORS origin allowlist; HTML forms cannot send it.
    if (
      !/^Bearer\s+\S+$/i.test(authorization ?? '') &&
      paymentHeader !== 'receive-payment'
    )
      throw new ForbiddenException(
        'Submit payments through the signed-in payment form.',
      );
    return this.customers.receivePayment(id, input, user.id);
  }
  @Delete(':id') archive(@Param('id') id: string) {
    return this.customers.archive(id);
  }
}

function requirePaymentHeader(authorization?: string, header?: string) {
  if (
    !/^Bearer\s+\S+$/i.test(authorization ?? '') &&
    header !== 'receive-payment'
  )
    throw new ForbiddenException('Please use the signed-in payment form.');
}
