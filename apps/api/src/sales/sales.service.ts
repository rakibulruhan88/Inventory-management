import { appendActivity } from '../activity/activity-write.js';
import { readDueSources } from '../customers/account-balances.js';
import { isAccountingWriteConflict, lockCustomerAccount } from '../customers/payment-accounting.js';
import { meterSaleLineAmount, saleLineAmount, MAX_SALE_AMOUNT } from '@afia/contracts';
import { Prisma } from '../generated/prisma/client.js';
import { readSalesLedger } from './sales-ledger.js';
import type { SalesLedgerQuery } from '@afia/contracts';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type {
  CreateSaleResponse,
  SaleInvoice,
  SaleSummary,
  StoreSettingsContract,
} from '@afia/contracts';
import { normalizeText } from '../common/normalize.js';
import { resolveSaleCustomer } from '../customers/customer-resolution.js';
import {
  customerIdentitySelect,
  customerPhoneSearch,
  isCustomerPhoneUniqueError,
  phoneConflict,
} from '../customers/customer-identity.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateSaleDto } from './sale.dto.js';
import { allocateInvoiceNumber } from './invoice-number.js';
import { MailService } from '../mail/mail.service.js';
import type { Customer } from '../generated/prisma/client.js';

const money = (value: number) => Number(value.toFixed(2));

