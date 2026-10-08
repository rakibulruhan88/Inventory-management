import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthUser } from '@afia/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
@Injectable()
export class ActivityAccessGuard implements CanActivate {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async canActivate(context: ExecutionContext) {
    const { user } = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const current =
      user &&
      (await this.prisma.user.findFirst({
        where: { id: user.id, isActive: true },
        select: { role: true },
      }));
    if (!current)
      throw new UnauthorizedException('Please sign in with an active account.');
    if (current.role !== 'OWNER')
      throw new ForbiddenException('Only the owner can view Activity.');
    return true;
  }
}
