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
  @Patch(':id') update(@Param('id') id: string, @Body() input: ContainerDto) {
    return this.containers.update(id, input);
  }
  @Delete(':id') archive(@Param('id') id: string) {
    return this.containers.archive(id);
  }
}
