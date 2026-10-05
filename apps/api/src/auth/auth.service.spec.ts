import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { validate } from 'class-validator';
import { UpdateAccountDto } from './auth.controller.js';
import { AuthService } from './auth.service.js';

describe('owner authentication', () => {
  it('rejects an invalid account email', async () => {
    const input = Object.assign(new UpdateAccountDto(), {
      email: 'not-an-email',
    });
    expect(await validate(input)).not.toHaveLength(0);
  });
  it('accepts a valid password and never returns its hash', async () => {
    const passwordHash = await hash('correct-horse', 4);
    const prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'owner',
          name: 'Owner',
          username: 'owner',
          email: null,
          role: 'OWNER',
          passwordHash,
          isActive: true,
        }),
      },
    };
    const jwt = { signAsync: vi.fn().mockResolvedValue('signed-token') };
    const service = new AuthService(prisma as never, {} as never, jwt as never);
    const result = await service.login('OWNER', 'correct-horse');
    expect(result).toMatchObject({
      user: { id: 'owner', username: 'owner' },
      token: 'signed-token',
    });
    expect(JSON.stringify(result)).not.toContain(passwordHash);
  });

  it('rejects an invalid password', async () => {
    const passwordHash = await hash('correct-horse', 4);
    const prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'owner',
          name: 'Owner',
          username: 'owner',
          email: null,
          role: 'OWNER',
          passwordHash,
          isActive: true,
        }),
      },
    };
    const service = new AuthService(
      prisma as never,
      {} as never,
      { signAsync: vi.fn() } as never,
    );
    await expect(
      service.login('owner', 'wrong-password'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('normalizes and updates the authenticated owner email', async () => {
    const prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({
          name: 'Owner',
          username: 'owner',
          email: 'owner@example.com',
        }),
      },
    };
    const service = new AuthService(prisma as never, {} as never, {} as never);
    await expect(
      service.updateAccount('owner-id', ' OWNER@EXAMPLE.COM '),
    ).resolves.toMatchObject({
      email: 'owner@example.com',
    });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { email: 'owner@example.com' } }),
    );
  });

  it('rejects an email belonging to another user', async () => {
    const prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue({ id: 'other' }),
      },
    };
    const service = new AuthService(prisma as never, {} as never, {} as never);
    await expect(
      service.updateAccount('owner-id', 'used@example.com'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('keeps username and email login available after an email update', async () => {
    const passwordHash = await hash('correct-horse', 4);
    const prisma = {
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'owner',
          name: 'Owner',
          username: 'owner',
          email: 'owner@example.com',
          role: 'OWNER',
          passwordHash,
          isActive: true,
        }),
      },
    };
    const service = new AuthService(
      prisma as never,
      {} as never,
      { signAsync: vi.fn().mockResolvedValue('token') } as never,
    );
    await service.login('owner', 'correct-horse');
    await service.login('OWNER@EXAMPLE.COM', 'correct-horse');
    expect(prisma.user.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { username: { equals: 'owner', mode: 'insensitive' } },
            { email: { equals: 'owner', mode: 'insensitive' } },
          ],
        }),
      }),
    );
    expect(prisma.user.findFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            {
              username: { equals: 'owner@example.com', mode: 'insensitive' },
            },
            { email: { equals: 'owner@example.com', mode: 'insensitive' } },
          ],
        }),
      }),
    );
  });

  it('requires the current password before changing it', async () => {
    const passwordHash = await hash('correct-horse', 4);
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 'owner', passwordHash }),
        update: vi.fn(),
      },
    };
    const service = new AuthService(prisma as never, {} as never, {} as never);
    await expect(
      service.changePassword('owner', 'wrong-password', 'new-password'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('hashes a valid new password so the old password stops working', async () => {
    const passwordHash = await hash('correct-horse', 4);
    let savedHash = passwordHash;
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ id: 'owner', passwordHash }),
        update: vi.fn().mockImplementation(({ data }) => {
          savedHash = data.passwordHash;
          return { id: 'owner' };
        }),
      },
    };
    const service = new AuthService(prisma as never, {} as never, {} as never);
    await service.changePassword('owner', 'correct-horse', 'new-password');
    expect(await compare('correct-horse', savedHash)).toBe(false);
    expect(await compare('new-password', savedHash)).toBe(true);
  });
});
