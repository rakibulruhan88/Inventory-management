import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PurchaseSummary, ReceivePurchaseResponse } from '@afia/contracts';
import { normalizeCode, normalizeText } from '../common/normalize.js';
import {
  missingPartyDetails,
  normalizePartyInput,
  resolvePartyMatch,
} from '../common/party-resolution.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Supplier } from '../generated/prisma/client.js';
import type { ReceivePurchaseDto } from './dto/receive-purchase.dto.js';

@Injectable()
export class PurchasesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(search = ''): Promise<PurchaseSummary[]> {
    const term = normalizeText(search);
    const rows = await this.prisma.purchase.findMany({
      where: term
        ? {
            OR: [
              { purchaseNumber: { contains: term, mode: 'insensitive' } },
              { supplier: { name: { contains: term, mode: 'insensitive' } } },
              {
                container: {
                  containerNumber: { contains: term, mode: 'insensitive' },
                },
              },
              {
                lines: {
                  some: {
                    variant: {
                      product: {
                        itemCode: { contains: term, mode: 'insensitive' },
                      },
                    },
                  },
                },
              },
            ],
          }
        : {},
      include: { supplier: true, container: true, lines: true },
      orderBy: { purchasedAt: 'desc' },
      take: 50,
    });
    return rows.map((row) => ({
      id: row.id,
      purchaseNumber: row.purchaseNumber,
      supplierName: row.supplier.name,
      containerNumber: row.container.containerNumber,
      purchasedAt: row.purchasedAt.toISOString(),
      totalRolls: row.lines.reduce((s, l) => s + l.rollCount, 0),
      totalMeters: row.lines.reduce((s, l) => s + Number(l.totalMeter), 0),
      status: row.status,
    }));
  }

  async receive(
    input: ReceivePurchaseDto,
    actorId?: string,
  ): Promise<ReceivePurchaseResponse> {
    if (!input.supplierId && !input.supplier)
      throw new BadRequestException('Supplier name is required.');
    const normalizedContainerNumber = normalizeCode(input.containerNumber);
    const purchaseNumber = normalizeCode(input.purchaseNumber);
    const totalRolls = input.items.reduce((sum, item) => sum + item.rolls, 0);
    const totalMeter = input.items.reduce(
      (sum, item) => sum + (item.totalMeter ?? 0),
      0,
    );
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('afia-supplier-resolution'))`;
        let supplier: Supplier;
        if (input.supplier) {
          const normalized = normalizePartyInput({
            id: input.supplier.id ?? input.supplierId,
            name: input.supplier.name,
            phone: input.supplier.phone,
            email: input.supplier.email,
            address: input.supplier.address,
          });
          if (!normalized.name)
            throw new BadRequestException('Supplier name is required.');
          const active = await tx.supplier.findMany({
            where: { archivedAt: null },
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
              address: true,
            },
          });
          const match = resolvePartyMatch(normalized, active, 'supplier');
          if (match) {
            const missing = missingPartyDetails(match, normalized);
            supplier = await tx.supplier.update({
              where: { id: match.id },
              data: {
                ...missing,
                archivedAt: null,
                searchText: [
                  match.name,
                  missing.phone ?? match.phone,
                  missing.email ?? match.email,
                ]
                  .filter(Boolean)
                  .join(' '),
              },
            });
          } else {
            supplier = await tx.supplier.create({
              data: {
                name: normalized.name,
                phone: normalized.phone,
                email: normalized.email,
                address: normalized.address,
                searchText: [
                  normalized.name,
                  normalized.phone,
                  normalized.email,
                ]
                  .filter(Boolean)
                  .join(' '),
              },
            });
          }
        } else {
          const existing = await tx.supplier.findFirst({
            where: { id: input.supplierId, archivedAt: null },
          });
          if (!existing)
            throw new NotFoundException('Active supplier not found.');
          supplier = existing;
        }
        const supplierId = supplier.id;
        const container = await tx.container.create({
          data: {
            containerNumber: normalizeText(input.containerNumber),
            normalizedContainerNumber,
            supplierId,
            status: 'RECEIVED',
            receivedAt: new Date(input.purchasedAt),
            notes: normalizeText(input.notes) || null,
            searchText: normalizedContainerNumber,
          },
        });
        const purchase = await tx.purchase.create({
          data: {
            purchaseNumber,
            supplierId,
            containerId: container.id,
            status: 'RECEIVED',
            purchasedAt: new Date(input.purchasedAt),
            notes: normalizeText(input.notes) || null,
          },
        });
        const reusedItemCodes: string[] = [];
        for (const [index, item] of input.items.entries()) {
          const itemMeter = item.totalMeter ?? 0;
          const normalizedItemCode = normalizeCode(item.itemCode);
          const existing = await tx.product.findUnique({
            where: { normalizedItemCode },
            select: { id: true },
          });
          if (existing && !reusedItemCodes.includes(normalizedItemCode))
            reusedItemCodes.push(normalizedItemCode);
          const product = await tx.product.upsert({
            where: { normalizedItemCode },
            create: {
              itemCode: normalizeText(item.itemCode),
              normalizedItemCode,
              name: normalizeText(item.name) || null,
              searchText: [normalizedItemCode, normalizeText(item.name)]
                .filter(Boolean)
                .join(' '),
            },
            update: {
              ...(item.name ? { name: normalizeText(item.name) } : {}),
              archivedAt: null,
            },
          });
          const color = normalizeText(item.color);
          const size = normalizeText(item.size) || null;
          const variantKey = `${normalizeCode(color)}|${normalizeCode(size ?? 'default')}`;
          const variant = await tx.productVariant.upsert({
            where: {
              productId_variantKey: { productId: product.id, variantKey },
            },
            create: {
              productId: product.id,
              color,
              colorCode: item.colorCode.toUpperCase(),
              size,
              variantKey,
              searchText: [normalizedItemCode, color, size]
                .filter(Boolean)
                .join(' '),
            },
            update: {
              colorCode: item.colorCode.toUpperCase(),
              archivedAt: null,
            },
          });
          const batch = await tx.inventoryBatch.create({
            data: {
              batchCode: `${normalizedContainerNumber}-${String(index + 1).padStart(2, '0')}`,
              containerId: container.id,
              variantId: variant.id,
              receivedAt: new Date(input.purchasedAt),
              originalRolls: item.rolls,
              originalMeter: itemMeter,
              availableRolls: item.rolls,
              availableMeter: itemMeter,
            },
          });
          await tx.purchaseLine.create({
            data: {
              purchaseId: purchase.id,
              variantId: variant.id,
              batchId: batch.id,
              rollCount: item.rolls,
              totalMeter: itemMeter,
            },
          });
          await tx.stockMovement.create({
            data: {
              type: 'PURCHASE',
              variantId: variant.id,
              batchId: batch.id,
              reference: purchaseNumber,
              rollsChange: item.rolls,
              meterChange: itemMeter,
            },
          });
        }
        await tx.auditLog.create({
          data: {
            action: 'PURCHASE_RECEIVED',
            entityType: 'Purchase',
            entityId: purchase.id,
            userId: actorId,
          },
        });
        return {
          id: purchase.id,
          purchaseNumber,
          containerNumber: container.containerNumber,
          totalRolls,
          totalMeter: Number(totalMeter.toFixed(2)),
          reusedItemCodes,
        };
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      )
        throw new ConflictException(
          'This container number or purchase number already exists. Please use a unique number.',
        );
      throw error;
    }
  }
  async reverse(id: string, reason: string, actorId?: string) {
    const cleanReason = normalizeText(reason);
    if (!cleanReason)
      throw new ConflictException('Correction reason is required.');
    return this.prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.findUnique({
        where: { id },
        include: { lines: { include: { batch: true } } },
      });
      if (!purchase) throw new NotFoundException('Purchase not found.');
      if (purchase.status !== 'RECEIVED')
        throw new ConflictException(
          'This purchase has already been corrected.',
        );
      const changed = purchase.lines.some(
        (line) =>
          line.batch.availableRolls !== line.batch.originalRolls ||
          Number(line.batch.availableMeter) !==
            Number(line.batch.originalMeter),
      );
      if (changed)
        throw new ConflictException(
          'Stock from this purchase has already changed. Use Stock Adjustment so the history stays accurate.',
        );
      for (const line of purchase.lines) {
        await tx.inventoryBatch.update({
          where: { id: line.batchId },
          data: { availableRolls: 0, availableMeter: 0 },
        });
        await tx.stockMovement.create({
          data: {
            type: 'PURCHASE_REVERSAL',
            variantId: line.variantId,
            batchId: line.batchId,
            reference: purchase.purchaseNumber,
            rollsChange: -line.rollCount,
            meterChange: -Number(line.totalMeter),
            reason: cleanReason,
            actorId,
          },
        });
      }
      await tx.purchase.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          correctedAt: new Date(),
          correctionReason: cleanReason,
        },
      });
      await tx.container.update({
        where: { id: purchase.containerId },
        data: { status: 'CLOSED', archivedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          action: 'PURCHASE_REVERSED',
          entityType: 'Purchase',
          entityId: id,
          reason: cleanReason,
          userId: actorId,
        },
      });
      return { id, reversed: true };
    });
  }
}
