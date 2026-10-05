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
import { IS_PUBLIC_KEY } from './public.decorator.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private reflector: Reflector,
    @Inject(JwtService) private jwt: JwtService,
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
      .find((x) => x.startsWith('afia_session='))
      ?.slice(13);
    const token = bearer || cookie;
    if (!token) throw new UnauthorizedException('Please sign in.');
    try {
      request.user = await this.jwt.verifyAsync<AuthUser>(token);
      return true;
    } catch {
      throw new UnauthorizedException(
        'Your session has expired. Please sign in again.',
      );
    }
  }
}
