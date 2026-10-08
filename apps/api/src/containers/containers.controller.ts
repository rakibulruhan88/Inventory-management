import type { AuthUser } from '@afia/contracts';
import { CurrentUser } from '../auth/current-user.decorator.js';
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { ContainerDto } from './container.dto.js';
import { ContainersService } from './containers.service.js';
@Controller('containers')
export class ContainersController {
  constructor(
    @Inject(ContainersService) private readonly containers: ContainersService,
  ) {}
  @Get() list(@Query('search') search?: string) {
    return this.containers.list(search);
  }
  @Patch(':id') update(@Param('id') id: string, @Body() input: ContainerDto, @CurrentUser() user: AuthUser) {
    return this.containers.update(id, input, user.id);
  }
  @Delete(':id') archive(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.containers.archive(id, user.id);
  }
}
