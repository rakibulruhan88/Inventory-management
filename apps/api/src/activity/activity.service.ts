import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ActivityPage,
  ActivityQuery,
  ActivityOptions,
} from '@afia/contracts';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  actionLabels,
  presentActivity,
  presentActivityDetail,
  type ActivityRecord,
} from './activity-presentation.js';

const source = Prisma.sql`SELECT a.*, u.name AS "actorCurrentName", u.role::text AS "actorCurrentRole",
CASE WHEN a."entityType" = 'Sale' THEN 'Sales' WHEN a."entityType" = 'Purchase' THEN 'Purchases'
WHEN a."entityType" IN ('Product','ProductVariant') THEN 'Stock'
WHEN a."entityType" IN ('Payment','CustomerPaymentReceipt','CustomerOpeningBalance','FinancialEntry') THEN 'Payments'
WHEN a."entityType" = 'Customer' THEN 'Customers' WHEN a."entityType" = 'Supplier' THEN 'Suppliers'
WHEN a."entityType" = 'Container' THEN 'Containers' WHEN a."entityType" = 'StoreSettings' THEN 'Settings'
WHEN a."entityType" = 'InvoiceImportDraft' THEN 'Imports' ELSE 'Account' END AS category,
COALESCE(a.metadata->>'reference', s."invoiceNumber", p."purchaseNumber", r."receiptNumber", c."containerNumber", pr."itemCode", a."entityId") AS reference,
COALESCE(a.metadata->>'label', s."customerNameSnapshot", cus.name, sup.name, pr."itemCode", v.color, c."containerNumber", '') AS label
FROM "AuditLog" a LEFT JOIN "User" u ON u.id = a."userId"
LEFT JOIN "Sale" s ON a."entityType" = 'Sale' AND s.id = a."entityId"
LEFT JOIN "Purchase" p ON a."entityType" = 'Purchase' AND p.id = a."entityId"
LEFT JOIN "CustomerPaymentReceipt" r ON a."entityType" = 'CustomerPaymentReceipt' AND r.id = a."entityId"
LEFT JOIN "Customer" cus ON a."entityType" = 'Customer' AND cus.id = a."entityId"
LEFT JOIN "Supplier" sup ON a."entityType" = 'Supplier' AND sup.id = a."entityId"
LEFT JOIN "Container" c ON a."entityType" = 'Container' AND c.id = a."entityId"
LEFT JOIN "Product" pr ON a."entityType" = 'Product' AND pr.id = a."entityId"
LEFT JOIN "ProductVariant" v ON a."entityType" = 'ProductVariant' AND v.id = a."entityId"`;
export function activityDate(value: string, end = false) {
  const date = new Date(`${value}T00:00:00+06:00`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(date.getTime()) ||
    new Date(date.getTime() + 21600000).toISOString().slice(0, 10) !== value
  )
    throw new BadRequestException('Choose a valid date.');
  return end ? new Date(date.getTime() + 86400000) : date;
}
export function activityWhere(q: ActivityQuery) {
  const terms: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (q.action && !Object.hasOwn(actionLabels, q.action))
    throw new BadRequestException('Choose a valid action.');
  if (q.category) terms.push(Prisma.sql`category = ${q.category}`);
  if (q.action) terms.push(Prisma.sql`action::text = ${q.action}`);
  if (q.actorId) terms.push(Prisma.sql`"userId" = ${q.actorId}`);
  if (q.from) terms.push(Prisma.sql`"createdAt" >= ${activityDate(q.from)}`);
  if (q.to) terms.push(Prisma.sql`"createdAt" < ${activityDate(q.to, true)}`);
  if (q.from && q.to && q.from > q.to)
    throw new BadRequestException('End date must be on or after Start date.');
  if (q.search?.trim()) {
    const search = '%' + q.search.trim().replace(/[\\%_]/g, '\\$&') + '%';
    terms.push(
      Prisma.sql`concat_ws(' ', action::text, "entityType", "entityId", reference, label, reason, "actorCurrentName", metadata::text) ILIKE ${search}`,
    );
  }
  return Prisma.join(terms, ' AND ');
}
@Injectable()
export class ActivityService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async list(q: ActivityQuery): Promise<ActivityPage> {
    const where = activityWhere(q),
      page = q.page ?? 1,
      pageSize = q.pageSize ?? 25;
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<ActivityRecord[]>(
          Prisma.sql`SELECT * FROM (${source}) events WHERE ${where} ORDER BY "createdAt" ${q.sort === 'oldest' ? Prisma.sql`ASC` : Prisma.sql`DESC`}, id ASC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
        );
        const [summary] = await tx.$queryRaw<
          {
            total: bigint;
            changes: bigint;
            reversals: bigint;
            people: bigint;
          }[]
        >(
          Prisma.sql`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE action::text IN ('RECORD_UPDATED','STOCK_ADJUSTED','PASSWORD_CHANGED')) AS changes, COUNT(*) FILTER (WHERE action::text IN ('SALE_VOIDED','PURCHASE_REVERSED','FINANCIAL_ENTRY_VOIDED','RECORD_ARCHIVED')) AS reversals, COUNT(DISTINCT "userId") AS people FROM (${source}) events WHERE ${where}`,
        );
        const total = Number(summary.total);
        return {
          items: rows.map(presentActivity),
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
          summary: {
            total,
            changes: Number(summary.changes),
            reversals: Number(summary.reversals),
            people: Number(summary.people),
          },
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async details(id: string) {
    const [row] = await this.prisma.$queryRaw<ActivityRecord[]>(
      Prisma.sql`SELECT * FROM (${source}) events WHERE id = ${id}`,
    );
    if (!row) throw new NotFoundException('Activity not found.');
    return presentActivityDetail(row);
  }
  async options(): Promise<ActivityOptions> {
    const actors = await this.prisma.user.findMany({
      where: { auditLogs: { some: {} } },
      select: { id: true, name: true, role: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return {
      actors,
      actions: Object.entries(actionLabels).map(([value, label]) => ({
        value,
        label,
      })),
    };
  }
}
