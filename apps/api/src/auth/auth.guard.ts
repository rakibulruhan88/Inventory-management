import { PrismaService } from '../prisma/prisma.service.js';
import { canAccessEndpoint } from './access-policy.js';
import { ForbiddenException } from '@nestjs/common';
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { AuthUser } from '@afia/contracts';
import type { Response } from 'express';
import { SESSION_COOKIE, sessionCookieOptions } from './session-options.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private reflector: Reflector,
    @Inject(JwtService) private jwt: JwtService,
    @Inject(PrismaService) private prisma: PrismaService,
  ) {}
  async canActivate(context: ExecutionContext) {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: AuthUser;
    }>();
    const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    const cookie = request.headers.cookie
      ?.split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith(`${SESSION_COOKIE}=`))
      ?.slice(SESSION_COOKIE.length + 1);
    const token = bearer || cookie;
    if (!token) throw new UnauthorizedException('Please sign in.');
    try {
      const verified = await this.jwt.verifyAsync<AuthUser & { exp?: number }>(token);
      if (context.getClass().name === 'StaffController' && context.switchToHttp().getRequest<{ method: string }>().method !== 'GET' && !bearer && request.headers['x-afia-staff'] !== '1')
        throw new ForbiddenException('Please use the signed-in staff form.');
      const current = await this.prisma.user.findUnique({ where: { id: verified.id } });
      if (!current?.isActive || current.deletedAt || (verified.sessionVersion ?? 0) !== current.sessionVersion)
        throw new UnauthorizedException('Please sign in with an active account.');
      request.user = { id: current.id, name: current.name, username: current.username, email: current.email, role: current.role, permissions: current.permissions as AuthUser['permissions'], sessionVersion: current.sessionVersion };
      if (!canAccessEndpoint(request.user, context.getClass().name, context.getHandler().name))
        throw new ForbiddenException('Your account does not have access to this action.');
      if (cookie && !bearer) {
        // Upgrade a still-valid old seven-day login without asking the user to log in again.
        const persistentToken = verified.exp === undefined ? token : await this.jwt.signAsync({
          id: verified.id,
          name: verified.name,
          username: verified.username,
          email: verified.email,
          role: current.role,
          sessionVersion: current.sessionVersion,
        } satisfies AuthUser);
        context.switchToHttp().getResponse<Response>().cookie(
          SESSION_COOKIE, persistentToken, sessionCookieOptions(),
        );
      }
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException(
        'Your session has expired. Please sign in again.',
      );
    }
  }
}
