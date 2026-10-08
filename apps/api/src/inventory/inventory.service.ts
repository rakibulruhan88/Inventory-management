import { auditMutation, appendActivity } from '../activity/activity-write.js';
import { accountSourcesSql } from '../customers/account-balances.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  InventoryItemSummary,
  InventorySummary,
  UpdateProductRequest,
  UpdateVariantRequest,
} from '@afia/contracts';
import { normalizeCode, normalizeText } from '../common/normalize.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class InventoryService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  private activeBatch = {
    container: { archivedAt: null },
    variant: { archivedAt: null, product: { archivedAt: null } },
  } as const;

  async summary(): Promise<InventorySummary> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const [totalItems, stock, due, today] = await Promise.all([
      this.prisma.product.count({ where: { archivedAt: null } }),
      this.prisma.inventoryBatch.aggregate({
        _sum: { availableRolls: true, availableMeter: true },
        where: this.activeBatch,
      }),
      this.prisma.$queryRaw<{ amount: Prisma.Decimal }[]>(
        Prisma.sql`SELECT COALESCE(SUM(due), 0) AS amount FROM (${accountSourcesSql}) sources`,
      ),
      this.prisma.sale.aggregate({
        _sum: { totalAmount: true },
        where: { status: 'COMPLETED', soldAt: { gte: todayStart } },
      }),
    ]);
    return {
      totalItems,
      totalRolls: stock._sum.availableRolls ?? 0,
      totalMeters: Number(stock._sum.availableMeter ?? 0),
      openRolls: 0,
      totalCustomerDue: Number(due[0].amount),
      todaySales: Number(today._sum.totalAmount ?? 0),
    };
  }

  async items(search = ''): Promise<InventoryItemSummary[]> {
    const term = normalizeText(search);
    const products = await this.prisma.product.findMany({
      where: {
        archivedAt: null,
        ...(term
          ? {
              OR: [
                { itemCode: { contains: term, mode: 'insensitive' } },
                { name: { contains: term, mode: 'insensitive' } },
                { description: { contains: term, mode: 'insensitive' } },
                {
                  variants: {
                    some: {
                      OR: [
                        { color: { contains: term, mode: 'insensitive' } },
                        {
                          batches: {
                            some: {
                              container: {
                                containerNumber: {
                                  contains: term,
                                  mode: 'insensitive',
                                },
                              },
                            },
                          },
                        },
                      ],
                    },
                  },
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        itemCode: true,
        name: true,
        description: true,
        variants: {
          where: { archivedAt: null },
          select: {
            id: true,
            color: true,
            batches: {
              where: { container: { archivedAt: null } },
              select: {
                id: true,
                availableRolls: true,
                availableMeter: true,
                containerId: true,
                container: { select: { containerNumber: true } },
              },
              orderBy: { receivedAt: 'asc' },
            },
          },
          orderBy: { color: 'asc' },
        },
      },
      orderBy: { itemCode: 'asc' },
      take: 50,
    });
    return products.map((product) => {
      const variants = product.variants.map((variant) => ({
        variantId: variant.id,
        color: variant.color,
        totalRolls: variant.batches.reduce((s, b) => s + b.availableRolls, 0),
        totalMeters: Number(
          variant.batches
            .reduce((s, b) => s + Number(b.availableMeter), 0)
            .toFixed(2),
        ),
        openRolls: 0,
        rolls: [] as never[],
        batches: variant.batches.map((b) => ({
          batchId: b.id,
          containerNumber: b.container.containerNumber,
          availableRolls: b.availableRolls,
          availableMeter: Number(b.availableMeter),
        })),
      }));
      return {
        productId: product.id,
        itemCode: product.itemCode,
        name: product.name,
        description: product.description,
        totalRolls: variants.reduce((s, v) => s + v.totalRolls, 0),
        totalMeters: Number(
          variants.reduce((s, v) => s + v.totalMeters, 0).toFixed(2),
        ),
        colorCount: variants.length,
        containerCount: new Set(
          product.variants.flatMap((v) => v.batches.map((b) => b.containerId)),
        ).size,
        variants,
      };
    });
  }

  async updateProduct(id: string, input: UpdateProductRequest, actorId?: string) {
    try {
      const itemCode = normalizeText(input.itemCode);
      if (!itemCode) throw new BadRequestException('Item code is required.');
      const name = normalizeText(input.name) || null;
      return await auditMutation(this.prisma, { action: 'RECORD_UPDATED', entityType: 'Product', entityId: id, actorId }, async (tx) => tx.product.update({
        where: { id, archivedAt: null },
        data: {
          itemCode,
          normalizedItemCode: normalizeCode(itemCode),
          name,
          ...(input.description !== undefined
            ? { description: normalizeText(input.description) || null }
            : {}),
          searchText: [itemCode, name].filter(Boolean).join(' '),
        },
        select: { id: true, itemCode: true, name: true, description: true },
      }));
    } catch (error) {
      this.handle(error, 'Item not found.');
    }
  }
  async archiveProduct(id: string, actorId?: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, archivedAt: null },
      include: { variants: { include: { batches: true } } },
    });
    if (!product) throw new NotFoundException('Item not found.');
    const rolls = product.variants
      .flatMap((v) => v.batches)
      .reduce((s, b) => s + b.availableRolls, 0);
    const meter = product.variants
      .flatMap((v) => v.batches)
      .reduce((s, b) => s + Number(b.availableMeter), 0);
    if (rolls > 0 || meter > 0)
      throw new ConflictException(
        `This item still has ${rolls} Rolls and ${meter.toLocaleString()} Meter in stock. It cannot be archived.`,
      );
    const archivedAt = new Date();
    await auditMutation(this.prisma, { action: 'RECORD_ARCHIVED', entityType: 'Product', entityId: id, actorId }, async (tx) => {
      await tx.product.update({ where: { id }, data: { archivedAt } });
      await tx.productVariant.updateMany({
        where: { productId: id },
        data: { archivedAt },
      });
      return { id, archived: true };
    });
    return { id, archived: true };
  }
  async updateVariant(id: string, input: UpdateVariantRequest, actorId?: string) {
    const color = normalizeText(input.color);
    if (!color) throw new BadRequestException('Color Code is required.');
    const variant = await this.prisma.productVariant.findFirst({
      where: { id, archivedAt: null },
      select: {
        productId: true,
        product: { select: { normalizedItemCode: true } },
      },
    });
    if (!variant) throw new NotFoundException('Color variant not found.');
    const others = await this.prisma.productVariant.findMany({
      where: { productId: variant.productId, id: { not: id } },
    });
    if (
      others.some(
        (other) => normalizeCode(other.color) === normalizeCode(color),
      )
    )
      throw new ConflictException(
        'This supplier Color Code already exists for this item.',
      );
    try {
      return await auditMutation(this.prisma, { action: 'RECORD_UPDATED', entityType: 'ProductVariant', entityId: id, actorId }, async (tx) => tx.productVariant.update({
        where: { id },
        data: {
          color,
          variantKey: normalizeCode(color),
          searchText: [variant.product.normalizedItemCode, color]
            .filter(Boolean)
            .join(' '),
        },
        select: { id: true, color: true },
      }));
    } catch (error) {
      this.handle(error, 'Color variant not found.');
    }
  }
  async archiveVariant(id: string, actorId?: string) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id, archivedAt: null },
      include: { batches: true },
    });
    if (!variant) throw new NotFoundException('Color variant not found.');
    const rolls = variant.batches.reduce((s, b) => s + b.availableRolls, 0);
    const meter = variant.batches.reduce(
      (s, b) => s + Number(b.availableMeter),
      0,
    );
    if (rolls > 0 || meter > 0)
      throw new ConflictException(
        `This color still has ${rolls} Rolls and ${meter.toLocaleString()} Meter in stock. It cannot be archived.`,
      );
    await auditMutation(this.prisma, { action: 'RECORD_ARCHIVED', entityType: 'ProductVariant', entityId: id, actorId }, async (tx) => tx.productVariant.update({
      where: { id },
      data: { archivedAt: new Date() },
    }));
    return { id, archived: true };
  }
  async adjustStock(
    variantId: string,
    rollsChange: number,
    meterChange: number,
    reason: string,
    actorId?: string,
  ) {
    const cleanReason = normalizeText(reason);
    if (!rollsChange && !meterChange)
      throw new ConflictException('Enter a Roll or Meter change.');
    return this.prisma.$transaction(async (tx) => {
      const batches = await tx.inventoryBatch.findMany({
        where: { variantId, container: { archivedAt: null } },
        orderBy: { receivedAt: 'asc' },
      });
      if (!batches.length)
        throw new NotFoundException('No stock batch was found for this color.');
      const currentRolls = batches.reduce(
        (sum, batch) => sum + batch.availableRolls,
        0,
      );
      const currentMeter = batches.reduce(
        (sum, batch) => sum + Number(batch.availableMeter),
        0,
      );
      const resultingRolls = currentRolls + rollsChange;
      const requestedMeter = currentMeter + meterChange;
      if (resultingRolls < 0 || requestedMeter < 0)
        throw new ConflictException(
          'An adjustment cannot make stock negative.',
        );
      const targetMeter = resultingRolls === 0 ? 0 : requestedMeter;
      let rollsLeft = rollsChange;
      let meterLeft = targetMeter - currentMeter;
      let actualMeter = currentMeter;
      const targets =
        rollsLeft < 0 || meterLeft < 0 ? batches : [...batches].reverse();
      for (const batch of targets) {
        const rollDelta =
          rollsLeft < 0
            ? -Math.min(-rollsLeft, batch.availableRolls)
            : rollsLeft > 0
              ? rollsLeft
              : 0;
        const plannedMeterDelta =
          meterLeft < 0
            ? -Math.min(-meterLeft, Number(batch.availableMeter))
            : meterLeft > 0
              ? meterLeft
              : 0;
        const availableMeter = Number(batch.availableMeter);
        const rollsAfter = batch.availableRolls + rollDelta;
        const meterAfter =
          rollsAfter <= 0
            ? 0
            : Number((availableMeter + plannedMeterDelta).toFixed(2));
        const actualMeterDelta = Number(
          (meterAfter - availableMeter).toFixed(2),
        );
        if (!rollDelta && !actualMeterDelta) continue;
        await tx.inventoryBatch.update({
          where: { id: batch.id },
          data: {
            availableRolls: rollsAfter,
            availableMeter: meterAfter,
          },
        });
        await tx.stockMovement.create({
          data: {
            type: 'ADJUSTMENT',
            variantId,
            batchId: batch.id,
            reference: 'Stock adjustment',
            rollsChange: rollDelta,
            meterChange: actualMeterDelta,
            reason: cleanReason,
            actorId,
          },
        });
        rollsLeft -= rollDelta;
        meterLeft = Number((meterLeft - plannedMeterDelta).toFixed(2));
        actualMeter = Number((actualMeter + actualMeterDelta).toFixed(2));
      }
      await appendActivity(tx, {
          action: 'STOCK_ADJUSTED',
          metadata: { rollsChange, meterChange, rolls: resultingRolls, meter: actualMeter, stockBefore: { rolls: currentRolls, meter: currentMeter }, stockAfter: { rolls: resultingRolls, meter: actualMeter } },
          entityType: 'ProductVariant',
          entityId: variantId,
          reason: cleanReason,
          actorId: actorId,
        });
      return { variantId, rolls: resultingRolls, meter: actualMeter };
    });
  }
  private handle(error: unknown, message: string): never {
    if (typeof error === 'object' && error && 'code' in error) {
      if (error.code === 'P2002')
        throw new ConflictException('That item code or color already exists.');
      if (error.code === 'P2025') throw new NotFoundException(message);
    }
    throw error;
  }
}
