import type {
  ActivityCategory,
  ActivityDetail,
  ActivityRow,
} from '@afia/contracts';
import type { Prisma } from '../generated/prisma/client.js';
import { safeSnapshot, type ActivityEntity } from './activity-write.js';
export const actionLabels: Record<string, string> = {
  SALE_CREATED: 'Sale completed',
  SALE_VOIDED: 'Sale voided',
  PURCHASE_RECEIVED: 'Purchase received',
  PURCHASE_REVERSED: 'Purchase reversed',
  STOCK_ADJUSTED: 'Stock adjusted',
  PAYMENT_RECEIVED: 'Payment received',
  CUSTOMER_PAYMENT_RECEIVED: 'Customer payment received',
  CUSTOMER_OPENING_BALANCE_CREATED: 'Opening Due added',
  FINANCIAL_ENTRY_CREATED: 'Money entry added',
  FINANCIAL_ENTRY_VOIDED: 'Money entry voided',
  RECORD_CREATED: 'Record added',
  RECORD_UPDATED: 'Record updated',
  RECORD_ARCHIVED: 'Record archived',
  SIGNED_IN: 'Signed in',
  SIGNED_OUT: 'Signed out',
  PASSWORD_CHANGED: 'Password changed',
  INVOICE_EMAIL_SENT: 'Invoice email sent',
  INVOICE_EMAIL_FAILED: 'Invoice email failed',
};
const entityLabels: Record<string, string> = {
  Customer: 'Customer',
  Supplier: 'Supplier',
  Product: 'Item',
  ProductVariant: 'Color',
  Container: 'Container',
  StoreSettings: 'Store settings',
  User: 'Account',
  InvoiceImportDraft: 'Invoice import',
};
export type ActivityRecord = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  reason: string | null;
  metadata: Prisma.JsonValue;
  userId: string | null;
  createdAt: Date;
  category: ActivityCategory;
  reference: string;
  label: string;
  actorCurrentName: string | null;
  actorCurrentRole: string | null;
};
export const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const scalar = (value: unknown): string | null =>
  ['string', 'number', 'boolean'].includes(typeof value) ? String(value) : null;
