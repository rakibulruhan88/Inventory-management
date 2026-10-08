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
import type { InventoryItemSummary, InventorySummary } from '@afia/contracts';
import { InventoryService } from './inventory.service.js';
import {
  UpdateProductDto,
  UpdateVariantDto,
} from './dto/update-inventory.dto.js';
import { StockAdjustmentDto } from './dto/stock-adjustment.dto.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '@afia/contracts';

@Controller('inventory')
export class InventoryController {
  constructor(
    @Inject(InventoryService) private readonly inventory: InventoryService,
  ) {}

  @Get('summary')
  summary(): Promise<InventorySummary> {
    return this.inventory.summary();
  }

  @Get('items')
  items(@Query('search') search?: string): Promise<InventoryItemSummary[]> {
    return this.inventory.items(search);
  }

  @Patch('items/:id')
  updateProduct(@Param('id') id: string, @Body() input: UpdateProductDto, @CurrentUser() user: AuthUser) {
    return this.inventory.updateProduct(id, input, user.id);
  }

  @Delete('items/:id')
  archiveProduct(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.inventory.archiveProduct(id, user.id);
  }

  @Patch('variants/:id')
  updateVariant(@Param('id') id: string, @Body() input: UpdateVariantDto, @CurrentUser() user: AuthUser) {
    return this.inventory.updateVariant(id, input, user.id);
  }

  @Delete('variants/:id')
  archiveVariant(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.inventory.archiveVariant(id, user.id);
  }
  @Post('adjustments')
  adjust(@Body() input: StockAdjustmentDto, @CurrentUser() user: AuthUser) {
    return this.inventory.adjustStock(
      input.variantId,
      input.rollsChange,
      input.meterChange,
      input.reason,
      user.id,
    );
  }
}
