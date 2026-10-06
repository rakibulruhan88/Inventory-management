import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import type { ReceivePurchaseResponse } from '@afia/contracts';
import { ReceivePurchaseDto } from './dto/receive-purchase.dto.js';
import { ImportAccessGuard } from '../invoice-imports/import-access.guard.js';
import { PurchasesService } from './purchases.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '@afia/contracts';
class ReversePurchaseDto {
  @IsString() @MinLength(2) reason: string;
}

@Controller('purchases')
export class PurchasesController {
  constructor(
    @Inject(PurchasesService) private readonly purchases: PurchasesService,
  ) {}

  @Get()
  list(@Query('search') search?: string) {
    return this.purchases.list(search);
  }

  @Get(':id') @UseGuards(ImportAccessGuard) get(@Param('id') id: string) {
    return this.purchases.get(id);
  }
  @Post('receive')
  receive(
    @Body() input: ReceivePurchaseDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ReceivePurchaseResponse> {
    return this.purchases.receive(input, user.id);
  }
  @Post(':id/reverse') reverse(
    @Param('id') id: string,
    @Body() input: ReversePurchaseDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.purchases.reverse(id, input.reason, user.id);
  }
}
