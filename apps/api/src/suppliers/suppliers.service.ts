import { auditMutation } from '../activity/activity-write.js';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  SupplierDetails,
  SupplierInput,
  SupplierPurchaseHistory,
  SupplierSummary,
} from '@afia/contracts';
import { normalizeText } from '../common/normalize.js';
import { normalizePhone } from '../common/party-resolution.js';
import { PrismaService } from '../prisma/prisma.service.js';

const cleanEmail = (value?: string) =>
  normalizeText(value).toLowerCase() || null;

@Injectable()
export class SuppliersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async search(
    search = '',
    includePayments = false,
  ): Promise<SupplierSummary[]> {
    const term = normalizeText(search);
    const phoneTerm = normalizePhone(term);
    const rows = await this.prisma.supplier.findMany({
      where: {
        archivedAt: null,
        ...(term
          ? {
              OR: [
                { name: { contains: term, mode: 'insensitive' as const } },
                { phone: { contains: term } },
                ...(phoneTerm && phoneTerm !== term
                  ? [{ phone: { contains: phoneTerm } }]
                  : []),
                { email: { contains: term, mode: 'insensitive' as const } },
                {
                  searchText: { contains: term, mode: 'insensitive' as const },
                },
              ],
            }
          : {}),
      },
      include: {
        _count: { select: { purchases: true } },
        purchases: { select: { totalAmount: true } },
      },
      orderBy: { name: 'asc' },
      take: 50,
    });

    const payments = includePayments
      ? await this.paymentSummaries(rows.map((row) => row.id))
      : null;
    return rows.map((row) => ({
      ...(payments
        ? (payments.get(row.id) ?? {
            totalPaidToSupplier: 0,
            supplierPaymentCount: 0,
          })
        : {}),
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      address: row.address,
      notes: row.notes,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      purchaseCount: row._count.purchases,
      totalPurchases: Number(
        row.purchases
          .reduce((sum, purchase) => sum + Number(purchase.totalAmount), 0)
          .toFixed(2),
      ),
    }));
  }

  async details(id: string, includePayments = false): Promise<SupplierDetails> {
    const row = await this.prisma.supplier.findUnique({
      where: { id },
      include: {
        purchases: {
          include: { container: true, lines: true },
          orderBy: { purchasedAt: 'desc' },
        },
        containers: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!row) throw new NotFoundException('Supplier not found.');

    const purchaseHistory: SupplierPurchaseHistory[] = row.purchases.map(
      (purchase) => ({
        id: purchase.id,
        purchaseNumber: purchase.purchaseNumber,
        containerId: purchase.containerId,
        containerNumber: purchase.container.containerNumber,
        status: purchase.status,
        purchasedAt: purchase.purchasedAt.toISOString(),
        totalAmount: Number(purchase.totalAmount),
        totalRolls: purchase.lines.reduce(
          (sum, line) => sum + line.rollCount,
          0,
        ),
        totalMeters: Number(
          purchase.lines
            .reduce((sum, line) => sum + Number(line.totalMeter), 0)
            .toFixed(2),
        ),
      }),
    );

    const payments = includePayments ? await this.paymentSummaries([id]) : null;
    const recentPayments = includePayments
      ? await this.prisma.financialEntry.findMany({
          where: { supplierId: id, type: 'SUPPLIER_PAYMENT', voidedAt: null },
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          take: 5,
          select: {
            id: true,
            occurredAt: true,
            amount: true,
            method: true,
            reference: true,
          },
        })
      : null;
    return {
      ...(payments
        ? (payments.get(id) ?? {
            totalPaidToSupplier: 0,
            supplierPaymentCount: 0,
          })
        : {}),
      ...(recentPayments
        ? {
            recentSupplierPayments: recentPayments.map((entry) => ({
              ...entry,
              occurredAt: entry.occurredAt.toISOString(),
              amount: Number(entry.amount),
            })),
          }
        : {}),
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      address: row.address,
      notes: row.notes,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      purchaseCount: purchaseHistory.length,
      totalPurchases: Number(
        row.purchases
          .reduce((sum, purchase) => sum + Number(purchase.totalAmount), 0)
          .toFixed(2),
      ),
      recentPurchases: purchaseHistory.slice(0, 5),
      purchaseHistory,
      shipments: row.containers.map((container) => ({
        id: container.id,
        containerNumber: container.containerNumber,
        status: container.status,
        shippedAt: container.shippedAt?.toISOString() ?? null,
        receivedAt: container.receivedAt?.toISOString() ?? null,
        purchaseId:
          row.purchases.find(
            (purchase) => purchase.containerId === container.id,
          )?.id ?? null,
      })),
    };
  }

  async create(
    input: SupplierInput,
    actorId?: string,
  ): Promise<SupplierSummary> {
    const supplier = await auditMutation(
      this.prisma,
      { action: 'RECORD_CREATED', entityType: 'Supplier', actorId },
      async (tx) =>
        tx.supplier.create({
          data: this.normalizedInput(input),
        }),
    );
    return this.summary(supplier.id);
  }

  async update(
    id: string,
    input: SupplierInput,
    actorId?: string,
  ): Promise<SupplierSummary> {
    const existing = await this.prisma.supplier.findFirst({
      where: { id, archivedAt: null },
    });
    if (!existing) throw new NotFoundException('Supplier not found.');
    await auditMutation(
      this.prisma,
      {
        action: 'RECORD_UPDATED',
        entityType: 'Supplier',
        entityId: id,
        actorId,
      },
      async (tx) =>
        tx.supplier.update({
          where: { id },
          data: this.normalizedInput(input),
        }),
    );
    return this.summary(id);
  }

  async archive(id: string, actorId?: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, archivedAt: null },
    });
    if (!supplier) throw new NotFoundException('Supplier not found.');
    await auditMutation(
      this.prisma,
      {
        action: 'RECORD_ARCHIVED',
        entityType: 'Supplier',
        entityId: id,
        actorId,
      },
      async (tx) =>
        tx.supplier.update({
          where: { id },
          data: { archivedAt: new Date() },
        }),
    );
    return { id, archived: true };
  }

  private async paymentSummaries(ids: string[]) {
    if (!ids.length)
      return new Map<
        string,
        { totalPaidToSupplier: number; supplierPaymentCount: number }
      >();
    const rows = await this.prisma.financialEntry.groupBy({
      by: ['supplierId'],
      where: {
        supplierId: { in: ids },
        type: 'SUPPLIER_PAYMENT',
        voidedAt: null,
      },
      _sum: { amount: true },
      _count: { _all: true },
    });
    return new Map(
      rows.map((row) => [
        row.supplierId!,
        {
          totalPaidToSupplier: Number(row._sum.amount ?? 0),
          supplierPaymentCount: row._count._all,
        },
      ]),
    );
  }

  private normalizedInput(input: SupplierInput) {
    const name = normalizeText(input.name);
    const phone = normalizePhone(input.phone) || null;
    const email = cleanEmail(input.email);
    const address = normalizeText(input.address) || null;
    const notes = normalizeText(input.notes) || null;
    return {
      name,
      phone,
      email,
      address,
      notes,
      searchText: [name, phone, email].filter(Boolean).join(' '),
    };
  }

  private async summary(id: string): Promise<SupplierSummary> {
    const row = await this.prisma.supplier.findUnique({
      where: { id },
      include: {
        _count: { select: { purchases: true } },
        purchases: { select: { totalAmount: true } },
      },
    });
    if (!row) throw new NotFoundException('Supplier not found.');
    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      address: row.address,
      notes: row.notes,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      purchaseCount: row._count.purchases,
      totalPurchases: Number(
        row.purchases
          .reduce((sum, purchase) => sum + Number(purchase.totalAmount), 0)
          .toFixed(2),
      ),
    };
  }
}
