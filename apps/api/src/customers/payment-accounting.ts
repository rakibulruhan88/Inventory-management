import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { ReceivePaymentRequest } from '@afia/contracts';
export const paymentSaleOrder = [
  { soldAt: 'asc' },
  { createdAt: 'asc' },
  { id: 'asc' },
] as const;
export function paymentMoney(value: unknown): Prisma.Decimal {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 999999999999.99
  )
    throw new BadRequestException('Enter a valid amount.');
  const amount = new Prisma.Decimal(value);
  if (amount.decimalPlaces() > 2)
    throw new BadRequestException(
      'Amounts support at most two decimal places.',
    );
  return amount;
}
type Invoice = {
  id: string;
  totalAmount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  openingBalanceId?: string;
};
export function planPayment(invoices: Invoice[], input: ReceivePaymentRequest) {
  const amount = paymentMoney(input.amount);
  const outstanding = invoices.reduce(
    (sum, sale) => sum.plus(sale.totalAmount.minus(sale.paidAmount)),
    new Prisma.Decimal(0),
  );
  if (amount.lte(0))
    throw new BadRequestException('Payment must be greater than zero.');
  if (outstanding.lte(0))
    throw new ConflictException('There is no due to pay.');
  if (amount.gt(outstanding))
    throw new ConflictException('You cannot receive more than the total due.');
  if (!paymentMoney(input.expectedOutstanding).eq(outstanding))
    throw new ConflictException(
      'The account balance changed. Refresh and review the payment again.',
    );
  const allocations: {
    saleId: string | null;
    openingBalanceId?: string;
    amount: Prisma.Decimal;
    previousDue: Prisma.Decimal;
    remainingDue: Prisma.Decimal;
  }[] = [];
  if (input.allocationMode === 'AUTO') {
    if (input.allocations?.length)
      throw new BadRequestException(
        'Choose Invoices before entering Pay Now amounts.',
      );
    let left = amount;
    for (const sale of invoices) {
      const due = sale.totalAmount.minus(sale.paidAmount);
      const applied = Prisma.Decimal.min(left, due);
      if (applied.gt(0))
        allocations.push({
          saleId: sale.openingBalanceId ? null : sale.id,
          ...(sale.openingBalanceId
            ? { openingBalanceId: sale.openingBalanceId }
            : {}),
          amount: applied,
          previousDue: due,
          remainingDue: due.minus(applied),
        });
      left = left.minus(applied);
      if (left.eq(0)) break;
    }
  } else if (input.allocationMode === 'MANUAL') {
    if (!Array.isArray(input.allocations) || input.allocations.length === 0)
      throw new BadRequestException('Choose what to pay against.');
    const seen = new Set<string>();
    for (const row of input.allocations) {
      if (!!row.saleId === !!row.openingBalanceId)
        throw new BadRequestException('Choose one item to pay against.');
      const sourceId = row.saleId ?? row.openingBalanceId!;
      if (seen.has(sourceId))
        throw new BadRequestException('Choose each item only once.');
      seen.add(sourceId);
      const sale = invoices.find(
        (s) =>
          s.id === sourceId &&
          (row.openingBalanceId
            ? s.openingBalanceId === row.openingBalanceId
            : !s.openingBalanceId),
      );
      if (!sale)
        throw new ConflictException(
          'This due changed. Refresh and review the payment.',
        );
      const due = sale.totalAmount.minus(sale.paidAmount);
      const applied = paymentMoney(row.amount);
      if (!paymentMoney(row.expectedDue).eq(due))
        throw new ConflictException(
          'This due changed. Refresh and review the payment.',
        );
      if (applied.gt(due))
        throw new BadRequestException('Pay Now cannot be more than the due.');
      if (applied.gt(0))
        allocations.push({
          saleId: sale.openingBalanceId ? null : sale.id,
          ...(sale.openingBalanceId
            ? { openingBalanceId: sale.openingBalanceId }
            : {}),
          amount: applied,
          previousDue: due,
          remainingDue: due.minus(applied),
        });
    }
    if (
      !allocations
        .reduce((sum, a) => sum.plus(a.amount), new Prisma.Decimal(0))
        .eq(amount)
    )
      throw new BadRequestException(
        `Pay Now total must be ৳${amount.toNumber().toLocaleString('en-US', { maximumFractionDigits: 2 })}.`,
      );
  } else throw new BadRequestException('Choose how to pay.');
  return { amount, outstanding, allocations };
}
export async function lockCustomerAccount(
  tx: Prisma.TransactionClient,
  customerId: string,
) {
  // All account writers take this lock before reading balances, including sale creation and void.
  // A row version write also forces older Serializable sale snapshots to retry
  // after a payment committed while they waited; a read-only lock would not.
  await tx.$queryRaw`UPDATE "Customer" SET "updatedAt" = "updatedAt" WHERE id = ${customerId} RETURNING id`;
}
export async function readOutstanding(
  tx: Prisma.TransactionClient,
  customerId: string,
) {
  const sales = await tx.sale.findMany({
    where: { customerId, status: 'COMPLETED' },
    orderBy: [...paymentSaleOrder],
  });
  return sales.filter((s) => s.totalAmount.gt(s.paidAmount));
}

export function isAccountingWriteConflict(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2034') return true;
  const meta = error.meta as
    | {
        code?: unknown;
        driverAdapterError?: { cause?: { originalCode?: unknown } };
      }
    | undefined;
  const sqlCode = meta?.code ?? meta?.driverAdapterError?.cause?.originalCode;
  return error.code === 'P2010' && (sqlCode === '40001' || sqlCode === '40P01');
}
