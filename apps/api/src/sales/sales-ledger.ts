import { BadRequestException } from '@nestjs/common';
import {
  SALES_BUSINESS_TIMEZONE,
  validPurchaseDate,
  type SalesLedgerQuery,
  type SalesLedgerRow,
} from '@afia/contracts';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

// Bangladesh business days are UTC+06:00. All boundaries are half-open,
// including the full end day, independent of server/browser timezone.
export function ledgerDateRange(q: SalesLedgerQuery, now = new Date()) {
  if (!q.date) return null;
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: SALES_BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const shift = (day: string, n: number) =>
    new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86400000)
      .toISOString()
      .slice(0, 10);
  let from = today,
    to = today;
  if (q.date === 'yesterday') from = to = shift(today, -1);
  if (q.date === 'week')
    from = shift(
      today,
      -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7),
    );
  if (q.date === 'month') from = `${today.slice(0, 7)}-01`;
  if (q.date === 'specific' || q.date === 'range') {
    if (
      !validPurchaseDate(q.from) ||
      (q.date === 'range' && !validPurchaseDate(q.to))
    )
      throw new BadRequestException('Choose valid calendar dates.');
    from = q.from;
    to = q.date === 'specific' ? from : q.to!;
  }
  if (from > to)
    throw new BadRequestException('From Date cannot be after To Date.');
  // This week/month include the entire calendar period, including future dated records.
  if (q.date === 'week') to = shift(from, 6);
  if (q.date === 'month')
    to = shift(
      new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)), 1))
        .toISOString()
        .slice(0, 10),
      -1,
    );
  return {
    from: new Date(`${from}T00:00:00+06:00`),
    until: new Date(`${shift(to, 1)}T00:00:00+06:00`),
  };
}
const due = Prisma.sql`(s."totalAmount" - s."paidAmount")`;
const contains = (value: string) =>
  `%${value.trim().replace(/[\\%_]/g, '\\$&')}%`;
const productMatch = (term: string) => Prisma.sql`EXISTS (
  SELECT 1 FROM "SaleLine" l JOIN "ProductVariant" v ON v.id = l."variantId" JOIN "Product" p ON p.id = v."productId"
  WHERE l."saleId" = s.id AND (
    COALESCE(l."itemCodeSnapshot", p."itemCode") ILIKE ${contains(term)} OR
    COALESCE(l."descriptionSnapshot", p.description) ILIKE ${contains(term)} OR
    COALESCE(l."colorNameSnapshot", v.color) ILIKE ${contains(term)}))`;
