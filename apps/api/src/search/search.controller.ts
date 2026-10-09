import { CurrentUser } from '../auth/current-user.decorator.js';
import { canOpenPage, type AuthUser } from '@afia/contracts';
import { Controller, Get, Inject, Query } from '@nestjs/common';
import { SearchService } from './search.service.js';
@Controller('search')
export class SearchController {
  constructor(@Inject(SearchService) private readonly service: SearchService) {}
  @Get() async search(@CurrentUser() user: AuthUser, @Query('q') q?: string) {
    return (await this.service.search(q)).filter(result => canOpenPage(user, result.path));
  }
}
