import { Prisma } from '../generated/prisma/client.js';
import type { OpeningDue, PaymentDueSource } from '@afia/contracts';

// Canonical due sources for accounts, payments, new-sale snapshots and global due lists.
// Sales revenue stays separate: opening debt is never a Sale.
export const accountSourcesSql = Prisma.sql`
SELECT s.id, s."customerId", 'SALE' AS kind, s."invoiceNumber", s."soldAt" AS date,
 s."createdAt", s."totalAmount" AS original, s."paidAmount" AS paid,
 s."totalAmount" - s."paidAmount" AS due
FROM "Sale" s WHERE s.status = 'COMPLETED'
UNION ALL
SELECT o.id, o."customerId", 'OPENING' AS kind, NULL AS "invoiceNumber", o."balanceAsOf" AS date,
 o."createdAt", o."originalAmount" AS original, COALESCE(a.paid, 0) AS paid,
 o."originalAmount" - COALESCE(a.paid, 0) AS due
FROM "CustomerOpeningBalance" o
LEFT JOIN (SELECT "openingBalanceId", SUM(amount) AS paid FROM "CustomerPaymentAllocation"
 WHERE "openingBalanceId" IS NOT NULL GROUP BY "openingBalanceId") a ON a."openingBalanceId" = o.id`;
export type DueRecord = {
  id: string;
  customerId: string;
  kind: 'SALE' | 'OPENING';
  invoiceNumber: string | null;
  date: Date;
  createdAt: Date;
  original: Prisma.Decimal;
  paid: Prisma.Decimal;
  due: Prisma.Decimal;
};
export async function readDueSources(
  tx: Prisma.TransactionClient,
  customerId: string,
): Promise<DueRecord[]> {
  return tx.$queryRaw<
    DueRecord[]
  >(Prisma.sql`SELECT * FROM (${accountSourcesSql}) sources
 WHERE "customerId" = ${customerId} AND due > 0 ORDER BY date ASC, "createdAt" ASC, id ASC, kind ASC`);
}
export function presentDueSource(s: DueRecord): PaymentDueSource {
  return {
    id: s.id,
    sourceKind: s.kind,
    saleId: s.kind === 'SALE' ? s.id : null,
    openingBalanceId: s.kind === 'OPENING' ? s.id : null,
    invoiceNumber: s.invoiceNumber,
    soldAt: s.date.toISOString(),
    totalAmount: Number(s.original),
    paidAmount: Number(s.paid),
    dueAmount: Number(s.due),
  };
}
export async function readAccountTotals(
  tx: Prisma.TransactionClient,
  customerIds: string[],
) {
  if (!customerIds.length)
    return new Map<
      string,
      { totalSales: number; totalPaid: number; totalDue: number }
    >();
  const rows = await tx.$queryRaw<
    {
      customerId: string;
      sales: Prisma.Decimal;
      paid: Prisma.Decimal;
      due: Prisma.Decimal;
    }[]
  >(Prisma.sql`
 SELECT "customerId", SUM(CASE WHEN kind = 'SALE' THEN original ELSE 0 END) AS sales,
 SUM(paid) AS paid, SUM(due) AS due FROM (${accountSourcesSql}) sources
 WHERE "customerId" IN (${Prisma.join(customerIds)}) GROUP BY "customerId"`);
  return new Map(
    rows.map((r) => [
      r.customerId,
      {
        totalSales: Number(r.sales),
        totalPaid: Number(r.paid),
        totalDue: Number(r.due),
      },
    ]),
  );
}
export async function readOpeningDue(
  tx: Prisma.TransactionClient,
  customerId: string,
): Promise<OpeningDue | null> {
  const o = await tx.customerOpeningBalance.findUnique({
    where: { customerId },
    include: { allocations: { select: { amount: true } } },
  });
  if (!o) return null;
  const paid = o.allocations.reduce(
    (sum, a) => sum.plus(a.amount),
    new Prisma.Decimal(0),
  );
  return {
    id: o.id,
    originalAmount: Number(o.originalAmount),
    paidAmount: Number(paid),
    remainingDue: Number(o.originalAmount.minus(paid)),
    balanceAsOf: o.balanceAsOf.toISOString().slice(0, 10),
    note: o.note,
    createdAt: o.createdAt.toISOString(),
  };
}