export function ledgerWhere(q: SalesLedgerQuery, now = new Date()) {
  const clauses: Prisma.Sql[] = [];
  const range = ledgerDateRange(q, now);
  if (range)
    clauses.push(
      Prisma.sql`s."createdAt" >= ${range.from} AND s."createdAt" < ${range.until}`,
    );
  if (q.customerId) clauses.push(Prisma.sql`s."customerId" = ${q.customerId}`);
  if (q.customer?.trim())
    clauses.push(Prisma.sql`c.name ILIKE ${contains(q.customer)}`);
  if (q.phone?.trim())
    clauses.push(Prisma.sql`c.phone ILIKE ${contains(q.phone)}`);
  if (q.invoice?.trim())
    clauses.push(Prisma.sql`s."invoiceNumber" ILIKE ${contains(q.invoice)}`);
  if (q.product?.trim()) clauses.push(productMatch(q.product));
  if (q.search?.trim())
    clauses.push(
      Prisma.sql`(s."invoiceNumber" ILIKE ${contains(q.search)} OR c.name ILIKE ${contains(q.search)} OR c.phone ILIKE ${contains(q.search)} OR ${productMatch(q.search)} OR EXISTS (SELECT 1 FROM "Payment" pay WHERE pay."saleId" = s.id AND pay.reference ILIKE ${contains(q.search)}))`,
    );
  if (q.status === 'VOIDED') clauses.push(Prisma.sql`s.status = 'VOIDED'`);
  if (q.status && q.status !== 'VOIDED') {
    clauses.push(Prisma.sql`s.status = 'COMPLETED'`);
    if (q.status === 'PAID') clauses.push(Prisma.sql`${due} <= 0`);
    if (q.status === 'PARTIAL')
      clauses.push(Prisma.sql`s."paidAmount" > 0 AND ${due} > 0`);
    if (q.status === 'UNPAID')
      clauses.push(Prisma.sql`s."paidAmount" = 0 AND ${due} > 0`);
  }
  if (q.method)
    clauses.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "Payment" pay WHERE pay."saleId" = s.id AND pay."voidedAt" IS NULL AND pay.method::text = ${q.method})`,
    );
  for (const [min, max, field] of [
    [q.minTotal, q.maxTotal, Prisma.sql`s."totalAmount"`],
    [q.minDue, q.maxDue, due],
  ] as const) {
    if (min !== undefined && max !== undefined && min > max)
      throw new BadRequestException('Minimum cannot exceed maximum.');
    if (min !== undefined) clauses.push(Prisma.sql`${field} >= ${min}`);
    if (max !== undefined) clauses.push(Prisma.sql`${field} <= ${max}`);
  }
  // Voided invoices retain their original total in the model, but carry no collectible due.
  if (q.minDue !== undefined || q.maxDue !== undefined)
    clauses.push(Prisma.sql`s.status = 'COMPLETED'`);
  return clauses.length
    ? Prisma.join(
        clauses.map((c) => Prisma.sql`(${c})`),
        ' AND ',
      )
    : Prisma.sql`TRUE`;
}
export function ledgerOrder(sort: SalesLedgerQuery['sort']) {
  const orders = {
    newest: Prisma.sql`s."soldAt" DESC`,
    oldest: Prisma.sql`s."soldAt" ASC`,
    'highest-total': Prisma.sql`s."totalAmount" DESC`,
    'lowest-total': Prisma.sql`s."totalAmount" ASC`,
    'highest-due': Prisma.sql`CASE WHEN s.status = 'COMPLETED' THEN ${due} ELSE 0 END DESC`,
  };
  return Prisma.sql`${orders[sort ?? 'newest']}, s.id ASC`;
}
export async function readSalesLedger(
  prisma: PrismaService,
  q: SalesLedgerQuery,
  outstandingOnly = false,
) {
  return prisma.$transaction((tx) => readLedgerPage(tx, q, outstandingOnly), {
    isolationLevel: 'RepeatableRead',
  });
}
export async function readLedgerPage(
  tx: Prisma.TransactionClient,
  q: SalesLedgerQuery,
  outstandingOnly = false,
) {
  const page = q.page ?? 1,
    pageSize = q.pageSize ?? 25;
  const where = Prisma.sql`${ledgerWhere(q)} ${outstandingOnly ? Prisma.sql`AND s.status = 'COMPLETED' AND ${due} > 0` : Prisma.empty}`;
  const base = Prisma.sql`FROM "Sale" s JOIN "Customer" c ON c.id = s."customerId" WHERE ${where}`;
  const counts = await tx.$queryRaw<{ total: bigint }[]>(
    Prisma.sql`SELECT COUNT(*) AS total ${base}`,
  );
  const rows = await tx.$queryRaw<
    (Omit<
      SalesLedgerRow,
      'soldAt' | 'totalAmount' | 'paidAmount' | 'dueAmount'
    > & {
      soldAt: Date;
      totalAmount: Prisma.Decimal;
      paidAmount: Prisma.Decimal;
      dueAmount: Prisma.Decimal;
    })[]
  >(Prisma.sql`
      SELECT s.id, s."invoiceNumber", s."customerId", c.name AS "customerName", c.phone AS "customerPhone", s."soldAt", s."totalAmount", s."paidAmount", ${due} AS "dueAmount", s.status
      ${base} ORDER BY ${ledgerOrder(q.sort)} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`);
  return {
    items: rows.map((r) => ({
      ...r,
      soldAt: r.soldAt.toISOString(),
      totalAmount: Number(r.totalAmount),
      paidAmount: Number(r.paidAmount),
      dueAmount: Number(r.dueAmount),
    })),
    total: Number(counts[0].total),
    page,
    pageSize,
  };
}
