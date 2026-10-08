import {
  financeTypes,
  type FinancePage,
  type FinanceQuery,
  type FinanceRow,
  type FinanceSummary,
  type FinanceType,
} from '@afia/contracts';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ledgerDateRange } from '../sales/sales-ledger.js';

// Cash sources are mutually exclusive. Sale paidAmount is NEVER added to Payment rows.
// Receipts are one row each; allocation SUM is only the old-due breakdown.
export const financeSources = Prisma.sql`
SELECT 'payment:' || p.id AS id, p.id AS "sourceId", COALESCE(p."cashbookType", 'LEGACY_PAYMENT') AS type,
'IN'::text AS direction, p.amount, p."receivedAt" AS "occurredAt", p.method::text AS method,
concat_ws(' · ', s."invoiceNumber", c.name) AS details, p.reference, p.notes AS note,
CASE WHEN s.id IS NOT NULL THEN '/sales/' || s.id || '/invoice' ELSE '/customers/' || c.id END AS "sourceUrl",
CASE WHEN p."cashbookType" = 'DUE_PAYMENT' THEN p.amount ELSE 0 END AS "oldDue",
concat_ws(' ',s."invoiceNumber",c.name,p.reference,p.notes) AS search, NULL::timestamp AS "voidedAt", p."createdAt" AS "recordedAt"
FROM "Payment" p JOIN "Customer" c ON c.id = p."customerId" LEFT JOIN "Sale" s ON s.id = p."saleId"
WHERE p."voidedAt" IS NULL AND (s.id IS NULL OR s.status = 'COMPLETED')
UNION ALL
SELECT 'receipt:' || r.id, r.id, 'DUE_PAYMENT', 'IN', r."totalAmount", r."paidAt", r.method::text,
r."receiptNumber" || ' · ' || c.name, r.reference, r.notes,
'/customers/' || c.id || '/receipts/' || r.id,
COALESCE((SELECT SUM(a.amount) FROM "CustomerPaymentAllocation" a WHERE a."receiptId" = r.id AND (a."saleId" IS NOT NULL OR a."openingBalanceId" IS NOT NULL)),0),
concat_ws(' ',r."receiptNumber",c.name,r.reference,r.notes,(SELECT string_agg(s."invoiceNumber",' ') FROM "CustomerPaymentAllocation" a JOIN "Sale" s ON s.id = a."saleId" WHERE a."receiptId" = r.id)), NULL::timestamp, r."createdAt"
FROM "CustomerPaymentReceipt" r JOIN "Customer" c ON c.id = r."customerId"
UNION ALL
SELECT 'entry:' || e.id, e.id, e.type, e.direction, e.amount, e."occurredAt", e.method::text,
COALESCE(s.name,e."expenseType",CASE WHEN e.direction = 'IN' THEN 'Other Money In' ELSE 'Other Money Out' END), e.reference,e.note,
'/cashbook?entry=' || e.id, 0,
concat_ws(' ',s.name,e.reference,e.note,p."purchaseNumber",c."containerNumber",e."expenseType"), e."voidedAt", e."createdAt"
FROM "FinancialEntry" e LEFT JOIN "Supplier" s ON s.id = e."supplierId"
LEFT JOIN "Purchase" p ON p.id = e."purchaseId" LEFT JOIN "Container" c ON c.id = e."containerId"`;
export function financeWhere(q: FinanceQuery) {
  const conditions: Prisma.Sql[] = [];
  if (q.direction) conditions.push(Prisma.sql`direction = ${q.direction}`);
  if (q.status === 'voided')
    conditions.push(Prisma.sql`"voidedAt" IS NOT NULL`);
  else if (q.status !== 'all') conditions.push(Prisma.sql`"voidedAt" IS NULL`);
  const range = ledgerDateRange({ date: q.date, from: q.from, to: q.to });
  if (range)
    conditions.push(
      Prisma.sql`"occurredAt" >= ${range.from} AND "occurredAt" < ${range.until}`,
    );
  if (q.type) conditions.push(Prisma.sql`type = ${q.type}`);
  if (q.method) conditions.push(Prisma.sql`method = ${q.method}`);
  if (q.search?.trim())
    conditions.push(
      Prisma.sql`search ILIKE ${'%' + q.search.trim().replace(/[\\%_]/g, '\\$&') + '%'}`,
    );
  return conditions.length
    ? Prisma.join(
        conditions.map((c) => Prisma.sql`(${c})`),
        ' AND ',
      )
    : Prisma.sql`TRUE`;
}
export async function readFinance(
  prisma: PrismaService,
  q: FinanceQuery,
): Promise<FinancePage> {
  const page = q.page ?? 1,
    pageSize = q.pageSize ?? 25;
  return prisma.$transaction(
    async (tx) => {
      const base = Prisma.sql`FROM (${financeSources}) f WHERE ${financeWhere(q)}`;
      const rows = await tx.$queryRaw<
        (Omit<FinanceRow, 'amount' | 'occurredAt' | 'oldDue' | 'voidedAt'> & {
          amount: Prisma.Decimal;
          occurredAt: Date;
          oldDue: Prisma.Decimal;
          voidedAt: Date | null;
        })[]
      >(
        Prisma.sql`SELECT id,"sourceId",type,direction,amount,"occurredAt",method,details,reference,note,"sourceUrl","oldDue","voidedAt" ${base} ORDER BY "recordedAt" DESC, id ASC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      );
      const count = await tx.$queryRaw<{ total: bigint }[]>(
        Prisma.sql`SELECT count(*) AS total ${base}`,
      );
      const groups = await tx.$queryRaw<
        {
          type: FinanceType;
          method: FinanceRow['method'];
          direction: FinanceRow['direction'];
          amount: Prisma.Decimal;
          oldDue: Prisma.Decimal;
        }[]
      >(
        Prisma.sql`SELECT type,method,direction,SUM(amount) AS amount,SUM("oldDue") AS "oldDue" ${base} AND "voidedAt" IS NULL GROUP BY type,method,direction`,
      );
      // Sales is an independent revenue metric for the selected days. Cash-only filters
      // do not redefine revenue (an unpaid sale has no payment method).
      const range = ledgerDateRange({ date: q.date, from: q.from, to: q.to });
      const sales = await tx.sale.aggregate({
        where: {
          status: 'COMPLETED',
          ...(range ? { soldAt: { gte: range.from, lt: range.until } } : {}),
        },
        _sum: { totalAmount: true },
      });
      const byType = Object.fromEntries(
        financeTypes.map((t) => [t, new Prisma.Decimal(0)]),
      ) as Record<FinanceType, Prisma.Decimal>;
      let moneyIn = new Prisma.Decimal(0),
        moneyOut = new Prisma.Decimal(0),
        oldDue = new Prisma.Decimal(0);
      const methods = ['CASH', 'BANK', 'MOBILE_BANKING', 'OTHER'] as const;
      const methodTotals = methods.map((method) => ({
        method,
        moneyIn: new Prisma.Decimal(0),
        moneyOut: new Prisma.Decimal(0),
      }));
      for (const g of groups) {
        byType[g.type] = byType[g.type].plus(g.amount);
        oldDue = oldDue.plus(g.oldDue);
        if (g.direction === 'IN') moneyIn = moneyIn.plus(g.amount);
        else moneyOut = moneyOut.plus(g.amount);
        const m = methodTotals.find((m) => m.method === g.method)!;
        if (g.direction === 'IN') m.moneyIn = m.moneyIn.plus(g.amount);
        else m.moneyOut = m.moneyOut.plus(g.amount);
      }
      const summary: FinanceSummary = {
        sales: (sales._sum.totalAmount ?? new Prisma.Decimal(0)).toFixed(2),
        moneyIn: moneyIn.toFixed(2),
        moneyOut: moneyOut.toFixed(2),
        netMoney: moneyIn.minus(moneyOut).toFixed(2),
        oldDue: oldDue.toFixed(2),
        byType: Object.fromEntries(
          financeTypes.map((t) => [t, byType[t].toFixed(2)]),
        ) as Record<FinanceType, string>,
        methods: methodTotals.map((m) => ({
          ...m,
          moneyIn: m.moneyIn.toFixed(2),
          moneyOut: m.moneyOut.toFixed(2),
        })),
      };
      return {
        items: rows.map((r) => ({
          ...r,
          amount: r.amount.toFixed(2),
          oldDue: r.oldDue.toFixed(2),
          occurredAt: r.occurredAt.toISOString(),
          voidedAt: r.voidedAt?.toISOString() ?? null,
        })),
        total: Number(count[0].total),
        page,
        pageSize,
        summary,
      };
    },
    { isolationLevel: 'RepeatableRead' },
  );
}
