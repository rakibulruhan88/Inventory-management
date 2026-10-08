import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  normalizeCustomerPhone,
  type CustomerInput,
  type CustomerPhoneConflict,
} from '@afia/contracts';
import type { Prisma } from '../generated/prisma/client.js';
import { normalizeText } from '../common/normalize.js';

export function customerIdentityInput(input: CustomerInput) {
  let normalizedPhone: string | null;
  try {
    normalizedPhone = normalizeCustomerPhone(input.phone);
  } catch (error) {
    throw new BadRequestException(
      error instanceof Error ? error.message : 'Invalid customer phone.',
    );
  }
  if (typeof input.name !== 'string')
    throw new BadRequestException('Customer name is required.');
  for (const key of ['email', 'address'] as const)
    if (input[key] != null && typeof input[key] !== 'string')
      throw new BadRequestException(`Customer ${key} must be text.`);
  const name = normalizeText(input.name);
  if (!name) throw new BadRequestException('Customer name is required.');
  const phone = normalizeText(input.phone) || null;
  const email = normalizeText(input.email).toLowerCase() || null;
  const address = normalizeText(input.address) || null;
  return {
    name,
    phone,
    normalizedPhone,
    email,
    address,
    searchText: [name, phone, normalizedPhone, email].filter(Boolean).join(' '),
  };
}
export const customerIdentitySelect = {
  id: true,
  name: true,
  phone: true,
  archivedAt: true,
} as const;
export function phoneConflict(owner: {
  id: string;
  name: string;
  phone: string | null;
  archivedAt: Date | null;
}): ConflictException {
  return new ConflictException({
    code: 'CUSTOMER_PHONE_CONFLICT',
    message: `Phone number already belongs to ${owner.name}${owner.phone ? ` (${owner.phone})` : ''}.${owner.archivedAt ? ' This customer is archived; review the existing customer before using this phone.' : ' Select the existing customer.'}`,
    existingCustomer: {
      id: owner.id,
      name: owner.name,
      phone: owner.phone,
      archived: !!owner.archivedAt,
    },
  } satisfies CustomerPhoneConflict);
}
export async function assertCustomerPhoneAvailable(
  tx: Pick<Prisma.TransactionClient, 'customer'>,
  normalizedPhone: string | null,
  excludeId?: string,
) {
  if (!normalizedPhone) return;
  const owner = await tx.customer.findUnique({
    where: { normalizedPhone },
    select: customerIdentitySelect,
  });
  if (owner && owner.id !== excludeId) throw phoneConflict(owner);
}
export function isCustomerPhoneUniqueError(error: unknown): boolean {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('code' in error) ||
    error.code !== 'P2002'
  )
    return false;
  // Prisma 7's PostgreSQL adapter reports the constraint index in the cause;
  // other clients report a field array in meta.target.
  const meta = (
    error as {
      meta?: {
        target?: unknown;
        driverAdapterError?: {
          cause?: { constraint?: { fields?: unknown; index?: unknown } };
        };
      };
    }
  ).meta;
  const target =
    meta?.target ??
    meta?.driverAdapterError?.cause?.constraint?.fields ??
    meta?.driverAdapterError?.cause?.constraint?.index;
  return target !== undefined && String(target).includes('normalizedPhone');
}
export function customerPhoneSearch(value: string): string | null {
  try {
    return normalizeCustomerPhone(value);
  } catch {
    return null;
  }
}
