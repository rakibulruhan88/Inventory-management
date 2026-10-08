import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ActivityService } from './activity.service.js';
import { ActivityAccessGuard } from './activity-access.guard.js';
import { ActivityQueryDto } from './activity-query.dto.js';
@Controller('activity')
@UseGuards(ActivityAccessGuard)
export class ActivityController {
  constructor(
    @Inject(ActivityService) private readonly activity: ActivityService,
  ) {}
  @Get() list(
    @Query(
      new ValidationPipe({
        expectedType: ActivityQueryDto,
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    )
    query: ActivityQueryDto,
  ) {
    return this.activity.list(query);
  }
  @Get('options') options() {
    return this.activity.options();
  }
  @Get(':id') details(@Param('id') id: string) {
    return this.activity.details(id);
  }
}
