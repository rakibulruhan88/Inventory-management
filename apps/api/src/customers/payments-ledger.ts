import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type {
  PaymentListQuery,
  OutstandingCustomersPage,
  LedgerPage,
  ReceiptLedgerRow,
} from '@afia/contracts';
import { normalizeText } from '../common/normalize.js';
import { customerPhoneSearch } from './customer-identity.js';
import { accountSourcesSql } from './account-balances.js';
const searchPattern = (term: string) => `%${term.replace(/[\\%_]/g, '\\$&')}%`;
export async function readCustomersWithDue(
  prisma: PrismaService,
  query: PaymentListQuery,
): Promise<OutstandingCustomersPage> {
  const page = query.page ?? 1,
    pageSize = query.pageSize ?? 25;
  const term = normalizeText(query.search),
    phone = customerPhoneSearch(term);
  const filter = term
    ? Prisma.sql`AND (c.name ILIKE ${searchPattern(term)} OR c.phone ILIKE ${searchPattern(term)} ${phone ? Prisma.sql`OR c."normalizedPhone" = ${phone}` : Prisma.empty})`
    : Prisma.empty;
  const cte = Prisma.sql`WITH sources AS (${accountSourcesSql}), positive AS (SELECT * FROM sources WHERE due > 0),
 totals AS (SELECT "customerId", SUM(due) AS due FROM positive GROUP BY "customerId"),
 oldest AS (SELECT DISTINCT ON ("customerId") * FROM positive ORDER BY "customerId", date, "createdAt", id, kind),
 last_sale AS (SELECT "customerId", MAX("soldAt") AS date FROM "Sale" WHERE status = 'COMPLETED' GROUP BY "customerId"),
 matched AS (SELECT c.id, c.name, c.phone, t.due, o.id AS "sourceId", o.kind, o."invoiceNumber", o.date AS "dueDate", l.date AS "lastSoldAt"
 FROM "Customer" c JOIN totals t ON t."customerId" = c.id JOIN oldest o ON o."customerId" = c.id
 LEFT JOIN last_sale l ON l."customerId" = c.id WHERE c."archivedAt" IS NULL ${filter})`;
  return prisma.$transaction(
    async (tx) => {
      const count = await tx.$queryRaw<
        { total: bigint; amount: Prisma.Decimal }[]
      >(
        Prisma.sql`${cte} SELECT COUNT(*) AS total, COALESCE(SUM(due), 0) AS amount FROM matched`,
      );
      const rows = await tx.$queryRaw<
        {
          id: string;
          name: string;
          phone: string | null;
          due: Prisma.Decimal;
          sourceId: string;
          kind: 'SALE' | 'OPENING';
          invoiceNumber: string | null;
          dueDate: Date;
          lastSoldAt: Date | null;
        }[]
      >(
        Prisma.sql`${cte} SELECT * FROM matched ORDER BY due DESC, name ASC, id ASC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      );
      return {
        page,
        pageSize,
        total: Number(count[0].total),
        totalOutstanding: Number(count[0].amount),
        items: rows.map((r) => ({
          id: r.id,
          name: r.name,
          phone: r.phone,
          totalDue: Number(r.due),
          oldestDueInvoice: {
            id: r.sourceId,
            invoiceNumber: r.invoiceNumber,
            soldAt: r.dueDate.toISOString(),
            sourceKind: r.kind,
          },
          lastSoldAt: r.lastSoldAt?.toISOString() ?? null,
        })),
      };
    },
    { isolationLevel: 'RepeatableRead' },
  );
}
export async function readGlobalReceipts(
  prisma: PrismaService,
  query: PaymentListQuery,
): Promise<LedgerPage<ReceiptLedgerRow>> {
  const page = query.page ?? 1,
    pageSize = query.pageSize ?? 25;
  const term = normalizeText(query.search),
    phone = customerPhoneSearch(term);
  const literalTerm = term.replace(/[\\%_]/g, '\\$&');
  const where: Prisma.CustomerPaymentReceiptWhereInput = term
    ? {
        OR: [
          { receiptNumber: { contains: literalTerm, mode: 'insensitive' } },
          {
            customer: { name: { contains: literalTerm, mode: 'insensitive' } },
          },
          { customer: { phone: { contains: literalTerm } } },
          ...(phone ? [{ customer: { normalizedPhone: phone } }] : []),
        ],
      }
    : {};
  return prisma.$transaction(
    async (tx) => {
      const total = await tx.customerPaymentReceipt.count({ where });
      const rows = await tx.customerPaymentReceipt.findMany({
        where,
        orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          receiptNumber: true,
          customerId: true,
          customer: { select: { name: true, phone: true } },
          paidAt: true,
          method: true,
          totalAmount: true,
        },
      });
      return {
        page,
        pageSize,
        total,
        items: rows.map((r) => ({
          id: r.id,
          receiptNumber: r.receiptNumber,
          customerId: r.customerId,
          customerName: r.customer.name,
          customerPhone: r.customer.phone,
          paidAt: r.paidAt.toISOString(),
          method: r.method,
          totalAmount: Number(r.totalAmount),
        })),
      };
    },
    { isolationLevel: 'RepeatableRead' },
  );
}
