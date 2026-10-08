import { readDueSources, presentDueSource } from './account-balances.js';
import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  PaymentContext,
  PaymentHistory,
  PaymentReceipt,
  ReceivePaymentRequest,
} from '@afia/contracts';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { normalizeText } from '../common/normalize.js';
import {
  isAccountingWriteConflict,
  lockCustomerAccount,
  planPayment,
} from './payment-accounting.js';
export const receiptInclude = {
  customer: true,
  allocations: {
    include: { sale: true, openingBalance: true },
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
  },
};
type ReceiptRecord = Prisma.CustomerPaymentReceiptGetPayload<{
  include: typeof receiptInclude;
}>;
export function presentReceipt(r: ReceiptRecord): PaymentReceipt {
  return {
    id: r.id,
    receiptNumber: r.receiptNumber,
    customerId: r.customerId,
    customerName: r.customer.name,
    customerPhone: r.customer.phone,
    totalAmount: Number(r.totalAmount),
    method: r.method,
    reference: r.reference,
    notes: r.notes,
    paidAt: r.paidAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    outstandingBefore: Number(r.outstandingBefore),
    outstandingAfter: Number(r.outstandingAfter),
    allocations: r.allocations.map((a) => ({
      saleId: a.saleId,
      invoiceNumber: a.sale?.invoiceNumber ?? null,
      sourceKind: a.openingBalanceId ? 'OPENING' : 'SALE',
      openingBalanceId: a.openingBalanceId,
      soldAt: (a.sale?.soldAt ?? a.openingBalance!.balanceAsOf).toISOString(),
      amount: Number(a.amount),
      previousDue: Number(a.previousDue),
      remainingDue: Number(a.remainingDue),
    })),
  };
}
export async function receiptDetails(
  tx: Prisma.TransactionClient,
  customerId: string,
  receiptId: string,
) {
  // Scope by relational customer identity; a mismatched route cannot disclose another account's receipt.
  const receipt = await tx.customerPaymentReceipt.findFirst({
    where: { id: receiptId, customerId },
    include: receiptInclude,
  });
  if (!receipt) throw new NotFoundException('Payment receipt not found.');
  return presentReceipt(receipt);
}
export async function paymentContext(
  prisma: PrismaService,
  customerId: string,
): Promise<PaymentContext> {
  return prisma.$transaction(
    async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, archivedAt: null },
      });
      if (!customer) throw new NotFoundException('Customer not found.');
      const sources = await readDueSources(tx, customerId);
      const invoices = sources
        .filter((s) => s.kind === 'SALE')
        .map((s) => ({
          id: s.id,
          invoiceNumber: s.invoiceNumber!,
          soldAt: s.date,
          totalAmount: s.original,
          paidAmount: s.paid,
          status: 'COMPLETED',
        }));
      return {
        customerId,
        customerName: customer.name,
        customerPhone: customer.phone,
        outstanding: Number(
          sources.reduce((sum, s) => sum.plus(s.due), new Prisma.Decimal(0)),
        ),
        sources: sources.map(presentDueSource),
        invoices: invoices.map((s) => ({
          id: s.id,
          invoiceNumber: s.invoiceNumber,
          soldAt: s.soldAt.toISOString(),
          customerName: customer.name,
          totalAmount: Number(s.totalAmount),
          paidAmount: Number(s.paidAmount),
          dueAmount: Number(s.totalAmount.minus(s.paidAmount)),
          status: s.status,
        })),
      };
    },
    { isolationLevel: 'RepeatableRead' },
  );
}
export async function receivePayment(
  prisma: PrismaService,
  customerId: string,
  input: ReceivePaymentRequest,
  actorId: string,
): Promise<PaymentReceipt> {
  if (!actorId) throw new BadRequestException('Please sign in.');
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.idempotencyKey ?? '',
    )
  )
    throw new BadRequestException('Please retry this payment.');
  const paidAt = new Date(input.paidAt);
  if (!input.paidAt || !Number.isFinite(paidAt.getTime()))
    throw new BadRequestException('Choose a valid Payment Date.');
  const method = input.method ?? 'CASH';
  if (!['CASH', 'BANK', 'MOBILE_BANKING', 'OTHER'].includes(method))
    throw new BadRequestException('Choose a valid Payment Method.');
  const reference = normalizeText(input.reference) || null,
    notes = normalizeText(input.notes) || null;
  const requestHash = createHash('sha256')
    .update(
      JSON.stringify({
        customerId,
        actorId,
        amount: input.amount,
        method,
        reference,
        notes,
        paidAt: paidAt.toISOString(),
        allocationMode: input.allocationMode,
        expectedOutstanding: input.expectedOutstanding,
        allocations: [...(input.allocations ?? [])].sort((a, b) =>
          (a.saleId ?? a.openingBalanceId ?? '').localeCompare(
            b.saleId ?? b.openingBalanceId ?? '',
          ),
        ),
      }),
    )
    .digest('hex');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await lockCustomerAccount(tx, customerId);
          const customer = await tx.customer.findUnique({
            where: { id: customerId },
          });
          if (!customer) throw new NotFoundException('Customer not found.');
          const prior = await tx.customerPaymentReceipt.findUnique({
            where: { idempotencyKey: input.idempotencyKey },
            include: receiptInclude,
          });
          if (prior) {
            if (
              prior.customerId !== customerId ||
              prior.createdBy !== actorId ||
              prior.requestHash !== requestHash
            )
              throw new ConflictException(
                'This payment was already submitted with different details.',
              );
            return presentReceipt(prior);
          }
          if (customer.archivedAt)
            throw new ConflictException('This customer is archived.');
          const sources = await readDueSources(tx, customerId);
          const invoices = sources.map((s) => ({
            id: s.id,
            totalAmount: s.original,
            paidAmount: s.paid,
            ...(s.kind === 'OPENING' ? { openingBalanceId: s.id } : {}),
          }));
          const plan = planPayment(invoices, input);
          const sequence = await tx.$queryRaw<
            { value: bigint }[]
          >`SELECT nextval('customer_payment_receipt_sequence') AS value`;
          const day = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Dhaka',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          })
            .format(new Date())
            .replaceAll('-', '');
          const receiptNumber = `PAY-${day}-${sequence[0].value.toString().padStart(6, '0')}`;
          const receipt = await tx.customerPaymentReceipt.create({
            data: {
              receiptNumber,
              customerId,
              totalAmount: plan.amount,
              method,
              reference,
              notes,
              paidAt,
              createdBy: actorId,
              idempotencyKey: input.idempotencyKey,
              requestHash,
              outstandingBefore: plan.outstanding,
              outstandingAfter: plan.outstanding.minus(plan.amount),
            },
          });
          for (const allocation of plan.allocations) {
            // Compare-and-update protects balances even if a future writer omits the customer lock.
            if (allocation.saleId) {
              const sale = invoices.find((s) => s.id === allocation.saleId)!;
              const update = await tx.sale.updateMany({
                where: {
                  id: sale.id,
                  customerId,
                  status: 'COMPLETED',
                  paidAmount: sale.paidAmount,
                  totalAmount: sale.totalAmount,
                },
                data: { paidAmount: { increment: allocation.amount } },
              });
              if (update.count !== 1)
                throw new ConflictException(
                  'An invoice changed. Refresh and review the payment.',
                );
            }
            await tx.customerPaymentAllocation.create({
              data: { receiptId: receipt.id, ...allocation },
            });
          }
          await tx.auditLog.create({
            data: {
              action: 'CUSTOMER_PAYMENT_RECEIVED',
              entityType: 'CustomerPaymentReceipt',
              entityId: receipt.id,
              userId: actorId,
              reason: notes,
              metadata: {
                customerId,
                receiptId: receipt.id,
                totalAmount: plan.amount.toFixed(2),
                saleIds: plan.allocations.flatMap((a) =>
                  a.saleId ? [a.saleId] : [],
                ),
                openingBalanceIds: plan.allocations.flatMap((a) =>
                  a.openingBalanceId ? [a.openingBalanceId] : [],
                ),
                actorId,
                timestamp: new Date().toISOString(),
                paidAt: paidAt.toISOString(),
              },
            },
          });
          return receiptDetails(tx, customerId, receipt.id);
        },
        { isolationLevel: 'ReadCommitted', maxWait: 10000, timeout: 20000 },
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? error.code
          : undefined;
      if ((isAccountingWriteConflict(error) || code === 'P2002') && attempt < 2)
        continue;
      if (
        isAccountingWriteConflict(error) ||
        code === 'P2002' ||
        code === 'P2028'
      )
        throw new ConflictException(
          'The account is busy. Please retry this payment.',
        );
      throw new ServiceUnavailableException(
        'Payment could not be saved. Please try again.',
      );
    }
  }
  throw new ConflictException('Payment is busy. Please retry.');
}
export async function readPaymentHistory(
  tx: Prisma.TransactionClient,
  customerId: string,
  page: number,
  pageSize: number,
) {
  const union = Prisma.sql`FROM (SELECT id, "receivedAt" AS date, 'legacy' AS kind FROM "Payment" WHERE "customerId" = ${customerId} AND "voidedAt" IS NULL
    UNION ALL SELECT id, "paidAt" AS date, 'receipt' AS kind FROM "CustomerPaymentReceipt" WHERE "customerId" = ${customerId}) history`;
  const count = await tx.$queryRaw<{ total: bigint }[]>(
    Prisma.sql`SELECT COUNT(*) AS total ${union}`,
  );
  const keys = await tx.$queryRaw<{ id: string; kind: string }[]>(
    Prisma.sql`SELECT id, kind ${union} ORDER BY date DESC, id ASC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
  );
  const [receipts, legacy] = await Promise.all([
    keys.some((k) => k.kind === 'receipt')
      ? tx.customerPaymentReceipt.findMany({
          where: {
            customerId,
            id: {
              in: keys.filter((k) => k.kind === 'receipt').map((k) => k.id),
            },
          },
          include: receiptInclude,
        })
      : [],
    keys.some((k) => k.kind === 'legacy')
      ? tx.payment.findMany({
          where: {
            customerId,
            id: {
              in: keys.filter((k) => k.kind === 'legacy').map((k) => k.id),
            },
          },
          include: { sale: true },
        })
      : [],
  ]);
  const items: PaymentHistory[] = keys.map((key) => {
    if (key.kind === 'receipt') {
      const r = presentReceipt(receipts.find((r) => r.id === key.id)!);
      return {
        id: r.id,
        receiptId: r.id,
        receiptNumber: r.receiptNumber,
        receivedAt: r.paidAt,
        amount: r.totalAmount,
        method: r.method,
        reference: r.reference,
        notes: r.notes,
        saleId: null,
        invoiceNumber: null,
        allocations: r.allocations,
      };
    }
    const p = legacy.find((p) => p.id === key.id)!;
    return {
      id: p.id,
      receivedAt: p.receivedAt.toISOString(),
      amount: Number(p.amount),
      method: p.method,
      reference: p.reference,
      notes: p.notes,
      saleId: p.saleId,
      invoiceNumber: p.sale?.invoiceNumber ?? null,
    };
  });
  return { items, total: Number(count[0].total), page, pageSize };
}
