import { Body, Controller, Get, Inject, Put } from '@nestjs/common';
import { SettingsDto } from './settings.dto.js';
import { SettingsService } from './settings.service.js';
@Controller('settings')
export class SettingsController {
  constructor(
    @Inject(SettingsService) private readonly service: SettingsService,
  ) {}
  @Get() get() {
    return this.service.get();
  }
  @Put() update(@Body() input: SettingsDto) {
    return this.service.update(input);
  }
}