export function activityHref(row: ActivityRecord): string | null {
  const id = encodeURIComponent(row.entityId),
    meta = objectValue(row.metadata);
  if (row.entityType === 'Sale') return `/sales/${id}/invoice`;
  if (row.entityType === 'Purchase') return `/purchases/${id}`;
  if (row.entityType === 'Customer') return `/customers/${id}`;
  if (row.entityType === 'Supplier') return `/suppliers/${id}`;
  if (row.entityType === 'FinancialEntry') return `/cashbook/entries/${id}`;
  if (
    row.entityType === 'CustomerPaymentReceipt' &&
    typeof meta.customerId === 'string'
  )
    return `/customers/${encodeURIComponent(meta.customerId)}/receipts/${id}`;
  if (
    row.entityType === 'CustomerOpeningBalance' &&
    typeof meta.customerId === 'string'
  )
    return `/customers/${encodeURIComponent(meta.customerId)}`;
  if (row.entityType === 'Product' || row.entityType === 'ProductVariant')
    return '/inventory';
  if (row.entityType === 'Container') return '/containers';
  if (row.entityType === 'StoreSettings') return '/settings';
  if (row.entityType === 'User') return '/team';
  return null;
}
export function presentActivity(row: ActivityRecord): ActivityRow {
  const meta = objectValue(row.metadata);
  const verb =
    row.action === 'RECORD_CREATED'
      ? 'added'
      : row.action === 'RECORD_ARCHIVED'
        ? 'archived'
        : 'updated';
  return {
    id: row.id,
    action: row.action,
    title: row.action.startsWith('RECORD_')
      ? `${entityLabels[row.entityType] ?? 'Record'} ${verb}`
      : (actionLabels[row.action] ?? 'Activity recorded'),
    category: row.category,
    entityType: row.entityType,
    entityId: row.entityId,
    reference: row.reference || row.entityId,
    label: row.label,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    amount: scalar(meta.totalAmount ?? meta.amount),
    actor: row.userId
      ? {
          id: row.userId,
          name:
            scalar(meta.actorName) ??
            row.actorCurrentName ??
            'Name unavailable',
          role: scalar(meta.actorRole) ?? row.actorCurrentRole ?? '',
        }
      : null,
    href: activityHref(row),
  };
}
const detailLabels: Record<string, string> = {
  name: 'Name',
  phone: 'Phone',
  email: 'Email',
  address: 'Address',
  notes: 'Note',
  archivedAt: 'Archived at',
  itemCode: 'Item Code',
  description: 'Description / Size',
  color: 'Color',
  containerNumber: 'Container Number',
  storeName: 'Store name',
  storePhone: 'Store phone',
  storeEmail: 'Store email',
  storeAddress: 'Store address',
  currency: 'Currency',
  currencySymbol: 'Currency symbol',
  invoicePrefix: 'Invoice prefix',
  defaultPaymentMethod: 'Payment method',
  lowStockRollThreshold: 'Low stock Rolls',
  lowStockMeterThreshold: 'Low stock Meter',
  brandAccent: 'Brand color',
  logoUrl: 'Logo',
  faviconUrl: 'Favicon',
  username: 'Username',
  role: 'Role',
  isActive: 'Active',
  permissions: 'Staff access',
  deletedAt: 'Deleted at',
  originalFileName: 'File name',
  status: 'Status',
  confirmedPurchaseId: 'Purchase ID',
  totalAmount: 'Amount',
  amount: 'Amount',
  subtotal: 'Subtotal',
  discountAmount: 'Discount',
  receivedAmount: 'Received',
  rolls: 'Rolls',
  meter: 'Meter',
  rollsChange: 'Rolls change',
  meterChange: 'Meter change',
  totalRolls: 'Rolls received',
  totalMeter: 'Meter received',
  paidAt: 'Payment date',
  balanceAsOf: 'Balance Date',
  occurredAt: 'Entry date',
  type: 'Entry type',
  recipient: 'Email recipient',
};
export function presentActivityDetail(row: ActivityRecord): ActivityDetail {
  const meta = objectValue(row.metadata);
  const entity = row.entityType as ActivityEntity;
  const before =
    Object.keys(meta.before ? objectValue(meta.before) : {}).length &&
    Object.hasOwn(
      {
        Customer: 1,
        Supplier: 1,
        Container: 1,
        Product: 1,
        ProductVariant: 1,
        StoreSettings: 1,
        User: 1,
        InvoiceImportDraft: 1,
      },
      entity,
    )
      ? (safeSnapshot(entity, objectValue(meta.before)) ?? {})
      : {};
  const after =
    meta.after &&
    Object.hasOwn(
      {
        Customer: 1,
        Supplier: 1,
        Container: 1,
        Product: 1,
        ProductVariant: 1,
        StoreSettings: 1,
        User: 1,
        InvoiceImportDraft: 1,
      },
      entity,
    )
      ? (safeSnapshot(entity, objectValue(meta.after)) ?? {})
      : {};
  const details = Object.entries(detailLabels).flatMap(([key, label]) => {
    const value = scalar(meta[key]);
    return value === null ? [] : [{ label, value }];
  });
  if (Array.isArray(meta.lines))
    meta.lines.slice(0, 100).forEach((entry, index) => {
      const line = objectValue(entry);
      const mode = line.mode === 'BY_METER' ? 'Meter' : 'Roll';
      details.push({
        label: `Sale row ${index + 1}`,
        value: `${scalar(line.color) ?? ''} · ${scalar(line.rollsSold) ?? '0'} Rolls · ${scalar(line.meterSold) ?? '0'} Meter · Sell By: ${mode} · Unit Price / ${mode}: ৳${scalar(line.unitPrice) ?? '—'} · Amount: ৳${scalar(line.lineTotal) ?? '—'}`,
      });
    });
  if (Array.isArray(meta.purchaseRows)) meta.purchaseRows.slice(0, 100).forEach((entry, index) => {
    const line = objectValue(entry);
    details.push({ label: `Purchase row ${index + 1}`, value: `${scalar(line.itemCode) ?? ''} · ${scalar(line.color) ?? ''} · ${scalar(line.rolls) ?? '0'} Rolls · ${scalar(line.meter) ?? '0'} Meter` });
  });
  const changes = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => before[key] !== after[key])
    .map((key) => ({
      label: detailLabels[key] ?? key,
      before:
        key.endsWith('Url') && before[key]
          ? 'Saved image'
          : (scalar(before[key]) ?? '—'),
      after:
        key.endsWith('Url') && after[key]
          ? 'New image'
          : (scalar(after[key]) ?? '—'),
    }));
  if (meta.stockBefore && meta.stockAfter) {
    const oldStock = objectValue(meta.stockBefore),
      newStock = objectValue(meta.stockAfter);
    for (const key of ['rolls', 'meter'])
      if (oldStock[key] !== newStock[key])
        changes.push({
          label: key === 'rolls' ? 'Rolls' : 'Meter',
          before: scalar(oldStock[key]) ?? '—',
          after: scalar(newStock[key]) ?? '—',
        });
  }
  return {
    ...presentActivity(row),
    details,
    changes,
    hasSnapshot: Boolean(
      meta.before || meta.after || meta.lines || meta.stockBefore,
    ),
  };
}
