import { Module } from '@nestjs/common';
import { ContainersController } from './containers.controller.js';
import { ContainersService } from './containers.service.js';
@Module({ controllers: [ContainersController], providers: [ContainersService] })
export class ContainersModule {}
