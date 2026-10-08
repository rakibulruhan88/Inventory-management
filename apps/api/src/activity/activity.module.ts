import { Module } from '@nestjs/common';
import { ActivityController } from './activity.controller.js';
import { ActivityService } from './activity.service.js';
import { ActivityAccessGuard } from './activity-access.guard.js';
@Module({
  controllers: [ActivityController],
  providers: [ActivityService, ActivityAccessGuard],
})
export class ActivityModule {}
