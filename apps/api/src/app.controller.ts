import { Controller, Get, Inject } from '@nestjs/common';
import type { HealthResponse } from '@afia/contracts';
import { AppService } from './app.service.js';
import { Public } from './auth/public.decorator.js';

@Controller()
export class AppController {
  constructor(@Inject(AppService) private readonly appService: AppService) {}

  @Get('health')
  @Public()
  getHealth(): HealthResponse {
    return this.appService.getHealth();
  }
}
