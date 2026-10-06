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
import {
  missingPartyDetails,
  normalizePartyInput,
  resolvePartyMatch,
} from '../common/party-resolution.js';
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
        rollsSold: line.rollsSold,
        meterSold: Number(line.meterSold) > 0 ? Number(line.meterSold) : null,
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
      payments: sale.payments.map((payment) => ({
        id: payment.id,
        receivedAt: payment.receivedAt.toISOString(),
        amount: Number(payment.amount),
        method: payment.method,
        reference: payment.reference,
        notes: payment.notes,
        invoiceNumber: sale.invoiceNumber,
        saleId: sale.id,
      })),
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
    if (input.lines.some((line) => line.rollsSold < 1))
      throw new BadRequestException(
        'Every sale item must sell at least 1 Roll.',
      );
    if (input.lines.some((line) => (line.meterSold ?? 0) < 0))
      throw new BadRequestException('Meter sold cannot be negative.');
    if (input.lines.some((line) => line.lineTotal <= 0))
      throw new BadRequestException(
        'Every sale item must have a Price / Amount.',
      );
    const subtotal = money(
      input.lines.reduce((sum, line) => sum + line.lineTotal, 0),
    );
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
              const normalized = normalizePartyInput({
                id: input.customer.id ?? input.customerId,
                name: input.customer.name,
                phone: input.customer.phone,
                email: input.customer.email,
                address: input.customer.address,
              });
              if (!normalized.name)
                throw new BadRequestException('Customer name is required.');
              const active = await tx.customer.findMany({
                where: { archivedAt: null },
                select: {
                  id: true,
                  name: true,
                  phone: true,
                  email: true,
                  address: true,
                },
              });
              const match = resolvePartyMatch(normalized, active, 'customer');
              if (match) {
                const missing = missingPartyDetails(match, normalized);
                customer = await tx.customer.update({
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
                customer = await tx.customer.create({
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
              const existing = await tx.customer.findFirst({
                where: { id: input.customerId, archivedAt: null },
              });
              if (!existing) throw new NotFoundException('Customer not found.');
              customer = existing;
            }
            const customerId = customer.id;
            const sale = await tx.sale.create({
              data: {
                invoiceNumber,
                customerId,
                status: 'COMPLETED',
                soldAt: new Date(input.soldAt),
                totalAmount,
                paidAmount,
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

            for (const requested of input.lines) {
              const requestedMeter = requested.meterSold ?? 0;
              const variant = await tx.productVariant.findUnique({
                where: { id: requested.variantId },
                include: { product: true },
              });
              if (!variant)
                throw new NotFoundException('Inventory item not found.');
              const batches = await tx.inventoryBatch.findMany({
                where: {
                  variantId: requested.variantId,
                  availableRolls: { gt: 0 },
                  container: { archivedAt: null },
                  variant: { archivedAt: null, product: { archivedAt: null } },
                },
                orderBy: [{ receivedAt: 'asc' }, { createdAt: 'asc' }],
              });
              const availableRolls = batches.reduce(
                (sum, batch) => sum + batch.availableRolls,
                0,
              );
              const availableMeter = batches.reduce(
                (sum, batch) => sum + Number(batch.availableMeter),
                0,
              );
              if (requested.rollsSold > availableRolls)
                throw new BadRequestException(
                  `Only ${availableRolls} Rolls are available for the selected color.`,
                );
              if (requestedMeter > availableMeter)
                throw new BadRequestException(
                  `Only ${availableMeter.toLocaleString()} Meter is available for the selected color.`,
                );

              const line = await tx.saleLine.create({
                data: {
                  saleId: sale.id,
                  variantId: requested.variantId,
                  mode: 'FULL_ROLL',
                  rollsSold: requested.rollsSold,
                  meterSold: requestedMeter,
                  ratePerMeter: null,
                  discount: 0,
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
                const meterAfter = rollsAfter <= 0 ? 0 : calculatedMeterAfter;
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
                await tx.saleBatchAllocation.create({
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
                rollsLeft -= takeRolls;
                meterLeft = money(meterLeft - takeMeter);
              }

              const remaining = await tx.inventoryBatch.aggregate({
                where: { variantId: requested.variantId },
                _sum: { availableRolls: true },
              });
              if ((remaining._sum.availableRolls ?? 0) === 0) {
                const meterBatches = await tx.inventoryBatch.findMany({
                  where: {
                    variantId: requested.variantId,
                    availableMeter: { gt: 0 },
                  },
                });
                for (const batch of meterBatches) {
                  const meterToClear = Number(batch.availableMeter);
                  await tx.inventoryBatch.update({
                    where: { id: batch.id },
                    data: { availableMeter: 0 },
                  });
                  await tx.stockMovement.create({
                    data: {
                      type: 'SALE',
                      variantId: requested.variantId,
                      batchId: batch.id,
                      reference: invoiceNumber,
                      rollsChange: 0,
                      meterChange: -meterToClear,
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
                  method: input.paymentMethod ?? settings.defaultPaymentMethod,
                },
              });
            await tx.auditLog.create({
              data: {
                action: 'SALE_CREATED',
                entityType: 'Sale',
                entityId: sale.id,
                userId: actorId,
              },
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
            await this.mail.sendInvoice(await this.details(created.id));
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
        if (code === 'P2034' && attempt < 3) continue;
        if (code === 'P2002')
          throw new ConflictException(
            'An invoice number conflict occurred. Please try again.',
          );
        throw error;
      }
    }
    throw new ConflictException('The sale was busy. Please try again.');
  }

  async emailInvoice(id: string) {
    if (!this.mail)
      throw new ConflictException('Invoice email is not available.');
    const invoice = await this.details(id);
    return this.mail.sendInvoice(invoice, invoice.currentCustomerEmail);
  }

  async void(id: string, reason: string, actorId?: string) {
    const cleanReason = normalizeText(reason);
    if (!cleanReason)
      throw new BadRequestException('Cancellation reason is required.');
    return this.prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id },
        include: { payments: true },
      });
      if (!sale) throw new NotFoundException('Sale not found.');
      if (sale.status !== 'COMPLETED')
        throw new ConflictException('This sale has already been voided.');
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
      await tx.auditLog.create({
        data: {
          action: 'SALE_VOIDED',
          entityType: 'Sale',
          entityId: id,
          reason: cleanReason,
          userId: actorId,
        },
      });
      return { id, voided: true };
    });
  }
}
