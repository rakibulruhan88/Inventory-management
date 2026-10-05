import { Inject, Injectable } from '@nestjs/common';
import type { GlobalSearchGroup } from '@afia/contracts';
import { normalizeText } from '../common/normalize.js';
import { PrismaService } from '../prisma/prisma.service.js';
@Injectable()
export class SearchService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async search(query = ''): Promise<GlobalSearchGroup[]> {
    const q = normalizeText(query);
    if (q.length < 2) return [];
    const [products, sales, purchases, containers, customers, suppliers] =
      await Promise.all([
        this.prisma.product.findMany({
          where: {
            archivedAt: null,
            OR: [
              { itemCode: { contains: q, mode: 'insensitive' } },
              { name: { contains: q, mode: 'insensitive' } },
              {
                variants: {
                  some: { color: { contains: q, mode: 'insensitive' } },
                },
              },
            ],
          },
          take: 5,
        }),
        this.prisma.sale.findMany({
          where: {
            OR: [
              { invoiceNumber: { contains: q, mode: 'insensitive' } },
              { customer: { name: { contains: q, mode: 'insensitive' } } },
              { payments: { some: { reference: { contains: q, mode: 'insensitive' } } } },
            ],
          },
          include: { customer: true },
          take: 5,
        }),
        this.prisma.purchase.findMany({
          where: {
            OR: [
              { purchaseNumber: { contains: q, mode: 'insensitive' } },
              {
                container: {
                  containerNumber: { contains: q, mode: 'insensitive' },
                },
              },
            ],
          },
          include: { container: true, supplier: true },
          take: 5,
        }),
        this.prisma.container.findMany({
          where: {
            archivedAt: null,
            containerNumber: { contains: q, mode: 'insensitive' },
          },
          include: { supplier: true },
          take: 5,
        }),
        this.prisma.customer.findMany({
          where: {
            archivedAt: null,
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { phone: { contains: q } },
              { email: { contains: q, mode: 'insensitive' } },
            ],
          },
          take: 5,
        }),
        this.prisma.supplier.findMany({
          where: {
            archivedAt: null,
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { phone: { contains: q } },
              { email: { contains: q, mode: 'insensitive' } },
            ],
          },
          take: 5,
        }),
      ]);
    return [
      ...products.map((x) => ({
        type: 'product' as const,
        id: x.id,
        title: x.itemCode,
        subtitle: x.name || 'Leather item',
        path: `/inventory?search=${encodeURIComponent(q)}`,
      })),
      ...sales.map((x) => ({
        type: 'sale' as const,
        id: x.id,
        title: x.invoiceNumber,
        subtitle: x.customer.name,
        path: `/sales/${x.id}/invoice`,
      })),
      ...purchases.map((x) => ({
        type: 'purchase' as const,
        id: x.id,
        title: x.purchaseNumber,
        subtitle: `${x.container.containerNumber} · ${x.supplier.name}`,
        path: `/purchases?search=${encodeURIComponent(q)}`,
      })),
      ...containers.map((x) => ({
        type: 'container' as const,
        id: x.id,
        title: x.containerNumber,
        subtitle: x.supplier.name,
        path: `/containers?search=${encodeURIComponent(q)}`,
      })),
      ...customers.map((x) => ({
        type: 'customer' as const,
        id: x.id,
        title: x.name,
        subtitle: x.phone || x.email || 'No contact details',
        path: `/customers/${x.id}`,
      })),
      ...suppliers.map((x) => ({
        type: 'supplier' as const,
        id: x.id,
        title: x.name,
        subtitle: x.phone || x.email || 'No contact details',
        path: `/suppliers/${x.id}`,
      })),
    ];
  }
}
