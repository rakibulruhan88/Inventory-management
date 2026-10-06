import { ConflictException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from './prisma/prisma.service.js';
import { PurchasesService } from './purchases/purchases.service.js';
import { ReceivePurchaseDto } from './purchases/dto/receive-purchase.dto.js';
import { InventoryService } from './inventory/inventory.service.js';
import { ProductsService } from './products/products.service.js';
import { SearchService } from './search/search.service.js';

describe('supplier invoice identity', () => {
  const prisma = new PrismaService(new ConfigService());
  const purchases = new PurchasesService(prisma);
  const inventory = new InventoryService(prisma);
  const products = new ProductsService(prisma);
  const search = new SearchService(prisma);
  const tag = `SUPPLIER-${Date.now()}`;
  const description = `1.2mm*54"*36.5m ${tag}`;
  let supplierId: string;
  let seq = 0;
  const request = () => ({
    purchaseNumber: `${tag}-P${++seq}`,
    supplierId,
    containerNumber: `${tag}-B${seq}`,
    purchasedAt: new Date().toISOString(),
    items: [
      {
        itemCode: tag,
        description,
        colors: [
          { color: '02#Pine green', rolls: 35, totalMeter: 1263.5 },
          { color: 'F07111#Green', rolls: 2 },
        ],
      },
    ],
  });
  beforeAll(async () => {
    supplierId = (await prisma.supplier.create({ data: { name: tag } })).id;
  });
  afterAll(async () => {
    const receipts = await prisma.purchase.findMany({ where: { supplierId } });
    for (const receipt of receipts) {
      await prisma.stockMovement.deleteMany({
        where: { batch: { containerId: receipt.containerId } },
      });
      await prisma.purchaseLine.deleteMany({
        where: { purchaseId: receipt.id },
      });
      await prisma.inventoryBatch.deleteMany({
        where: { containerId: receipt.containerId },
      });
      await prisma.purchase.delete({ where: { id: receipt.id } });
      await prisma.container.delete({ where: { id: receipt.containerId } });
    }
    await prisma.productVariant.deleteMany({
      where: { product: { itemCode: tag } },
    });
    await prisma.product.deleteMany({ where: { itemCode: tag } });
    await prisma.supplier.delete({ where: { id: supplierId } });
    await prisma.$disconnect();
  });
  it('validates nested textual colors and rejects obsolete per-color fields', async () => {
    const dto = plainToInstance(ReceivePurchaseDto, request());
    expect(
      await validate(dto, { whitelist: true, forbidNonWhitelisted: true }),
    ).toEqual([]);
    const obsolete = plainToInstance(ReceivePurchaseDto, {
      ...request(),
      items: [
        {
          itemCode: tag,
          colors: [
            { color: 'Black', rolls: 1, size: '12x12', colorCode: '#000000' },
          ],
        },
      ],
    });
    expect(
      (
        await validate(obsolete, {
          whitelist: true,
          forbidNonWhitelisted: true,
        })
      ).length,
    ).toBeGreaterThan(0);
    const emptyColors = plainToInstance(ReceivePurchaseDto, {
      ...request(),
      items: [{ itemCode: tag, colors: [] }],
    });
    expect((await validate(emptyColors)).length).toBeGreaterThan(0);
  });
  it('reuses one product across containers and adds colors without requiring a name', async () => {
    const first = request();
    await purchases.receive(first);
    const second = request();
    second.items[0].colors = [
      { color: '19#Beige', rolls: 35, totalMeter: 1287 },
    ];
    expect((await purchases.receive(second)).reusedItemCodes).toEqual([tag]);
    const rows = await inventory.items(tag);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      description,
      name: null,
      colorCount: 3,
      totalRolls: 72,
      totalMeters: 2550.5,
      containerCount: 2,
    });
    expect(rows[0].variants.map((v) => v.color)).toContain('02#Pine green');
    expect(rows[0].variants[0]).not.toHaveProperty('size');
    expect(rows[0].variants[0]).not.toHaveProperty('colorCode');
    for (const term of [description, '02#Pine green', first.containerNumber]) {
      expect(
        (await inventory.items(term)).some((p) => p.itemCode === tag),
      ).toBe(true);
      expect(
        (await products.search(term)).some((p) => p.itemCode === tag),
      ).toBe(true);
      expect(
        (await search.search(term)).some(
          (p) => p.type === 'product' && p.title === tag,
        ),
      ).toBe(true);
    }
  });
  it('rejects description conflicts atomically and preserves container uniqueness', async () => {
    const conflicting = request();
    conflicting.items[0].description = 'Different size';
    await expect(purchases.receive(conflicting)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(
      await prisma.container.count({
        where: { containerNumber: conflicting.containerNumber },
      }),
    ).toBe(0);
    expect((await inventory.items(tag))[0].description).toBe(description);
    const duplicate = request();
    duplicate.containerNumber = (
      await prisma.container.findFirstOrThrow({ where: { supplierId } })
    ).containerNumber;
    await expect(purchases.receive(duplicate)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
  it('rejects normalized duplicate colors and supports explicit item description edits', async () => {
    const duplicate = request();
    duplicate.items[0].colors = [
      { color: '02#Pine green', rolls: 1 },
      { color: '02#pine GREEN', rolls: 1 },
    ];
    await expect(purchases.receive(duplicate)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const item = (await inventory.items(tag))[0];
    await expect(
      inventory.updateVariant(item.variants[0].variantId, {
        color: item.variants[1].color,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await inventory.updateProduct(item.productId, {
      itemCode: tag,
      description: 'Explicit size update',
    });
    expect((await inventory.items(tag))[0].description).toBe(
      'Explicit size update',
    );
    const updated = request();
    updated.items[0].description = 'Explicit size update';
    await purchases.receive(updated);
  });
});
