import { hasPermission, type AuthUser } from '@afia/contracts';
import { CurrentUser } from '../auth/current-user.decorator.js';
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
import type { SupplierDetails, SupplierSummary } from '@afia/contracts';
import { CreateSupplierDto } from './dto/create-supplier.dto.js';
import { UpdateSupplierDto } from './dto/update-supplier.dto.js';
import { SuppliersService } from './suppliers.service.js';

@Controller('suppliers')
export class SuppliersController {
  constructor(
    @Inject(SuppliersService) private readonly suppliers: SuppliersService,
  ) {}

  @Get()
  search(
    @CurrentUser() user: AuthUser,
    @Query('search') search?: string,
  ): Promise<SupplierSummary[]> {
    return this.suppliers.search(search, hasPermission(user, 'finance.view'));
  }

  @Get(':id')
  details(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<SupplierDetails> {
    return this.suppliers.details(id, hasPermission(user, 'finance.view'));
  }

  @Post()
  create(
    @Body() input: CreateSupplierDto,
    @CurrentUser() user: AuthUser,
  ): Promise<SupplierSummary> {
    return this.suppliers.create(input, user.id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() input: UpdateSupplierDto,
    @CurrentUser() user: AuthUser,
  ): Promise<SupplierSummary> {
    return this.suppliers.update(id, input, user.id);
  }

  @Delete(':id')
  archive(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.suppliers.archive(id, user.id);
  }
}
