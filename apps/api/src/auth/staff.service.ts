import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  expandPermissions,
  permissions,
  type StaffAccount,
  type StaffInput,
  type StaffWorkSummary,
} from '@afia/contracts';
import { hash } from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { auditMutation, appendActivity } from '../activity/activity-write.js';
import { Prisma } from '../generated/prisma/client.js';
const select = {
  id: true,
  name: true,
  username: true,
  email: true,
  isActive: true,
  permissions: true,
  createdAt: true,
  updatedAt: true,
} as const;
function present(u: {
  id: string;
  name: string;
  username: string | null;
  email: string | null;
  isActive: boolean;
  permissions: string[];
  createdAt: Date;
  updatedAt: Date;
}): StaffAccount {
  return {
    ...u,
    permissions: permissions.filter((p) => u.permissions.includes(p)),
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}
@Injectable()
export class StaffService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async list() {
    return (
      await this.prisma.user.findMany({
        where: { role: 'STAFF', deletedAt: null },
        select,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      })
    ).map(present);
  }
  async summary(
    id: string,
    period: 'all' | 'month',
  ): Promise<StaffWorkSummary> {
    const now = new Date();
    const dhaka = new Date(now.getTime() + 6 * 60 * 60 * 1000);
    const from =
      period === 'month'
        ? new Date(`${dhaka.toISOString().slice(0, 7)}-01T00:00:00+06:00`)
        : null;
    return this.prisma.$transaction(
      async (tx) => {
        const staff = await tx.user.findFirst({
          where: { id, role: 'STAFF', deletedAt: null },
          select,
        });
        if (!staff) throw new NotFoundException('Staff account not found.');
        const rows = await tx.$queryRaw<
          {
            entityType: string;
            action: string;
            type: string | null;
            count: bigint;
          }[]
        >(Prisma.sql`
        SELECT "entityType", action::text AS action, metadata->>'type' AS type,
          COUNT(DISTINCT CASE WHEN action::text = 'STOCK_ADJUSTED' THEN id ELSE "entityId" END) AS count
        FROM "AuditLog" WHERE "userId" = ${id} AND "createdAt" <= ${now}
          ${from ? Prisma.sql`AND "createdAt" >= ${from}` : Prisma.empty}
          AND action::text IN ('SALE_CREATED', 'RECORD_CREATED', 'CUSTOMER_PAYMENT_RECEIVED', 'PAYMENT_RECEIVED', 'FINANCIAL_ENTRY_CREATED', 'PURCHASE_RECEIVED', 'STOCK_ADJUSTED')
        GROUP BY "entityType", action::text, metadata->>'type'
      `);
        const counts: StaffWorkSummary['counts'] = {
          sales: 0,
          customers: 0,
          payments: 0,
          moneyIn: 0,
          moneyOut: 0,
          purchases: 0,
          suppliers: 0,
          adjustments: 0,
        };
        const latest = await tx.auditLog.findFirst({
          where: {
            userId: id,
            entityType: { not: 'User' },
            createdAt: { ...(from ? { gte: from } : {}), lte: now },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          select: { createdAt: true },
        });
        for (const row of rows) {
          let metric: keyof typeof counts | undefined;
          if (row.entityType === 'Sale' && row.action === 'SALE_CREATED')
            metric = 'sales';
          if (row.entityType === 'Customer' && row.action === 'RECORD_CREATED')
            metric = 'customers';
          if (
            ['CustomerPaymentReceipt', 'Payment'].includes(row.entityType) &&
            ['CUSTOMER_PAYMENT_RECEIVED', 'PAYMENT_RECEIVED'].includes(
              row.action,
            )
          )
            metric = 'payments';
          if (
            row.entityType === 'FinancialEntry' &&
            row.action === 'FINANCIAL_ENTRY_CREATED'
          ) {
            if (row.type === 'OTHER_IN') metric = 'moneyIn';
            else if (
              ['SUPPLIER_PAYMENT', 'EXPENSE', 'OTHER_OUT'].includes(
                row.type ?? '',
              )
            )
              metric = 'moneyOut';
          }
          if (
            row.entityType === 'Purchase' &&
            row.action === 'PURCHASE_RECEIVED'
          )
            metric = 'purchases';
          if (row.entityType === 'Supplier' && row.action === 'RECORD_CREATED')
            metric = 'suppliers';
          if (row.action === 'STOCK_ADJUSTED') metric = 'adjustments';
          if (metric) {
            counts[metric] += Number(row.count);
          }
        }
        return {
          staff: present(staff),
          period,
          from: from?.toISOString() ?? null,
          to: now.toISOString(),
          counts,
          lastWorkAt: latest?.createdAt.toISOString() ?? null,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async save(id: string | undefined, input: StaffInput, actorId: string) {
    const name = input.name.trim(),
      username = input.username.trim().toLowerCase();
    if (!name || !username || (!id && !input.password))
      throw new BadRequestException(
        'Name, username and initial password are required.',
      );
    if (input.password && Buffer.byteLength(input.password, 'utf8') > 72)
      throw new BadRequestException('Password must fit within 72 bytes.');
    const passwordHash = input.password
      ? await hash(input.password, 12)
      : undefined;
    try {
      const result = await auditMutation(
        this.prisma,
        {
          action: id ? 'RECORD_UPDATED' : 'RECORD_CREATED',
          entityType: 'User',
          entityId: id,
          actorId,
          metadata: { passwordReset: !!id && !!passwordHash },
        },
        async (tx) => {
          const actor = await tx.user.findUnique({ where: { id: actorId } });
          if (!actor?.isActive || actor.role !== 'OWNER')
            throw new ForbiddenException('Only the owner can manage staff.');
          if (id) {
            const target = await tx.user.findUnique({ where: { id } });
            if (!target || target.deletedAt)
              throw new NotFoundException('Staff account not found.');
            if (target.role !== 'STAFF' || id === actorId)
              throw new ForbiddenException(
                'Owner accounts cannot be changed here.',
              );
          }
          const conflict = await tx.user.findFirst({
            where: {
              OR: [
                { username: { equals: username, mode: 'insensitive' } },
                { email: { equals: username, mode: 'insensitive' } },
              ],
              ...(id ? { id: { not: id } } : {}),
            },
          });
          if (conflict)
            throw new ConflictException('That username is already in use.');
          const data = {
            name,
            username,
            isActive: input.isActive,
            permissions: expandPermissions(input.permissions),
          };
          const saved = await (id
            ? tx.user.update({
                where: { id },
                data: {
                  ...data,
                  ...(passwordHash ? { passwordHash } : {}),
                  sessionVersion: { increment: 1 },
                },
                select,
              })
            : tx.user.create({
                data: { ...data, passwordHash: passwordHash!, role: 'STAFF' },
                select,
              }));
          if (id && passwordHash)
            await appendActivity(tx, {
              action: 'PASSWORD_CHANGED',
              entityType: 'User',
              entityId: id,
              actorId,
              reason: 'Admin reset staff password.',
            });
          return saved;
        },
      );
      return present(result);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        throw new ConflictException('That username is already in use.');
      throw e;
    }
  }
  async remove(id: string, actorId: string) {
    await auditMutation(
      this.prisma,
      {
        action: 'RECORD_ARCHIVED',
        entityType: 'User',
        entityId: id,
        actorId,
        reason: 'Staff account deleted; business history retained.',
      },
      async (tx) => {
        const actor = await tx.user.findUnique({ where: { id: actorId } });
        if (!actor?.isActive || actor.role !== 'OWNER')
          throw new ForbiddenException('Only the owner can manage staff.');
        const target = await tx.user.findUnique({ where: { id } });
        if (!target || target.deletedAt)
          throw new NotFoundException('Staff account not found.');
        if (target.role !== 'STAFF' || id === actorId)
          throw new ForbiddenException('Owner accounts cannot be deleted.');
        return tx.user.update({
          where: { id },
          data: {
            isActive: false,
            deletedAt: new Date(),
            sessionVersion: { increment: 1 },
          },
        });
      },
    );
    return { deleted: true };
  }
}
