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
  search(@Query('search') search?: string): Promise<SupplierSummary[]> {
    return this.suppliers.search(search);
  }

  @Get(':id')
  details(@Param('id') id: string): Promise<SupplierDetails> {
    return this.suppliers.details(id);
  }

  @Post()
  create(@Body() input: CreateSupplierDto): Promise<SupplierSummary> {
    return this.suppliers.create(input);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() input: UpdateSupplierDto,
  ): Promise<SupplierSummary> {
    return this.suppliers.update(id, input);
  }

  @Delete(':id')
  archive(@Param('id') id: string) {
    return this.suppliers.archive(id);
  }
}
