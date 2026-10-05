import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
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
  @Get(':id') details(@Param('id') id: string) {
    return this.customers.details(id);
  }
  @Post() create(@Body() input: CustomerDto) {
    return this.customers.create(input);
  }
  @Patch(':id') update(@Param('id') id: string, @Body() input: CustomerDto) {
    return this.customers.update(id, input);
  }
  @Post(':id/payments') payment(
    @Param('id') id: string,
    @Body() input: PaymentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.customers.receivePayment(
      id,
      input.amount,
      input.method,
      input.reference,
      input.notes,
      user.id,
    );
  }
  @Delete(':id') archive(@Param('id') id: string) {
    return this.customers.archive(id);
  }
}
