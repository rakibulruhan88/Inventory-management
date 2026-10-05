import { Inject, Injectable } from '@nestjs/common';
import type { ProductSearchResult } from '@afia/contracts';
import { normalizeText } from '../common/normalize.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ProductsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async search(search = ''): Promise<ProductSearchResult[]> {
    const term = normalizeText(search);
    const products = await this.prisma.product.findMany({
      where: term
        ? {
            archivedAt: null,
            OR: [
              { itemCode: { contains: term, mode: 'insensitive' } },
              { name: { contains: term, mode: 'insensitive' } },
              { searchText: { contains: term, mode: 'insensitive' } },
              {
                variants: {
                  some: { searchText: { contains: term, mode: 'insensitive' } },
                },
              },
            ],
          }
        : { archivedAt: null },
      select: {
        id: true,
        itemCode: true,
        name: true,
        variants: {
          where: { archivedAt: null },
          select: {
            id: true,
            color: true,
            colorCode: true,
            size: true,
            batches: {
              where: { container: { archivedAt: null } },
              select: { availableRolls: true, availableMeter: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { itemCode: 'asc' },
      take: 30,
    });

    return products.flatMap((product) =>
      product.variants.map((variant) => ({
        productId: product.id,
        variantId: variant.id,
        itemCode: product.itemCode,
        name: product.name,
        color: variant.color,
        colorCode: variant.colorCode,
        size: variant.size,
        availableRolls: variant.batches.reduce(
          (sum, batch) => sum + batch.availableRolls,
          0,
        ),
        availableMeter: Number(
          variant.batches
            .reduce((sum, batch) => sum + Number(batch.availableMeter), 0)
            .toFixed(2),
        ),
      })),
    );
  }
}