@Injectable()
export class SalesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(MailService) private readonly mail?: MailService,
  ) {}

  ledger(query: SalesLedgerQuery) { return readSalesLedger(this.prisma, query); }

  async list(search = ''): Promise<SaleSummary[]> {
    const term = normalizeText(search);
    const sales = await this.prisma.sale.findMany({
      where: term
        ? {
            OR: [
              { invoiceNumber: { contains: term, mode: 'insensitive' } },
              {
                customer: {
                  OR: [
                    { name: { contains: term, mode: 'insensitive' } },
                    { phone: { contains: term } },
                  ],
                },
              },
              {
                lines: {
                  some: {
                    OR: [
                      { itemCodeSnapshot: { contains: term, mode: 'insensitive' } },
                      { colorNameSnapshot: { contains: term, mode: 'insensitive' } },
                      { descriptionSnapshot: { contains: term, mode: 'insensitive' } },
                      { variant: { OR: [
                        { color: { contains: term, mode: 'insensitive' } },
                        { product: { OR: [
                          { itemCode: { contains: term, mode: 'insensitive' } },
                          { description: { contains: term, mode: 'insensitive' } },
                        ] } },
                      ] } },
                    ],
                  },
                },
              },
              {
                payments: {
                  some: { reference: { contains: term, mode: 'insensitive' } },
                },
              },
              { paymentAllocations: { some: { receipt: { OR: [
                { reference: { contains: term, mode: 'insensitive' } },
                { receiptNumber: { contains: term, mode: 'insensitive' } },
              ] } } } },
            ],
          }
        : {},
      include: { customer: true },
      orderBy: { soldAt: 'desc' },
      take: 50,
    });
    return sales.map((sale) => ({
      id: sale.id,
      invoiceNumber: sale.invoiceNumber,
      customerName: sale.customer.name,
      soldAt: sale.soldAt.toISOString(),
      totalAmount: Number(sale.totalAmount),
      paidAmount: Number(sale.paidAmount),
      dueAmount: money(Number(sale.totalAmount) - Number(sale.paidAmount)),
      status: sale.status,
    }));
  }

  async details(id: string): Promise<SaleInvoice> {
    const [sale, settings] = await Promise.all([
      this.prisma.sale.findUnique({
        where: { id },
        include: {
          customer: true,
          lines: {
            include: { variant: { include: { product: true } } },
            orderBy: { createdAt: 'asc' },
          },
          payments: {
            where: { voidedAt: null },
            orderBy: { receivedAt: 'asc' },
          },
          paymentAllocations: { include: { receipt: true }, orderBy: { createdAt: 'asc' } },
          emailLogs: {
            where: { status: 'SENT' },
            orderBy: { sentAt: 'desc' },
            take: 1,
          },
        },
      }),
      this.prisma.storeSettings.upsert({
        where: { id: 'default' },
        create: {},
        update: {},
      }),
    ]);
    if (!sale) throw new NotFoundException('Sale not found.');
    const { invoiceSequence: _invoiceSequence, ...publicSettings } = settings;
    const subtotal = sale.lines.reduce(
      (sum, line) => sum + Number(line.lineTotal),
      0,
    );
    const hasSnapshot = Boolean(sale.customerNameSnapshot);
    return {
      id: sale.id,
      invoiceNumber: sale.invoiceNumber,
      soldAt: sale.soldAt.toISOString(),
      status: sale.status,
      voidedAt: sale.voidedAt?.toISOString() ?? null,
      voidReason: sale.voidReason,
      customerId: sale.customerId,
      currentCustomerEmail: sale.customer.email,
      previousOutstandingBeforeSale: sale.previousOutstandingBeforeSale == null ? null : Number(sale.previousOutstandingBeforeSale),
      outstandingAfterSale: sale.outstandingAfterSale == null ? null : Number(sale.outstandingAfterSale),
      customer: {
        name: sale.customerNameSnapshot || sale.customer.name,
        phone: hasSnapshot ? sale.customerPhoneSnapshot : sale.customer.phone,
        email: hasSnapshot ? sale.customerEmailSnapshot : sale.customer.email,
        address: hasSnapshot
          ? sale.customerAddressSnapshot
          : sale.customer.address,
      },
      lines: sale.lines.map((line) => ({
        id: line.id,
        itemCode: line.itemCodeSnapshot || line.variant.product.itemCode,
        itemName: line.itemNameSnapshot ?? line.variant.product.name,
        color: line.colorNameSnapshot || line.variant.color,
        description: line.descriptionSnapshot ?? null,
        mode: line.mode,
        unitPricePerMeter: line.ratePerMeter == null ? null : Number(line.ratePerMeter),
        rollsSold: line.rollsSold,
        meterSold: Number(line.meterSold) > 0 ? Number(line.meterSold) : null,
        unitPricePerRoll: line.unitPricePerRoll == null ? null : Number(line.unitPricePerRoll),
        lineTotal: Number(line.lineTotal),
      })),
      subtotal: money(subtotal),
      discountAmount: Number(sale.discountAmount),
      totalAmount: Number(sale.totalAmount),
      receivedAmount: Number(sale.receivedAmount),
      paidAmount: Number(sale.paidAmount),
      dueAmount: money(Number(sale.totalAmount) - Number(sale.paidAmount)),
      changeAmount: Number(sale.changeAmount),
      notes: sale.notes,
      payments: [...sale.payments.map((payment) => ({
        id: payment.id,
        receivedAt: payment.receivedAt.toISOString(),
        amount: Number(payment.amount),
        method: payment.method,
        reference: payment.reference,
        notes: payment.notes,
        invoiceNumber: sale.invoiceNumber,
        saleId: sale.id,
      })), ...sale.paymentAllocations.map(a => ({ id: a.id, receiptId: a.receiptId, receiptNumber: a.receipt.receiptNumber, receivedAt: a.receipt.paidAt.toISOString(), amount: Number(a.amount), method: a.receipt.method, reference: a.receipt.reference, notes: a.receipt.notes, saleId: sale.id, invoiceNumber: sale.invoiceNumber }))].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id)),
      lastEmailedAt: sale.emailLogs[0]?.sentAt.toISOString() ?? null,
      settings: {
        ...publicSettings,
        storeName: sale.storeNameSnapshot || settings.storeName,
        storePhone: sale.storePhoneSnapshot ?? settings.storePhone,
        storeEmail: sale.storeEmailSnapshot ?? settings.storeEmail,
        storeAddress: sale.storeAddressSnapshot ?? settings.storeAddress,
        logoUrl: sale.storeLogoSnapshot ?? settings.logoUrl,
        currencySymbol: sale.currencySymbolSnapshot || settings.currencySymbol,
        lowStockMeterThreshold: Number(settings.lowStockMeterThreshold),
        defaultPaymentMethod: settings.defaultPaymentMethod,
      } satisfies StoreSettingsContract,
    };
  }

  async create(
    input: CreateSaleDto,
    actorId?: string,
  ): Promise<CreateSaleResponse> {
    if (!input.customerId && !input.customer)
      throw new BadRequestException('Customer name is required.');
    if (!Array.isArray(input.lines) || input.lines.length === 0)
      throw new BadRequestException('Add at least one sale row.');
    const pricedLines = input.lines.map((line, index) => {
      try {
        const mode = line.mode === undefined ? 'FULL_ROLL' : line.mode;
        if (mode !== 'FULL_ROLL' && mode !== 'BY_METER') throw new Error('Choose Roll or Meter.');
        if (mode === 'BY_METER' && line.rollsSold !== 0) throw new Error('Meter sales must sell zero Rolls.');
        if (mode === 'BY_METER' && line.unitPricePerRoll !== undefined) throw new Error('Use Unit Price / Meter for Meter sales.');
        if (mode === 'FULL_ROLL' && line.unitPricePerMeter !== undefined) throw new Error('Use Unit Price / Roll for Roll sales.');
        const lineTotal = mode === 'BY_METER'
          ? meterSaleLineAmount(line.meterSold ?? 0, line.unitPricePerMeter!)
          : saleLineAmount(line.rollsSold, line.unitPricePerRoll!);
        const meter = line.meterSold ?? 0;
        if (
          !Number.isFinite(meter) ||
          meter < 0 ||
          new Prisma.Decimal(meter).decimalPlaces() > 2 ||
          meter > 9999999999.99
        )
          throw new Error('Enter valid Meter with at most two decimal places.');
        return { ...line, mode, lineTotal };
      } catch (error) {
        throw new BadRequestException(
          `Row ${index + 1}: ${error instanceof Error ? error.message : 'Invalid sale row.'}`,
        );
      }
    });
    const decimalSubtotal = pricedLines.reduce(
      (sum, line) =>
        sum.plus(
          new Prisma.Decimal(line.lineTotal),
        ),
      new Prisma.Decimal(0),
    );
    if (decimalSubtotal.gt(MAX_SALE_AMOUNT))
      throw new BadRequestException(
        'Sale subtotal exceeds the supported limit.',
      );
    const subtotal = decimalSubtotal.toNumber();
    const discountAmount = money(input.discountAmount);
    const totalAmount = money(Math.max(subtotal - discountAmount, 0));
    const receivedAmount = money(input.receivedAmount);
    const paidAmount = money(Math.min(receivedAmount, totalAmount));
    const dueAmount = money(Math.max(totalAmount - receivedAmount, 0));
    const changeAmount = money(Math.max(receivedAmount - totalAmount, 0));
    const settings = await this.prisma.storeSettings.upsert({
      where: { id: 'default' },
      create: {},
      update: {},
    });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const created = await this.prisma.$transaction(
          async (tx) => {
            const invoiceNumber = await allocateInvoiceNumber(tx);
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('afia-customer-resolution'))`;
            let customer: Customer;
            if (input.customer) {
              customer = await resolveSaleCustomer(
                tx,
                input.customer,
                input.customerId,
                actorId,
              );
            } else {
              const existing = await tx.customer.findFirst({
                where: { id: input.customerId, archivedAt: null },
              });
              if (!existing) throw new NotFoundException('Customer not found.');
              customer = existing;
            }
            const customerId = customer.id;
            await lockCustomerAccount(tx, customerId);
            const previousOutstandingBeforeSale = (await readDueSources(tx, customerId)).reduce((sum, s) => sum.plus(s.due), new Prisma.Decimal(0));
            // Validate the whole sale before allocating. Repeated rows keep their identity,
            // while all requests for a variant share one stock pool.
            const meterVariants = new Set(pricedLines.filter((line) => line.mode === 'BY_METER').map((line) => line.variantId));
            const lastAllocationByBatch = new Map<string, string>();
            const stockByVariant = new Map<
              string,
              Awaited<ReturnType<typeof tx.inventoryBatch.findMany>>
            >();
            const lastRowByVariant = new Map<string, number>();
            for (const [index, line] of pricedLines.entries())
              lastRowByVariant.set(line.variantId, index);
            for (const variantId of lastRowByVariant.keys()) {
              const batches = await tx.inventoryBatch.findMany({
                where: {
                  variantId,
                  ...(meterVariants.has(variantId)
                    ? { OR: [{ availableRolls: { gt: 0 } }, { availableMeter: { gt: 0 } }] }
                    : { availableRolls: { gt: 0 } }),
                  container: { archivedAt: null },
                  variant: { archivedAt: null, product: { archivedAt: null } },
                },
                orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
              });
              const requests = pricedLines.filter(
                (line) => line.variantId === variantId,
              );
              const rolls = requests.reduce(
                (sum, line) => sum + line.rollsSold,
                0,
              );
              const meter = requests.reduce(
                (sum, line) => sum.plus(line.meterSold ?? 0),
                new Prisma.Decimal(0),
              );
              const availableRolls = batches.reduce(
                (sum, batch) => sum + batch.availableRolls,
                0,
              );
              const availableMeter = batches.reduce(
                (sum, batch) => sum.plus(batch.availableMeter),
                new Prisma.Decimal(0),
              );
              const variant = await tx.productVariant.findUnique({
                where: { id: variantId },
              });
              if (!variant)
                throw new NotFoundException('Inventory item not found.');
              if (rolls > availableRolls)
                throw new BadRequestException(
                  `Only ${availableRolls} Rolls are available across all ${variant.color} rows.`,
                );
              if (meter.gt(availableMeter))
                throw new BadRequestException(
                  `Only ${availableMeter.toNumber().toLocaleString()} Meter is available across all ${variant.color} rows.`,
                );
              stockByVariant.set(variantId, batches);
            }
            const sale = await tx.sale.create({
              data: {
                invoiceNumber,
                customerId,
                status: 'COMPLETED',
                soldAt: new Date(input.soldAt),
                totalAmount,
                paidAmount,
                previousOutstandingBeforeSale,
                outstandingAfterSale: previousOutstandingBeforeSale.plus(dueAmount),
                discountAmount,
                receivedAmount,
                changeAmount,
                notes: normalizeText(input.notes) || null,
                customerNameSnapshot: customer.name,
                customerPhoneSnapshot: customer.phone,
                customerEmailSnapshot: customer.email,
                customerAddressSnapshot: customer.address,
                storeNameSnapshot: settings.storeName,
                storePhoneSnapshot: settings.storePhone,
                storeEmailSnapshot: settings.storeEmail,
                storeAddressSnapshot: settings.storeAddress,
                storeLogoSnapshot: settings.logoUrl,
                currencySymbolSnapshot: settings.currencySymbol,
              },
            });

            for (const [rowIndex, requested] of pricedLines.entries()) {
              const requestedMeter = requested.meterSold ?? 0;
              const variant = await tx.productVariant.findUnique({
                where: { id: requested.variantId },
                include: { product: true },
              });
              if (!variant)
                throw new NotFoundException('Inventory item not found.');
              const batches = stockByVariant.get(requested.variantId)!;
              const isLastVariantRow =
                lastRowByVariant.get(requested.variantId) === rowIndex;

              const line = await tx.saleLine.create({
                data: {
                  saleId: sale.id,
                  variantId: requested.variantId,
                  mode: requested.mode,
                  rollsSold: requested.rollsSold,
                  meterSold: requestedMeter,
                  ratePerMeter: requested.mode === 'BY_METER' ? requested.unitPricePerMeter : null,
                  discount: 0,
                  unitPricePerRoll: requested.mode === 'FULL_ROLL' ? requested.unitPricePerRoll : null,
                  lineTotal: requested.lineTotal,
                  itemCodeSnapshot: variant.product.itemCode,
                  itemNameSnapshot: variant.product.name,
                  colorNameSnapshot: variant.color,
                  colorCodeSnapshot: variant.color,
                  descriptionSnapshot: variant.product.description,
                },
              });
              let rollsLeft = requested.rollsSold;
              let meterLeft = requestedMeter;
              for (const batch of batches) {
                if (rollsLeft <= 0 && meterLeft <= 0) break;
                const takeRolls = Math.min(rollsLeft, batch.availableRolls);
                const takeMeter = Math.min(
                  meterLeft,
                  Number(batch.availableMeter),
                );
                if (takeRolls <= 0 && takeMeter <= 0) continue;
                const rollsAfter = batch.availableRolls - takeRolls;
                const calculatedMeterAfter = money(
                  Number(batch.availableMeter) - takeMeter,
                );
                // Do not discard Meter needed by a later repeated row.
                const meterAfter =
                  isLastVariantRow && !meterVariants.has(requested.variantId) && rollsAfter <= 0
                    ? 0
                    : calculatedMeterAfter;
                const normalizedMeter = money(
                  calculatedMeterAfter - meterAfter,
                );
                await tx.inventoryBatch.update({
                  where: { id: batch.id },
                  data: {
                    availableRolls: rollsAfter,
                    availableMeter: meterAfter,
                  },
                });
                const allocation = await tx.saleBatchAllocation.create({
                  data: {
                    saleLineId: line.id,
                    batchId: batch.id,
                    rollsSold: takeRolls,
                    meterSold: takeMeter,
                    rollsBefore: batch.availableRolls,
                    rollsAfter,
                    meterBefore: batch.availableMeter,
                    meterAfter,
                  },
                });
                lastAllocationByBatch.set(batch.id, allocation.id);
                await tx.stockMovement.create({
                  data: {
                    type: 'SALE',
                    variantId: requested.variantId,
                    batchId: batch.id,
                    reference: invoiceNumber,
                    rollsChange: -takeRolls,
                    meterChange: -takeMeter,
                  },
                });
                if (normalizedMeter > 0) {
                  await tx.stockMovement.create({
                    data: {
                      type: 'SALE',
                      variantId: requested.variantId,
                      batchId: batch.id,
                      reference: invoiceNumber,
                      rollsChange: 0,
                      meterChange: -normalizedMeter,
                    },
                  });
                }
                batch.availableRolls = rollsAfter;
                batch.availableMeter = new Prisma.Decimal(meterAfter);
                rollsLeft -= takeRolls;
                meterLeft = money(meterLeft - takeMeter);
              }

              if (rollsLeft > 0 || meterLeft > 0)
                throw new BadRequestException(
                  'Stock changed while allocating this sale. Please try again.',
                );
              if (isLastVariantRow && !meterVariants.has(requested.variantId)) {
                // Preserve the zero-Roll Meter rule after all repeated rows have allocated.
                const remaining = await tx.inventoryBatch.aggregate({
                  where: { variantId: requested.variantId },
                  _sum: { availableRolls: true },
                });
                const meterBatches = await tx.inventoryBatch.findMany({
                  where: {
                    variantId: requested.variantId,
                    availableMeter: { gt: 0 },
                    ...((remaining._sum.availableRolls ?? 0) === 0
                      ? {}
                      : {
                          availableRolls: 0,
                          id: { in: batches.map((batch) => batch.id) },
                        }),
                  },
                });
                for (const batch of meterBatches) {
                  await tx.inventoryBatch.update({
                    where: { id: batch.id },
                    data: { availableMeter: 0 },
                  });
                  // Keep the allocation's final stock snapshot consistent with normalization.
                  const lastAllocationId = lastAllocationByBatch.get(batch.id);
                  if (lastAllocationId)
                    await tx.saleBatchAllocation.update({
                      where: { id: lastAllocationId },
                      data: { meterAfter: 0 },
                    });
                  await tx.stockMovement.create({
                    data: {
                      type: 'SALE',
                      variantId: requested.variantId,
                      batchId: batch.id,
                      reference: invoiceNumber,
                      rollsChange: 0,
                      meterChange: -Number(batch.availableMeter),
                    },
                  });
                }
              }
            }

            if (paidAmount > 0)
              await tx.payment.create({
                data: {
                  customerId,
                  saleId: sale.id,
                  amount: paidAmount,
                  cashbookType: 'SALE_PAYMENT',
                  method: input.paymentMethod ?? settings.defaultPaymentMethod,
                },
              });
            await appendActivity(tx, {
                action: 'SALE_CREATED',
                entityType: 'Sale',
                entityId: sale.id,
                actorId: actorId,
                metadata: { reference: invoiceNumber, label: customer.name, customerId, subtotal, totalAmount, discountAmount, receivedAmount,
                  lines: pricedLines.map((line) => ({ variantId: line.variantId, mode: line.mode, rollsSold: line.rollsSold, meterSold: line.meterSold ?? 0, unitPrice: line.mode === 'BY_METER' ? line.unitPricePerMeter! : line.unitPricePerRoll!, lineTotal: line.lineTotal })) },
              });
            return {
              id: sale.id,
              invoiceNumber,
              subtotal,
              discountAmount,
              totalAmount,
              receivedAmount,
              paidAmount,
              dueAmount,
              changeAmount,
              emailRecipient: customer.email,
            };
          },
          { isolationLevel: 'Serializable' },
        );
        if (input.emailInvoice && created.emailRecipient && this.mail) {
          try {
            await this.mail.sendInvoice(await this.details(created.id), undefined, actorId);
            return { ...created, emailStatus: 'sent' };
          } catch {
            return { ...created, emailStatus: 'failed' };
          }
        }
        return { ...created, emailStatus: 'not_requested' };
      } catch (error) {
        const code =
          typeof error === 'object' && error !== null && 'code' in error
            ? error.code
            : null;
        if (isAccountingWriteConflict(error) && attempt < 3) continue;
        if (isAccountingWriteConflict(error)) throw new ConflictException('The account or stock changed while saving this sale. Please try again.');
        if (isCustomerPhoneUniqueError(error) && input.customer?.phone) {
          const normalizedPhone = customerPhoneSearch(input.customer.phone);
          if (normalizedPhone) {
            const owner = await this.prisma.customer.findUnique({
              where: { normalizedPhone },
              select: customerIdentitySelect,
            });
            if (owner) throw phoneConflict(owner);
          }
          throw new ConflictException(
            'This customer phone was used by another request. Select the existing customer and try again.',
          );
        }
        if (code === 'P2002')
          throw new ConflictException(
            'An invoice number conflict occurred. Please try again.',
          );
        throw error;
      }
    }
    throw new ConflictException('The sale was busy. Please try again.');
  }

  async emailInvoice(id: string, actorId?: string) {
    if (!this.mail)
      throw new ConflictException('Invoice email is not available.');
    const invoice = await this.details(id);
    return this.mail.sendInvoice(invoice, invoice.currentCustomerEmail, actorId);
  }

  async void(id: string, reason: string, actorId?: string) {
    const cleanReason = normalizeText(reason);
    if (!cleanReason)
      throw new BadRequestException('Cancellation reason is required.');
    return this.prisma.$transaction(async (tx) => {
      const identity = await tx.sale.findUnique({ where: { id }, select: { customerId: true } });
      if (!identity) throw new NotFoundException('Sale not found.');
      await lockCustomerAccount(tx, identity.customerId);
      await tx.$queryRaw`SELECT id FROM "Sale" WHERE id = ${id} FOR UPDATE`;
      const sale = await tx.sale.findUnique({ where: { id }, include: { payments: true, paymentAllocations: true } });
      if (!sale) throw new NotFoundException('Sale not found.');
      if (sale.status !== 'COMPLETED')
        throw new ConflictException('This sale has already been voided.');
      if (sale.paymentAllocations.length) throw new ConflictException('This sale has payment receipt allocations and cannot be voided. Receipt reversal requires a dedicated accounting workflow.');
      const movements = await tx.stockMovement.findMany({
        where: { reference: sale.invoiceNumber, type: 'SALE' },
      });
      for (const movement of movements) {
        await tx.inventoryBatch.update({
          where: { id: movement.batchId },
          data: {
            availableRolls: { increment: -movement.rollsChange },
            availableMeter: { increment: -Number(movement.meterChange) },
          },
        });
        await tx.stockMovement.create({
          data: {
            type: 'SALE_VOID',
            variantId: movement.variantId,
            batchId: movement.batchId,
            reference: sale.invoiceNumber,
            rollsChange: -movement.rollsChange,
            meterChange: -Number(movement.meterChange),
            reason: cleanReason,
            actorId,
          },
        });
      }
      await tx.payment.updateMany({
        where: { saleId: id, voidedAt: null },
        data: { voidedAt: new Date() },
      });
      await tx.sale.update({
        where: { id },
        data: {
          status: 'VOIDED',
          voidedAt: new Date(),
          voidReason: cleanReason,
          paidAmount: 0,
        },
      });
      await appendActivity(tx, {
          action: 'SALE_VOIDED',
          metadata: { reference: sale.invoiceNumber, label: sale.customerNameSnapshot ?? '', totalAmount: String(sale.totalAmount) },
          entityType: 'Sale',
          entityId: id,
          reason: cleanReason,
          actorId: actorId,
        });
      return { id, voided: true };
    });
  }
}
