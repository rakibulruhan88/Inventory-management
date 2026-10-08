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
import type { AuthUser } from '@afia/contracts';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { FinanceAccessGuard } from './finance-access.guard.js';
import {
  FinanceEntryDto,
  FinanceQueryDto,
  VoidFinanceDto,
} from './finance.dto.js';
import { FinanceService } from './finance.service.js';
@Controller('finance')
@UseGuards(FinanceAccessGuard)
export class FinanceController {
  constructor(@Inject(FinanceService) private service: FinanceService) {}
  @Get() list(@Query() q: FinanceQueryDto) {
    return this.service.list(q);
  }
  @Get('entries/:id') detail(@Param('id') id: string) {
    return this.service.detail(id);
  }
  @Post('entries') create(
    @Body() input: FinanceEntryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.create(input, user.id);
  }
  @Post('entries/:id/void') void(
    @Param('id') id: string,
    @Body() input: VoidFinanceDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.void(id, input.reason, user.id);
  }
}
