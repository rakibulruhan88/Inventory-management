import { ConflictException } from '@nestjs/common';
import type { InlinePartyInput } from '@afia/contracts';
import type { Prisma } from '../generated/prisma/client.js';
import {
  assertCustomerPhoneAvailable,
  customerIdentityInput,
  phoneConflict,
} from './customer-identity.js';

/** ID is authoritative; otherwise only normalized phone resolves an identity. */
export async function resolveSaleCustomer(
  tx: Prisma.TransactionClient,
  input: InlinePartyInput,
  customerId?: string,
) {
  const id = customerId ?? input.id;
  let existing = id
    ? await tx.customer.findFirst({ where: { id, archivedAt: null } })
    : null;
  if (id && !existing)
    throw new ConflictException(
      'The selected customer is no longer available.',
    );
  // An unchanged legacy invalid display phone on a selected ID is not a new identity.
  const unchangedLegacyPhone =
    id &&
    existing?.phone &&
    !existing.normalizedPhone &&
    typeof input.phone === 'string' &&
    input.phone.trim() === existing.phone.trim();
  const data = customerIdentityInput({
    ...input,
    phone: unchangedLegacyPhone ? undefined : input.phone,
  });
  if (!id && data.normalizedPhone)
    existing = await tx.customer.findUnique({
      where: { normalizedPhone: data.normalizedPhone },
    });
  if (existing?.archivedAt) throw phoneConflict(existing);
  if (!existing) return tx.customer.create({ data });
  // Preserve existing contacts and historical invoice snapshots; fill missing fields only.
  const missing = {
    ...(!existing.phone && data.phone
      ? { phone: data.phone, normalizedPhone: data.normalizedPhone }
      : {}),
    ...(!existing.email && data.email ? { email: data.email } : {}),
    ...(!existing.address && data.address ? { address: data.address } : {}),
  };
  if ('normalizedPhone' in missing)
    await assertCustomerPhoneAvailable(tx, data.normalizedPhone, existing.id);
  return tx.customer.update({
    where: { id: existing.id },
    data: {
      ...missing,
      searchText: [
        existing.name,
        missing.phone ?? existing.phone,
        missing.normalizedPhone ?? existing.normalizedPhone,
        missing.email ?? existing.email,
      ]
        .filter(Boolean)
        .join(' '),
    },
  });
}
