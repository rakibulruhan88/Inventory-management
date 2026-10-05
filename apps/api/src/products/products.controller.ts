import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { ProductSearchResult } from '@afia/contracts';
import { ProductsService } from './products.service.js';

@Controller('products')
export class ProductsController {
  constructor(
    @Inject(ProductsService) private readonly products: ProductsService,
  ) {}

  @Get()
  search(@Query('search') search?: string): Promise<ProductSearchResult[]> {
    return this.products.search(search);
  }
}
