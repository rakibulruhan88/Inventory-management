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
export class FinanceAccessGuard implements CanActivate {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(ConfigService) private config: ConfigService,
  ) {}
  async canActivate(ctx: ExecutionContext) {
    const r = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user =
      r.user &&
      (await this.prisma.user.findFirst({
        where: { id: r.user.id, isActive: true },
        select: { id: true, role: true },
      }));
    if (!user)
      throw new UnauthorizedException('Please sign in with an active account.');
    if (r.method !== 'GET') {
      // Financial posting is owner-only until explicit granular permissions exist.
      if (user.role !== 'OWNER')
        throw new ForbiddenException(
          'Only the owner can save or void entries.',
        );
      if (r.headers['x-afia-finance'] !== '1')
        throw new ForbiddenException('Please reopen the form and try again.');
      if (!r.headers.authorization) {
        const origins = this.config
          .get<string>('WEB_ORIGIN', '')
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean);
        if (this.config.get('NODE_ENV') !== 'production')
          origins.push('http://localhost:5174', 'http://127.0.0.1:5174');
        if (!r.headers.origin || !origins.includes(r.headers.origin))
          throw new ForbiddenException(
            'Please use the store app to save entries.',
          );
      }
    }
    return true;
  }
}
