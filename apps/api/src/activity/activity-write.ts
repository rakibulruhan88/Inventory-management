import { createHash } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import type { AuditAction } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';

// Explicit fields only: passwords, tokens, uploads, parser text and images never enter activity.
const fields = {
  Customer: ['name', 'phone', 'email', 'address', 'archivedAt'],
  Supplier: ['name', 'phone', 'email', 'address', 'notes', 'archivedAt'],
  Container: ['containerNumber', 'notes', 'archivedAt'],
  Product: ['itemCode', 'name', 'description', 'archivedAt'],
  ProductVariant: ['color', 'archivedAt'],
  StoreSettings: [
    'storeName',
    'storePhone',
    'storeEmail',
    'storeAddress',
    'currency',
    'currencySymbol',
    'invoicePrefix',
    'defaultPaymentMethod',
    'lowStockRollThreshold',
    'lowStockMeterThreshold',
    'brandAccent',
    'logoUrl',
    'faviconUrl',
  ],
  User: ['name', 'username', 'email', 'role', 'isActive'],
  InvoiceImportDraft: ['originalFileName', 'status', 'confirmedPurchaseId'],
} as const;
export type ActivityEntity = keyof typeof fields;
export function safeSnapshot(
  entityType: ActivityEntity,
  value: Record<string, unknown> | null,
) {
  if (!value) return null;
  const result: Record<string, string | boolean | null> = {};
  for (const key of fields[entityType]) {
    const v = value[key];
    if (v === undefined) continue;
    if (key === 'logoUrl' || key === 'faviconUrl') {
      result[key] = v
        ? 'image:' + createHash('sha256').update(String(v)).digest('hex')
        : null;
      continue;
    }
    result[key] =
      v === null
        ? null
        : v instanceof Date
          ? v.toISOString()
          : typeof v === 'boolean'
            ? v
            : String(v);
  }
  return result;
}
async function snapshot(
  tx: Prisma.TransactionClient,
  entity: ActivityEntity,
  id: string,
  lock = false,
) {
  // Table identifiers come from this static allowlist, never from a request.
  const rows = await tx.$queryRaw<Record<string, unknown>[]>(
    Prisma.sql`SELECT ${Prisma.raw(fields[entity].map((field) => '"' + field + '"').join(', '))} FROM ${Prisma.raw('"' + entity + '"')} WHERE id = ${id} ${lock ? Prisma.sql`FOR UPDATE` : Prisma.empty}`,
  );
  return safeSnapshot(entity, rows[0] ?? null);
}
export async function appendActivity(
  tx: Prisma.TransactionClient,
  input: {
    action: AuditAction;
    entityType: string;
    entityId: string;
    actorId?: string;
    reason?: string | null;
    metadata?: Prisma.InputJsonObject;
  },
) {
  // Snapshot the actor's display name so later account edits do not rewrite this history.
  const actor = input.actorId
    ? await tx.user.findUnique({
        where: { id: input.actorId },
        select: { name: true, role: true },
      })
    : null;
  return tx.auditLog.create({
    data: {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      userId: actor ? input.actorId : undefined,
      reason: input.reason,
      metadata: {
        ...input.metadata,
        ...(actor ? { actorName: actor.name, actorRole: actor.role } : {}),
      },
    },
  });
}
export async function auditMutation<T>(
  prisma: PrismaService,
  input: {
    action: AuditAction;
    entityType: ActivityEntity;
    entityId?: string;
    actorId?: string;
    label?: string;
    reason?: string;
    metadata?: Prisma.InputJsonObject;
  },
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const before = input.entityId
      ? await snapshot(tx, input.entityType, input.entityId, true)
      : null;
    const result = await work(tx);
    if (
      result &&
      typeof result === 'object' &&
      'count' in result &&
      result.count === 0
    )
      return result;
    const id = input.entityId ?? (result as { id?: string }).id;
    if (!id) throw new Error('Activity record needs a saved record ID.');
    const after = await snapshot(tx, input.entityType, id);
    const label =
      input.label ??
      String(
        after?.name ??
          after?.itemCode ??
          after?.color ??
          after?.containerNumber ??
          after?.storeName ??
          after?.originalFileName ??
          '',
      );
    await appendActivity(tx, {
      ...input,
      entityId: id,
      metadata: { ...input.metadata, label, before, after },
    });
    return result;
  });
}
