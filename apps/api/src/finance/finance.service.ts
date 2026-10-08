import { appendActivity } from '../activity/activity-write.js';
import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  expenseTypes,
  type CreateFinanceEntry,
  type FinanceEntryDetail,
  type FinanceQuery,
} from '@afia/contracts';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { paymentMoney } from '../customers/payment-accounting.js';
import { readFinance } from './finance-ledger.js';
const include = {
  supplier: true,
  purchase: true,
  container: true,
  actor: true,
  voidActor: true,
};
type Entry = Prisma.FinancialEntryGetPayload<{ include: typeof include }>;
function present(e: Entry): FinanceEntryDetail {
  return {
    id: e.id,
    type: e.type as FinanceEntryDetail['type'],
    direction: e.direction as 'IN' | 'OUT',
    expenseType: e.expenseType as FinanceEntryDetail['expenseType'],
    amount: e.amount.toFixed(2),
    method: e.method,
    occurredAt: e.occurredAt.toISOString(),
    reference: e.reference ?? undefined,
    note: e.note ?? undefined,
    supplierId: e.supplierId ?? undefined,
    purchaseId: e.purchaseId ?? undefined,
    containerId: e.containerId ?? undefined,
    createdAt: e.createdAt.toISOString(),
    createdBy: e.createdBy,
    creatorName: e.actor.name,
    supplierName: e.supplier?.name ?? null,
    purchaseNumber: e.purchase?.purchaseNumber ?? null,
    containerNumber: e.container?.containerNumber ?? null,
    voidedAt: e.voidedAt?.toISOString() ?? null,
    voidReason: e.voidReason,
    voiderName: e.voidActor?.name ?? null,
  };
}
export function financeInput(input: CreateFinanceEntry) {
  if (
    !['OTHER_IN', 'SUPPLIER_PAYMENT', 'EXPENSE', 'OTHER_OUT'].includes(
      input.type,
    )
  )
    throw new BadRequestException('Choose a valid Type.');
  const amount = paymentMoney(input.amount);
  if (amount.lte(0))
    throw new BadRequestException('Amount must be more than ৳0.');
  if (!['CASH', 'BANK', 'MOBILE_BANKING', 'OTHER'].includes(input.method))
    throw new BadRequestException('Choose a valid Method.');
  const occurredAt = new Date(input.occurredAt);
  if (
    !Number.isFinite(occurredAt.getTime()) ||
    !/(Z|[+-]\d{2}:\d{2})$/.test(input.occurredAt)
  )
    throw new BadRequestException('Choose a valid Date.');
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.idempotencyKey ?? '',
    )
  )
    throw new BadRequestException('Please retry this entry.');
  const note = input.note?.trim() || null,
    reference = input.reference?.trim() || null;
  if ((note?.length ?? 0) > 2000 || (reference?.length ?? 0) > 200)
    throw new BadRequestException('Note or Reference is too long.');
  if (input.type === 'EXPENSE') {
    if (!expenseTypes.includes(input.expenseType!))
      throw new BadRequestException('Choose an Expense Type.');
    if (input.expenseType === 'Other' && !note)
      throw new BadRequestException('Please add a Note.');
  } else if (input.expenseType)
    throw new BadRequestException('Expense Type is only for Expenses.');
  if (input.type === 'SUPPLIER_PAYMENT') {
    if (!input.supplierId)
      throw new BadRequestException('Please choose a supplier.');
  } else if (input.supplierId || input.purchaseId || input.containerId)
    throw new BadRequestException(
      'Supplier links are only for Supplier Payment.',
    );
  return {
    type: input.type,
    direction: input.type === 'OTHER_IN' ? 'IN' : 'OUT',
    amount,
    method: input.method,
    occurredAt,
    reference,
    note,
    expenseType: input.expenseType ?? null,
    supplierId: input.supplierId ?? null,
    purchaseId: input.purchaseId ?? null,
    containerId: input.containerId ?? null,
  };
}
@Injectable()
export class FinanceService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  list(q: FinanceQuery) {
    return readFinance(this.prisma, q);
  }
  async detail(id: string) {
    const e = await this.prisma.financialEntry.findUnique({
      where: { id },
      include,
    });
    if (!e) throw new NotFoundException('Entry not found.');
    return present(e);
  }
  async create(input: CreateFinanceEntry, actorId: string) {
    const data = financeInput(input);
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({ ...data, amount: data.amount.toFixed(2), actorId }),
      )
      .digest('hex');
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Serialize the submission key before checking it. Exact concurrent retries
          // return one record, including its audit event; changed payloads are rejected.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.idempotencyKey}, 0))`;
          const prior = await tx.financialEntry.findUnique({
            where: { idempotencyKey: input.idempotencyKey },
            include,
          });
          if (prior) {
            if (
              prior.createdBy !== actorId ||
              prior.requestHash !== requestHash
            )
              throw new ConflictException(
                'This entry is already saved with different details.',
              );
            return present(prior);
          }
          if (data.supplierId) {
            const supplier = await tx.supplier.findFirst({
              where: { id: data.supplierId, archivedAt: null },
            });
            if (!supplier)
              throw new BadRequestException(
                'Please choose an active supplier.',
              );
            if (data.purchaseId) {
              const p = await tx.purchase.findUnique({
                where: { id: data.purchaseId },
              });
              if (
                !p ||
                p.supplierId !== supplier.id ||
                p.status === 'CANCELLED' ||
                (data.containerId && p.containerId !== data.containerId)
              )
                throw new BadRequestException(
                  'Purchase does not match this supplier or container.',
                );
            }
            if (data.containerId) {
              const c = await tx.container.findUnique({
                where: { id: data.containerId },
              });
              if (!c || c.supplierId !== supplier.id || c.archivedAt)
                throw new BadRequestException(
                  'Container does not match this supplier.',
                );
            }
          }
          const e = await tx.financialEntry.create({
            data: {
              ...data,
              createdBy: actorId,
              idempotencyKey: input.idempotencyKey,
              requestHash,
            },
            include,
          });
          await appendActivity(tx, {
              action: 'FINANCIAL_ENTRY_CREATED',
              entityType: 'FinancialEntry',
              entityId: e.id,
              actorId: actorId,
              metadata: {
                actorId,
                entryId: e.id,
                type: e.type,
                amount: e.amount.toFixed(2),
                supplierId: e.supplierId,
                occurredAt: e.occurredAt.toISOString(),
              },
            });
          return present(e);
        },
        { isolationLevel: 'ReadCommitted', maxWait: 10000, timeout: 20000 },
      );
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw new ServiceUnavailableException(
        'Payment could not be saved. Please try again.',
      );
    }
  }
  async void(id: string, reason: string, actorId: string) {
    const clean = reason?.trim();
    if (!clean || clean.length > 2000)
      throw new BadRequestException('Please add a reason.');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const changed = await tx.financialEntry.updateMany({
          where: { id, voidedAt: null },
          data: { voidedAt: new Date(), voidedBy: actorId, voidReason: clean },
        });
        if (!changed.count) {
          if (!(await tx.financialEntry.findUnique({ where: { id } })))
            throw new NotFoundException('Entry not found.');
          throw new ConflictException('This entry has already been voided.');
        }
        const e = await tx.financialEntry.findUniqueOrThrow({
          where: { id },
          include,
        });
        await appendActivity(tx, {
            action: 'FINANCIAL_ENTRY_VOIDED',
            entityType: 'FinancialEntry',
            entityId: id,
            actorId: actorId,
            reason: clean,
            metadata: {
              actorId,
              entryId: id,
              type: e.type,
              amount: e.amount.toFixed(2),
              supplierId: e.supplierId,
              occurredAt: e.occurredAt.toISOString(),
            },
          });
        return present(e);
      });
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw new ServiceUnavailableException(
        'Entry could not be voided. Please try again.',
      );
    }
  }
}
