import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(@Inject(ConfigService) config: ConfigService) {
    const connectionString = config.get<string>(
      'DATABASE_URL',
      'postgresql://afia:afia_local_password@localhost:5433/afia_inventory?schema=public',
    );

    super({ adapter: new PrismaPg(connectionString) });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
