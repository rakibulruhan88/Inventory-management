import type { Prisma } from '../generated/prisma/client.js';
// Original successful posting event is authoritative. Missing historical actors stay unknown.
export async function documentActor(
  tx: Pick<Prisma.TransactionClient, 'auditLog'>,
  entityType: string,
  entityId: string,
  action:
    | 'SALE_CREATED'
    | 'CUSTOMER_PAYMENT_RECEIVED'
    | 'FINANCIAL_ENTRY_CREATED'
    | 'PURCHASE_RECEIVED',
) {
  const event = await tx.auditLog.findFirst({
    where: { entityType, entityId, action },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { user: { select: { name: true } } },
  });
  const metadata = event?.metadata;
  const saved =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? metadata.actorName
      : null;
  return typeof saved === 'string' && saved
    ? saved
    : (event?.user?.name ?? null);
}
