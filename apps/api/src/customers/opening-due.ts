import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { CustomerInput, OpeningDueRequest } from '@afia/contracts';
import type { PrismaService } from '../prisma/prisma.service.js';
import { normalizeText } from '../common/normalize.js';
import {
  customerIdentityInput,
  assertCustomerPhoneAvailable,
  customerIdentitySelect,
  isCustomerPhoneUniqueError,
  phoneConflict,
} from './customer-identity.js';
import {
  isAccountingWriteConflict,
  lockCustomerAccount,
  paymentMoney,
} from './payment-accounting.js';
import { readOpeningDue } from './account-balances.js';

export async function createOpeningDue(
  prisma: PrismaService,
  customerId: string | undefined,
  input: OpeningDueRequest,
  actorId: string,
  newCustomer?: CustomerInput,
) {
  if (!actorId) throw new BadRequestException('Please sign in.');
  const amount = paymentMoney(input?.amount);
  if (amount.lte(0))
    throw new BadRequestException('Opening Due must be more than ৳0.');
  const date = new Date(`${input.balanceAsOf}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.balanceAsOf ?? '') ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== input.balanceAsOf
  )
    throw new BadRequestException('Choose a valid Balance Date.');
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      input.idempotencyKey ?? '',
    )
  )
    throw new BadRequestException('Please retry saving the Opening Due.');
  const identity = newCustomer ? customerIdentityInput(newCustomer) : undefined;
  const note = normalizeText(input.note) || null;
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        customerId,
        identity,
        actorId,
        amount: amount.toFixed(2),
        date: input.balanceAsOf,
        note,
      }),
    )
    .digest('hex');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.idempotencyKey}, 0))`;
          // Check before identity creation so an exact retry cannot create a second customer.
          let prior = await tx.customerOpeningBalance.findUnique({
            where: { idempotencyKey: input.idempotencyKey },
          });
          if (prior) {
            if (
              prior.createdBy !== actorId ||
              prior.requestHash !== hash ||
              (customerId && prior.customerId !== customerId)
            )
              throw new ConflictException(
                'This Opening Due was already submitted with different details.',
              );
            return {
              customerId: prior.customerId,
              openingDue: (await readOpeningDue(tx, prior.customerId))!,
            };
          }
          let id = customerId;
          if (!id && identity) {
            await assertCustomerPhoneAvailable(tx, identity.normalizedPhone);
            const customer = await tx.customer.create({ data: identity });
            id = customer.id;
          }
          if (!id) throw new BadRequestException('Choose a customer.');
          await lockCustomerAccount(tx, id);
          const customer = await tx.customer.findUnique({ where: { id } });
          if (!customer) throw new NotFoundException('Customer not found.');
          if (customer.archivedAt)
            throw new ConflictException('This customer is archived.');
          prior = await tx.customerOpeningBalance.findUnique({
            where: { customerId: id },
          });
          if (prior) {
            if (
              prior.idempotencyKey === input.idempotencyKey &&
              prior.requestHash === hash &&
              prior.createdBy === actorId
            )
              return {
                customerId: id,
                openingDue: (await readOpeningDue(tx, id))!,
              };
            throw new ConflictException(
              'This customer already has an Opening Due.',
            );
          }
          const opening = await tx.customerOpeningBalance.create({
            data: {
              customerId: id,
              originalAmount: amount,
              balanceAsOf: date,
              note,
              createdBy: actorId,
              idempotencyKey: input.idempotencyKey,
              requestHash: hash,
            },
          });
          await tx.auditLog.create({
            data: {
              action: 'CUSTOMER_OPENING_BALANCE_CREATED',
              entityType: 'CustomerOpeningBalance',
              entityId: opening.id,
              userId: actorId,
              reason: note,
              metadata: {
                actorId,
                customerId: id,
                openingBalanceId: opening.id,
                amount: amount.toFixed(2),
                balanceAsOf: input.balanceAsOf,
                timestamp: opening.createdAt.toISOString(),
              },
            },
          });
          return {
            customerId: id,
            openingDue: (await readOpeningDue(tx, id))!,
          };
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
      if (identity?.normalizedPhone && isCustomerPhoneUniqueError(error)) {
        const owner = await prisma.customer.findUnique({
          where: { normalizedPhone: identity.normalizedPhone },
          select: customerIdentitySelect,
        });
        if (owner) throw phoneConflict(owner);
      }
      if (code === 'P2002')
        throw new ConflictException(
          'This customer already has an Opening Due.',
        );
      throw new ServiceUnavailableException(
        'Opening Due could not be saved. Please try again.',
      );
    }
  }
  throw new ConflictException('The account is busy. Please try again.');
}
