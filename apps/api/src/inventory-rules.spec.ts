import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma/prisma.service.js';
import { PurchasesService } from './purchases/purchases.service.js';
import { SalesService } from './sales/sales.service.js';
import { CustomersService } from './customers/customers.service.js';
import { InventoryService } from './inventory/inventory.service.js';
import { MailService } from './mail/mail.service.js';

describe('final roll-only inventory and sale rules', () => {
  const tag = `RULE-${Date.now()}`;
  const prisma = new PrismaService(new ConfigService());
  const purchases = new PurchasesService(prisma);
  const sales = new SalesService(prisma);
  const customers = new CustomersService(prisma);
  const inventory = new InventoryService(prisma);
  let supplierId = '';
  let customerId = '';
  let hardCustomerId = '';
  let batchCustomerId = '';
  let variantId = '';

  const stock = async () => {
    const result = await prisma.inventoryBatch.aggregate({
      where: { variantId },
      _sum: { availableRolls: true, availableMeter: true },
    });
    return {
      rolls: result._sum.availableRolls ?? 0,
      meter: Number(result._sum.availableMeter ?? 0),
    };
  };

  beforeAll(async () => {
    await prisma.$connect();
    supplierId = (
      await prisma.supplier.create({
        data: { name: `${tag} Supplier`, searchText: tag },
      })
    ).id;
    customerId = (
      await prisma.customer.create({
        data: {
          name: `${tag} Customer`,
          phone: '01700000000',
          address: 'Dhaka',
          searchText: tag,
        },
      })
    ).id;
  });

  it('accepts purchases with Meter omitted and with Meter supplied', async () => {
    const withoutMeter = await purchases.receive({
      purchaseNumber: `${tag}-P1`,
      supplierId,
      containerNumber: `${tag}-C1`,
      purchasedAt: new Date('2026-09-01').toISOString(),
      items: [
        {
          itemCode: `${tag}-ITEM`,
          color: 'Black',
          colorCode: '#000000',
          rolls: 5,
        },
      ],
    });
    expect(withoutMeter).toMatchObject({ totalRolls: 5, totalMeter: 0 });
    const withMeter = await purchases.receive({
      purchaseNumber: `${tag}-P2`,
      supplierId,
      containerNumber: `${tag}-C2`,
      purchasedAt: new Date('2026-09-02').toISOString(),
      items: [
        {
          itemCode: `${tag}-ITEM`,
          color: 'Black',
          colorCode: '#000000',
          rolls: 4,
          totalMeter: 1200,
        },
      ],
    });
    expect(withMeter).toMatchObject({ totalRolls: 4, totalMeter: 1200 });
    variantId = (
      await prisma.productVariant.findFirstOrThrow({
        where: { product: { normalizedItemCode: `${tag}-ITEM` } },
      })
    ).id;
    expect(await stock()).toEqual({ rolls: 9, meter: 1200 });
  });

  it('requires at least one Roll and rejects meter-only sales', async () => {
    await expect(
      sales.create({
        customerId,
        soldAt: new Date().toISOString(),
        discountAmount: 0,
        receivedAmount: 0,
        lines: [{ variantId, rollsSold: 0, meterSold: 100, lineTotal: 1000 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await stock()).toEqual({ rolls: 9, meter: 1200 });
  });

  it('sells Rolls from the oldest zero-meter batch and leaves Meter unchanged when omitted', async () => {
    await sales.create({
      customerId,
      soldAt: new Date().toISOString(),
      discountAmount: 0,
      receivedAmount: 0,
      lines: [{ variantId, rollsSold: 2, lineTotal: 80000 }],
    });
    expect(await stock()).toEqual({ rolls: 7, meter: 1200 });
  });

  it('deducts supplied Meter and Rolls, uses manual amount, and handles discount and change', async () => {
    const result = await sales.create({
      customerId,
      soldAt: new Date().toISOString(),
      discountAmount: 5000,
      receivedAmount: 50000,
      lines: [{ variantId, rollsSold: 1, meterSold: 300, lineTotal: 45000 }],
    });
    expect(await stock()).toEqual({ rolls: 6, meter: 900 });
    expect(result).toMatchObject({
      subtotal: 45000,
      discountAmount: 5000,
      totalAmount: 40000,
      receivedAmount: 50000,
      paidAmount: 40000,
      dueAmount: 0,
      changeAmount: 10000,
    });
    const payment = await prisma.payment.findFirstOrThrow({
      where: { saleId: result.id },
    });
    expect(Number(payment.amount)).toBe(40000);
  });

  it('calculates partial payment due from the discounted grand total', async () => {
    const result = await sales.create({
      customerId,
      soldAt: new Date().toISOString(),
      discountAmount: 10000,
      receivedAmount: 20000,
      lines: [{ variantId, rollsSold: 1, lineTotal: 80000 }],
    });
    expect(result).toMatchObject({
      subtotal: 80000,
      totalAmount: 70000,
      paidAmount: 20000,
      dueAmount: 50000,
      changeAmount: 0,
    });
    const invoice = await sales.details(result.id);
    expect(invoice).toMatchObject({
      invoiceNumber: result.invoiceNumber,
      subtotal: 80000,
      discountAmount: 10000,
      totalAmount: 70000,
      receivedAmount: 20000,
      paidAmount: 20000,
      dueAmount: 50000,
      changeAmount: 0,
      customer: {
        name: `${tag} Customer`,
        phone: '01700000000',
        address: 'Dhaka',
      },
    });
    expect(invoice.lines[0]).toMatchObject({
      itemCode: `${tag}-ITEM`,
      color: 'Black',
      rollsSold: 1,
      meterSold: null,
      lineTotal: 80000,
    });
    await expect(
      prisma.sale.update({
        where: { id: result.id },
        data: { invoiceNumber: `${result.invoiceNumber}-CHANGED` },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.sale.findUniqueOrThrow({ where: { id: result.id } }),
    ).resolves.toMatchObject({ invoiceNumber: result.invoiceNumber });
  });

  it('cannot exceed available Rolls or entered Meter', async () => {
    const before = await stock();
    await expect(
      sales.create({
        customerId,
        soldAt: new Date().toISOString(),
        discountAmount: 0,
        receivedAmount: 0,
        lines: [{ variantId, rollsSold: before.rolls + 1, lineTotal: 1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      sales.create({
        customerId,
        soldAt: new Date().toISOString(),
        discountAmount: 0,
        receivedAmount: 0,
        lines: [
          {
            variantId,
            rollsSold: 1,
            meterSold: before.meter + 1,
            lineTotal: 1,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await stock()).toEqual(before);
  });

  it('normalizes all remaining Meter to zero when the final Rolls are sold', async () => {
    const before = await stock();
    const finalSale = await sales.create({
      customerId,
      soldAt: new Date().toISOString(),
      discountAmount: 0,
      receivedAmount: 0,
      lines: [{ variantId, rollsSold: before.rolls, lineTotal: 100000 }],
    });
    expect(await stock()).toEqual({ rolls: 0, meter: 0 });
    const movements = await prisma.stockMovement.findMany({
      where: { variantId, reference: finalSale.invoiceNumber },
    });
    expect(movements.reduce((sum, item) => sum + item.rollsChange, 0)).toBe(
      -before.rolls,
    );
    expect(
      movements.reduce((sum, item) => sum + Number(item.meterChange), 0),
    ).toBe(-before.meter);
  });

  it('normalizes each zero-roll batch and restores valid stock on sale void', async () => {
    batchCustomerId = (
      await prisma.customer.create({
        data: { name: `${tag} Batch Customer`, searchText: `${tag} batch` },
      })
    ).id;
    for (const [suffix, purchasedAt] of [
      ['A', '2026-09-04'],
      ['B', '2026-09-05'],
    ] as const) {
      await purchases.receive({
        purchaseNumber: `${tag}-BATCH-P-${suffix}`,
        supplierId,
        containerNumber: `${tag}-BATCH-C-${suffix}`,
        purchasedAt: new Date(purchasedAt).toISOString(),
        items: [
          {
            itemCode: `${tag}-BATCH`,
            color: 'Tan',
            colorCode: '#D2B48C',
            rolls: 2,
            totalMeter: 200,
          },
        ],
      });
    }
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { product: { normalizedItemCode: `${tag}-BATCH` } },
    });
    const created = await sales.create({
      customerId: batchCustomerId,
      soldAt: new Date().toISOString(),
      discountAmount: 0,
      receivedAmount: 0,
      lines: [{ variantId: variant.id, rollsSold: 2, lineTotal: 100 }],
    });
    let batches = await prisma.inventoryBatch.findMany({
      where: { variantId: variant.id },
      orderBy: { receivedAt: 'asc' },
    });
    expect(
      batches.map((batch) => ({
        rolls: batch.availableRolls,
        meter: Number(batch.availableMeter),
      })),
    ).toEqual([
      { rolls: 0, meter: 0 },
      { rolls: 2, meter: 200 },
    ]);

    await sales.void(created.id, 'Batch normalization check');
    batches = await prisma.inventoryBatch.findMany({
      where: { variantId: variant.id },
      orderBy: { receivedAt: 'asc' },
    });
    expect(
      batches.map((batch) => ({
        rolls: batch.availableRolls,
        meter: Number(batch.availableMeter),
      })),
    ).toEqual([
      { rolls: 2, meter: 200 },
      { rolls: 2, meter: 200 },
    ]);

    await inventory.adjustStock(variant.id, -2, 0, 'Batch recount');
    batches = await prisma.inventoryBatch.findMany({
      where: { variantId: variant.id },
      orderBy: { receivedAt: 'asc' },
    });
    expect(
      batches.map((batch) => ({
        rolls: batch.availableRolls,
        meter: Number(batch.availableMeter),
      })),
    ).toEqual([
      { rolls: 0, meter: 0 },
      { rolls: 2, meter: 200 },
    ]);
  });

  it('matches the requested Black and Brown purchase-to-sale scenarios exactly', async () => {
    await purchases.receive({
      purchaseNumber: `${tag}-EXACT-P`,
      supplierId,
      containerNumber: `${tag}-EXACT-C`,
      purchasedAt: new Date('2026-09-03').toISOString(),
      items: [
        {
          itemCode: `${tag}-BLACK`,
          color: 'Black',
          colorCode: '#000000',
          rolls: 5,
        },
        {
          itemCode: `${tag}-BROWN`,
          color: 'Brown',
          colorCode: '#8B5A2B',
          rolls: 4,
          totalMeter: 1200,
        },
      ],
    });
    const variants = await prisma.productVariant.findMany({
      where: {
        product: {
          normalizedItemCode: { in: [`${tag}-BLACK`, `${tag}-BROWN`] },
        },
      },
      include: { product: true },
    });
    const blackId = variants.find(
      (item) => item.product.normalizedItemCode === `${tag}-BLACK`,
    )!.id;
    const brownId = variants.find(
      (item) => item.product.normalizedItemCode === `${tag}-BROWN`,
    )!.id;
    await sales.create({
      customerId,
      soldAt: new Date().toISOString(),
      discountAmount: 0,
      receivedAmount: 80000,
      lines: [{ variantId: blackId, rollsSold: 2, lineTotal: 80000 }],
    });
    let black = await prisma.inventoryBatch.aggregate({
      where: { variantId: blackId },
      _sum: { availableRolls: true, availableMeter: true },
    });
    expect({
      rolls: black._sum.availableRolls,
      meter: Number(black._sum.availableMeter),
    }).toEqual({ rolls: 3, meter: 0 });
    await sales.create({
      customerId,
      soldAt: new Date().toISOString(),
      discountAmount: 0,
      receivedAmount: 100000,
      lines: [{ variantId: blackId, rollsSold: 3, lineTotal: 100000 }],
    });
    black = await prisma.inventoryBatch.aggregate({
      where: { variantId: blackId },
      _sum: { availableRolls: true, availableMeter: true },
    });
    expect({
      rolls: black._sum.availableRolls,
      meter: Number(black._sum.availableMeter),
    }).toEqual({ rolls: 0, meter: 0 });
    await sales.create({
      customerId,
      soldAt: new Date().toISOString(),
      discountAmount: 0,
      receivedAmount: 45000,
      lines: [
        { variantId: brownId, rollsSold: 1, meterSold: 300, lineTotal: 45000 },
      ],
    });
    const brown = await prisma.inventoryBatch.aggregate({
      where: { variantId: brownId },
      _sum: { availableRolls: true, availableMeter: true },
    });
    expect({
      rolls: brown._sum.availableRolls,
      meter: Number(brown._sum.availableMeter),
    }).toEqual({ rolls: 3, meter: 900 });
  });

  it('customer due uses discounted totals and actual applied payments', async () => {
    const customer = await prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
      include: { sales: true },
    });
    const due = customer.sales.reduce(
      (sum, sale) => sum + Number(sale.totalAmount) - Number(sale.paidAmount),
      0,
    );
    expect(due).toBe(230000);
  });

  it('preserves invoice snapshots, records payments, and voids with full stock reversal', async () => {
    await purchases.receive({
      purchaseNumber: `${tag}-HARDEN-P`,
      supplierId,
      containerNumber: `${tag}-HARDEN-C`,
      purchasedAt: new Date().toISOString(),
      items: [
        {
          itemCode: `${tag}-HARDEN`,
          name: 'Snapshot Leather',
          color: 'Green',
          colorCode: '#008000',
          rolls: 3,
          totalMeter: 300,
        },
      ],
    });
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { product: { normalizedItemCode: `${tag}-HARDEN` } },
    });
    hardCustomerId = (
      await prisma.customer.create({
        data: {
          name: `${tag} Hard Customer`,
          email: 'invoice@example.com',
          searchText: `${tag} invoice@example.com`,
        },
      })
    ).id;
    await prisma.storeSettings.update({
      where: { id: 'default' },
      data: { storeName: 'Snapshot Store' },
    });
    const failingMail = {
      sendInvoice: async () => {
        throw new Error('SMTP unavailable');
      },
    } as unknown as MailService;
    const created = await new SalesService(prisma, failingMail).create({
      customerId: hardCustomerId,
      soldAt: new Date().toISOString(),
      discountAmount: 0,
      receivedAmount: 100,
      paymentMethod: 'BANK',
      emailInvoice: true,
      lines: [
        { variantId: variant.id, rollsSold: 2, meterSold: 100, lineTotal: 300 },
      ],
    });
    expect(created.emailStatus).toBe('failed');
    await customers.receivePayment(
      hardCustomerId,
      200,
      'MOBILE_BANKING',
      created.invoiceNumber,
      'Final payment',
    );
    await prisma.customer.update({
      where: { id: hardCustomerId },
      data: { name: 'Changed Customer' },
    });
    await prisma.productVariant.update({
      where: { id: variant.id },
      data: { color: 'Changed Color' },
    });
    await prisma.storeSettings.update({
      where: { id: 'default' },
      data: { storeName: 'Changed Store' },
    });
    const invoice = await sales.details(created.id);
    expect(invoice.customer.name).toBe(`${tag} Hard Customer`);
    expect(invoice.lines[0]).toMatchObject({
      itemName: 'Snapshot Leather',
      color: 'Green',
    });
    expect(invoice.settings.storeName).toBe('Snapshot Store');
    expect(invoice).toMatchObject({ paidAmount: 300, dueAmount: 0 });
    expect(invoice.payments).toHaveLength(2);
    await sales.void(created.id, 'Customer cancelled');
    const batch = await prisma.inventoryBatch.findFirstOrThrow({
      where: { variantId: variant.id },
    });
    expect({
      rolls: batch.availableRolls,
      meter: Number(batch.availableMeter),
    }).toEqual({ rolls: 3, meter: 300 });
    const voided = await sales.details(created.id);
    expect(voided).toMatchObject({
      status: 'VOIDED',
      paidAmount: 0,
      voidReason: 'Customer cancelled',
    });
    expect(voided.payments).toHaveLength(0);
    await expect(sales.void(created.id, 'Again')).rejects.toBeInstanceOf(
      ConflictException,
    );
    await prisma.storeSettings.update({
      where: { id: 'default' },
      data: { storeName: 'Afia Leather' },
    });
  });

  it('records safe stock adjustments and enforces zero-roll meter invariant', async () => {
    const variant = await prisma.productVariant.findFirstOrThrow({
      where: { product: { normalizedItemCode: `${tag}-HARDEN` } },
    });
    await expect(
      inventory.adjustStock(variant.id, -4, 0, 'Invalid recount'),
    ).rejects.toBeInstanceOf(ConflictException);
    await inventory.adjustStock(variant.id, -3, 0, 'Damaged stock');
    const batch = await prisma.inventoryBatch.findFirstOrThrow({
      where: { variantId: variant.id },
    });
    expect({
      rolls: batch.availableRolls,
      meter: Number(batch.availableMeter),
    }).toEqual({ rolls: 0, meter: 0 });
    await expect(
      prisma.stockMovement.findFirstOrThrow({
        where: { variantId: variant.id, type: 'ADJUSTMENT' },
      }),
    ).resolves.toMatchObject({ reason: 'Damaged stock' });
  });

  afterAll(async () => {
    const saleIds = (
      await prisma.sale.findMany({
        where: {
          customerId: {
            in: [customerId, hardCustomerId, batchCustomerId].filter(Boolean),
          },
        },
        select: { id: true },
      })
    ).map((sale) => sale.id);
    const lineIds = (
      await prisma.saleLine.findMany({
        where: { saleId: { in: saleIds } },
        select: { id: true },
      })
    ).map((line) => line.id);
    await prisma.saleRollAllocation.deleteMany({
      where: { saleLineId: { in: lineIds } },
    });
    await prisma.saleBatchAllocation.deleteMany({
      where: { saleLineId: { in: lineIds } },
    });
    await prisma.payment.deleteMany({
      where: {
        customerId: {
          in: [customerId, hardCustomerId, batchCustomerId].filter(Boolean),
        },
      },
    });
    await prisma.invoiceEmailLog.deleteMany({
      where: { saleId: { in: saleIds } },
    });
    await prisma.saleLine.deleteMany({ where: { id: { in: lineIds } } });
    await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
    const products = await prisma.product.findMany({
      where: { normalizedItemCode: { startsWith: tag } },
      include: { variants: { include: { batches: true } } },
    });
    const batchIds = products.flatMap((product) =>
      product.variants.flatMap((variant) =>
        variant.batches.map((batch) => batch.id),
      ),
    );
    await prisma.stockMovement.deleteMany({
      where: { batchId: { in: batchIds } },
    });
    await prisma.purchaseLine.deleteMany({
      where: { batchId: { in: batchIds } },
    });
    await prisma.inventoryBatch.deleteMany({ where: { id: { in: batchIds } } });
    await prisma.purchase.deleteMany({
      where: { purchaseNumber: { startsWith: tag } },
    });
    await prisma.container.deleteMany({
      where: { normalizedContainerNumber: { startsWith: tag } },
    });
    await prisma.productVariant.deleteMany({
      where: { productId: { in: products.map((product) => product.id) } },
    });
    await prisma.product.deleteMany({
      where: { id: { in: products.map((product) => product.id) } },
    });
    await prisma.customer.delete({ where: { id: customerId } });
    if (hardCustomerId)
      await prisma.customer.delete({ where: { id: hardCustomerId } });
    if (batchCustomerId)
      await prisma.customer.delete({ where: { id: batchCustomerId } });
    await prisma.supplier.delete({ where: { id: supplierId } });
    await prisma.$disconnect();
  });
});
