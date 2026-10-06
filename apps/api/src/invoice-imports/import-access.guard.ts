import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { AuthUser } from '@afia/contracts';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ImportAccessGuard implements CanActivate {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    const user =
      request.user &&
      (await this.prisma.user.findFirst({
        where: { id: request.user.id, isActive: true },
        select: { id: true },
      }));
    if (!user)
      throw new UnauthorizedException('Please sign in with an active account.');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      // Non-simple custom header forces browser preflight; also validate cookie-authenticated origins.
      if (request.headers['x-afia-invoice-import'] !== '1')
        throw new ForbiddenException(
          'Invoice import request could not be verified.',
        );
      if (!request.headers.authorization) {
        const origins = this.config
          .get<string>('WEB_ORIGIN', '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);
        if (this.config.get('NODE_ENV') !== 'production')
          origins.push('http://localhost:5174', 'http://127.0.0.1:5174');
        if (
          !request.headers.origin ||
          !origins.includes(request.headers.origin)
        )
          throw new ForbiddenException('Invoice import origin is not allowed.');
      }
    }
    return true;
  }
}
