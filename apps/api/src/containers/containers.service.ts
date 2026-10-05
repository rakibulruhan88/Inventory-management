import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ContainerSummary, ContainerUpdateInput } from '@afia/contracts';
import { normalizeCode, normalizeText } from '../common/normalize.js';
import { PrismaService } from '../prisma/prisma.service.js';
@Injectable()
export class ContainersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async list(search = ''): Promise<ContainerSummary[]> {
    const term = normalizeText(search);
    const containers = await this.prisma.container.findMany({
      where: {
        archivedAt: null,
        ...(term
          ? {
              OR: [
                { containerNumber: { contains: term, mode: 'insensitive' } },
                { supplier: { name: { contains: term, mode: 'insensitive' } } },
                {
                  batches: {
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
          : {}),
      },
      select: {
        id: true,
        containerNumber: true,
        status: true,
        receivedAt: true,
        notes: true,
        supplier: { select: { name: true } },
        batches: {
          select: {
            variantId: true,
            availableRolls: true,
            availableMeter: true,
          },
        },
      },
      orderBy: { receivedAt: 'desc' },
      take: 50,
    });
    return containers.map((container) => ({
      id: container.id,
      containerNumber: container.containerNumber,
      supplierName: container.supplier.name,
      status: container.status,
      receivedAt: container.receivedAt?.toISOString() ?? null,
      totalItems: new Set(container.batches.map((batch) => batch.variantId))
        .size,
      totalRolls: container.batches.reduce(
        (sum, batch) => sum + batch.availableRolls,
        0,
      ),
      totalMeters: Number(
        container.batches
          .reduce((sum, batch) => sum + Number(batch.availableMeter), 0)
          .toFixed(2),
      ),
      notes: container.notes,
    }));
  }
  async update(id: string, input: ContainerUpdateInput) {
    try {
      return await this.prisma.container.update({
        where: { id, archivedAt: null },
        data: {
          containerNumber: normalizeText(input.containerNumber),
          normalizedContainerNumber: normalizeCode(input.containerNumber),
          notes: normalizeText(input.notes) || null,
          searchText: normalizeCode(input.containerNumber),
        },
        select: { id: true, containerNumber: true, notes: true },
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error &&
        'code' in error &&
        error.code === 'P2002'
      )
        throw new ConflictException('Container number already exists.');
      if (
        typeof error === 'object' &&
        error &&
        'code' in error &&
        error.code === 'P2025'
      )
        throw new NotFoundException('Container not found.');
      throw error;
    }
  }
  async archive(id: string) {
    const container = await this.prisma.container.findFirst({
      where: { id, archivedAt: null },
      include: { batches: true },
    });
    if (!container) throw new NotFoundException('Container not found.');
    const rolls = container.batches.reduce((s, b) => s + b.availableRolls, 0);
    const meter = container.batches.reduce(
      (s, b) => s + Number(b.availableMeter),
      0,
    );
    if (rolls > 0 || meter > 0)
      throw new ConflictException(
        `This container still has ${rolls} Rolls and ${meter.toLocaleString()} Meter in stock. It cannot be archived.`,
      );
    await this.prisma.container.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
    return { id, archived: true };
  }
}
