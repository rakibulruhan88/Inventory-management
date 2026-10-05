import { config } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
config({ path: '../../.env', quiet: true });
const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });

async function main() {
  await prisma.storeSettings.upsert({ where: { id: 'default' }, create: { storeName: 'Afia Leather' }, update: {} });
  if (await prisma.purchase.count()) return;
  const royal = await prisma.supplier.create({ data: { name: 'Royal Hides Ltd.', phone: '01711-220033', address: 'Hazaribagh, Dhaka', searchText: 'Royal Hides Ltd. 01711-220033' } });
  const dhaka = await prisma.supplier.create({ data: { name: 'Dhaka Leather Traders', phone: '01819-445566', address: 'Savar, Dhaka', searchText: 'Dhaka Leather Traders 01819-445566' } });
  const rahim = await prisma.customer.create({ data: { name: 'Rahim Traders', phone: '01712-345678', address: 'Islampur, Dhaka', searchText: 'Rahim Traders 01712-345678' } });
  const karim = await prisma.customer.create({ data: { name: 'Karim Leather House', phone: '01812-987654', address: 'Chattogram', searchText: 'Karim Leather House 01812-987654' } });
  await prisma.customer.create({ data: { name: 'Noor Enterprise', phone: '01915-102030', address: 'Narayanganj', searchText: 'Noor Enterprise 01915-102030' } });
  const products = await Promise.all([
    prisma.product.create({ data: { itemCode: 'AL-101', normalizedItemCode: 'AL-101', name: 'Premium Cow Leather', searchText: 'AL-101 Premium Cow Leather' } }),
    prisma.product.create({ data: { itemCode: 'AL-205', normalizedItemCode: 'AL-205', name: 'Soft Goat Leather', searchText: 'AL-205 Soft Goat Leather' } }),
    prisma.product.create({ data: { itemCode: 'AL-310', normalizedItemCode: 'AL-310', name: 'Classic Buffalo Leather', searchText: 'AL-310 Classic Buffalo Leather' } }),
  ]);
  const black = await prisma.productVariant.create({ data: { productId: products[0].id, color: 'Black', colorCode: '#000000', variantKey: 'BLACK|DEFAULT', searchText: 'AL-101 Black' } });
  const brown = await prisma.productVariant.create({ data: { productId: products[0].id, color: 'Brown', colorCode: '#8B5A2B', variantKey: 'BROWN|DEFAULT', searchText: 'AL-101 Brown' } });
  const tan = await prisma.productVariant.create({ data: { productId: products[1].id, color: 'Tan', colorCode: '#D2B48C', variantKey: 'TAN|DEFAULT', searchText: 'AL-205 Tan' } });
  const navy = await prisma.productVariant.create({ data: { productId: products[2].id, color: 'Navy', colorCode: '#000080', variantKey: 'NAVY|DEFAULT', searchText: 'AL-310 Navy' } });
  async function receipt(containerNumber: string, purchaseNumber: string, supplierId: string, receivedAt: Date, entries: Array<{ variantId: string; rolls: number; meter: number }>) {
    const container = await prisma.container.create({ data: { containerNumber, normalizedContainerNumber: containerNumber, supplierId, status: 'RECEIVED', receivedAt, notes: 'Opening inventory', searchText: containerNumber } });
    const purchase = await prisma.purchase.create({ data: { purchaseNumber, supplierId, containerId: container.id, status: 'RECEIVED', purchasedAt: receivedAt, notes: 'Opening inventory' } });
    for (const [i, entry] of entries.entries()) { const batch = await prisma.inventoryBatch.create({ data: { batchCode: `${containerNumber}-${i + 1}`, containerId: container.id, variantId: entry.variantId, receivedAt, originalRolls: entry.rolls, availableRolls: entry.rolls, originalMeter: entry.meter, availableMeter: entry.meter } }); await prisma.purchaseLine.create({ data: { purchaseId: purchase.id, variantId: entry.variantId, batchId: batch.id, rollCount: entry.rolls, totalMeter: entry.meter } }); await prisma.stockMovement.create({ data: { type: 'PURCHASE', variantId: entry.variantId, batchId: batch.id, reference: purchaseNumber, rollsChange: entry.rolls, meterChange: entry.meter } }); }
  }
  await receipt('CN-1001', 'PUR-1001', royal.id, new Date('2026-08-20T06:00:00Z'), [{ variantId: black.id, rolls: 5, meter: 1420 }, { variantId: brown.id, rolls: 3, meter: 870 }]);
  await receipt('CN-1008', 'PUR-1008', dhaka.id, new Date('2026-09-05T06:00:00Z'), [{ variantId: black.id, rolls: 3, meter: 850 }, { variantId: tan.id, rolls: 2, meter: 610 }, { variantId: navy.id, rolls: 2, meter: 560 }]);
  const sale = await prisma.sale.create({ data: { invoiceNumber: 'AF-1001', customerId: rahim.id, status: 'COMPLETED', soldAt: new Date('2026-09-10T06:00:00Z'), totalAmount: 80000, paidAmount: 70000, discountAmount: 5000, receivedAmount: 70000, changeAmount: 0 } });
  const line = await prisma.saleLine.create({ data: { saleId: sale.id, variantId: black.id, mode: 'FULL_ROLL', rollsSold: 2, meterSold: 580, lineTotal: 85000 } });
  const batch = await prisma.inventoryBatch.findFirstOrThrow({ where: { variantId: black.id }, orderBy: { receivedAt: 'asc' } });
  await prisma.inventoryBatch.update({ where: { id: batch.id }, data: { availableRolls: { decrement: 2 }, availableMeter: { decrement: 580 } } });
  await prisma.saleBatchAllocation.create({ data: { saleLineId: line.id, batchId: batch.id, rollsSold: 2, meterSold: 580, rollsBefore: batch.availableRolls, rollsAfter: batch.availableRolls - 2, meterBefore: batch.availableMeter, meterAfter: Number(batch.availableMeter) - 580 } });
  await prisma.stockMovement.create({ data: { type: 'SALE', variantId: black.id, batchId: batch.id, reference: 'AF-1001', rollsChange: -2, meterChange: -580 } });
  await prisma.payment.create({ data: { customerId: rahim.id, saleId: sale.id, amount: 70000 } });
  const secondSale = await prisma.sale.create({ data: { invoiceNumber: 'AF-1002', customerId: karim.id, status: 'COMPLETED', soldAt: new Date('2026-09-12T06:00:00Z'), totalAmount: 42000, paidAmount: 42000, receivedAmount: 42000 } });
  const secondLine = await prisma.saleLine.create({ data: { saleId: secondSale.id, variantId: tan.id, mode: 'FULL_ROLL', rollsSold: 1, meterSold: 0, lineTotal: 42000 } });
  const tanBatch = await prisma.inventoryBatch.findFirstOrThrow({ where: { variantId: tan.id }, orderBy: { receivedAt: 'asc' } });
  await prisma.inventoryBatch.update({ where: { id: tanBatch.id }, data: { availableRolls: { decrement: 1 } } });
  await prisma.saleBatchAllocation.create({ data: { saleLineId: secondLine.id, batchId: tanBatch.id, rollsSold: 1, meterSold: 0, rollsBefore: tanBatch.availableRolls, rollsAfter: tanBatch.availableRolls - 1, meterBefore: tanBatch.availableMeter, meterAfter: tanBatch.availableMeter } });
  await prisma.stockMovement.create({ data: { type: 'SALE', variantId: tan.id, batchId: tanBatch.id, reference: 'AF-1002', rollsChange: -1, meterChange: 0 } });
  await prisma.payment.create({ data: { customerId: karim.id, saleId: secondSale.id, amount: 42000 } });
}
await main(); await prisma.$disconnect();
