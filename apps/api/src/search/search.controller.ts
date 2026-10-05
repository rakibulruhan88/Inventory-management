import { Controller, Get, Inject, Query } from '@nestjs/common';
import { SearchService } from './search.service.js';
@Controller('search')
export class SearchController {
  constructor(@Inject(SearchService) private readonly service: SearchService) {}
  @Get() search(@Query('q') q?: string) {
    return this.service.search(q);
  }
}
