import { auditMutation, appendActivity } from '../activity/activity-write.js';
import {
  ConflictException,
  Inject,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AuthUser } from '@afia/contracts';
import { compare, hash } from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(ConfigService) private config: ConfigService,
    @Inject(JwtService) private jwt: JwtService,
  ) {}
  async onModuleInit() {
    const password = this.config.get<string>('OWNER_BOOTSTRAP_PASSWORD');
    const username = this.config.get<string>('OWNER_BOOTSTRAP_USERNAME');
    if (!password || !username || (await this.prisma.user.count())) return;
    await this.prisma.user.create({
      data: {
        name: this.config.get('OWNER_NAME', 'Store Owner'),
        username: username.toLowerCase(),
        email: this.config.get<string>('OWNER_EMAIL')?.toLowerCase() || null,
        passwordHash: await hash(password, 12),
        role: 'OWNER',
      },
    });
  }
  async login(identifier: string, password: string) {
    const normalized = identifier.trim().toLowerCase();
    const user = await this.prisma.user.findFirst({
      where: {
        isActive: true,
        deletedAt: null,
        OR: [
          { username: { equals: normalized, mode: 'insensitive' } },
          { email: { equals: normalized, mode: 'insensitive' } },
        ],
      },
    });
    if (!user || !(await compare(password, user.passwordHash)))
      throw new UnauthorizedException('Incorrect username or password.');
    const payload: AuthUser = {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      role: user.role,
      permissions: user.permissions as AuthUser["permissions"],
      sessionVersion: user.sessionVersion,
    };
    const token = await this.jwt.signAsync(payload);
    await this.prisma.$transaction((tx) => appendActivity(tx, { action: 'SIGNED_IN', entityType: 'User', entityId: user.id, actorId: user.id, metadata: { label: user.name } }));
    return { user: payload, token };
  }

  async recordSignOut(userId: string) {
    await this.prisma.$transaction(async tx => { await tx.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } }); await appendActivity(tx, { action: 'SIGNED_OUT', entityType: 'User', entityId: userId, actorId: userId }); });
  }
  async account(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, username: true, email: true },
    });
    if (!user) throw new UnauthorizedException('Please sign in again.');
    return user;
  }

  async updateAccount(userId: string, email?: string) {
    const normalizedEmail = email?.trim().toLowerCase() || null;
    if (normalizedEmail) {
      const conflict = await this.prisma.user.findFirst({
        where: {
          email: { equals: normalizedEmail, mode: 'insensitive' },
          id: { not: userId },
        },
        select: { id: true },
      });
      if (conflict)
        throw new ConflictException(
          'That email is already used by another account.',
        );
    }
    return auditMutation(this.prisma, { action: 'RECORD_UPDATED', entityType: 'User', entityId: userId, actorId: userId }, async (tx) => {
    return tx.user.update({
      where: { id: userId },
      data: { email: normalizedEmail },
      select: { name: true, username: true, email: true },
    })
    });;
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !(await compare(currentPassword, user.passwordHash)))
      throw new UnauthorizedException('Current password is incorrect.');
    await auditMutation(this.prisma, { action: 'PASSWORD_CHANGED', entityType: 'User', entityId: userId, actorId: userId }, async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash: await hash(newPassword, 12), sessionVersion: { increment: 1 } },
    })
      return { passwordChanged: true };
    });;
    return { passwordChanged: true as const };
  }
}
