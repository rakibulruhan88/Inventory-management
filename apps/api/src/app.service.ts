import { Injectable } from '@nestjs/common';
import type { HealthResponse } from '@afia/contracts';

@Injectable()
export class AppService {
  getHealth(): HealthResponse {
    return {
      status: 'ok',
      service: 'afia-inventory-api',
      timestamp: new Date().toISOString(),
    };
  }
}
