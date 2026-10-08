import { createOpeningDue } from './opening-due.js';
import type {
  OpeningDueRequest,
  CustomerWithOpeningDueRequest,
} from '@afia/contracts';
import { readAccountTotals, readOpeningDue } from './account-balances.js';
import { lockCustomerAccount } from './payment-accounting.js';
import {
  paymentContext,
  presentReceipt,
  readPaymentHistory,
  receiptDetails,
  receiptInclude,
  receivePayment,
} from './payment-receipts.js';
import type { ReceivePaymentRequest } from '@afia/contracts';
import { readLedgerPage } from '../sales/sales-ledger.js';
import type { CustomerAccount } from '@afia/contracts';
import type { LedgerPageDto } from '../sales/ledger-query.dto.js';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CustomerDetails,
  CustomerInput,
  CustomerSummary,
} from '@afia/contracts';
import { normalizeText } from '../common/normalize.js';
import {
  assertCustomerPhoneAvailable,
  customerIdentityInput,
  customerIdentitySelect,
  customerPhoneSearch,
  isCustomerPhoneUniqueError,
  phoneConflict,
} from './customer-identity.js';
import { PrismaService } from '../prisma/prisma.service.js';
@Injectable()
export class CustomersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async list(search = ''): Promise<CustomerSummary[]> {
    const term = normalizeText(search);
    const phoneTerm = customerPhoneSearch(term);
    const customers = await this.prisma.customer.findMany({
      where: {
        archivedAt: null,
        ...(term
          ? {
              OR: [
                { name: { contains: term, mode: 'insensitive' } },
                { phone: { contains: term } },
                ...(phoneTerm ? [{ normalizedPhone: phoneTerm }] : []),
                { email: { contains: term, mode: 'insensitive' } },
                { searchText: { contains: term, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
      take: 50,
    });
    const totals = await readAccountTotals(
      this.prisma,
      customers.map((c) => c.id),
    );
    return customers.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      address: c.address,
      ...(totals.get(c.id) ?? { totalSales: 0, totalPaid: 0, totalDue: 0 }),
    }));
  }
  async details(id: string): Promise<CustomerDetails> {
    return this.prisma.$transaction(
      async (tx) => {
        const customer = await tx.customer.findUnique({
          where: { id },
          include: {
            sales: { orderBy: { soldAt: 'desc' } },
            paymentReceipts: {
              include: receiptInclude,
              orderBy: [{ paidAt: 'desc' }, { id: 'asc' }],
            },
            payments: {
              where: { voidedAt: null },
              include: { sale: true },
              orderBy: { receivedAt: 'desc' },
            },
          },
        });
        if (!customer) throw new NotFoundException('Customer not found.');
        const totals = (await readAccountTotals(tx, [id])).get(id) ?? {
          totalSales: 0,
          totalPaid: 0,
          totalDue: 0,
        };
        const openingDue = await readOpeningDue(tx, id);
        return {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
          address: customer.address,
          ...totals,
          openingDue,
          payments: [
            ...customer.payments.map((p) => ({
              id: p.id,
              receivedAt: p.receivedAt.toISOString(),
              amount: Number(p.amount),
              method: p.method,
              reference: p.reference,
              notes: p.notes,
              invoiceNumber: p.sale?.invoiceNumber ?? null,
              saleId: p.saleId,
            })),
            ...customer.paymentReceipts.map((record) => {
              const r = presentReceipt(record);
              return {
                id: r.id,
                receiptId: r.id,
                receiptNumber: r.receiptNumber,
                receivedAt: r.paidAt,
                amount: r.totalAmount,
                method: r.method,
                reference: r.reference,
                notes: r.notes,
                saleId: null,
                invoiceNumber: null,
                allocations: r.allocations,
              };
            }),
          ].sort(
            (a, b) =>
              b.receivedAt.localeCompare(a.receivedAt) ||
              a.id.localeCompare(b.id),
          ),
          sales: customer.sales.map((sale) => ({
            id: sale.id,
            invoiceNumber: sale.invoiceNumber,
            customerName: customer.name,
            soldAt: sale.soldAt.toISOString(),
            totalAmount: Number(sale.totalAmount),
            paidAmount: Number(sale.paidAmount),
            dueAmount: money(
              Number(sale.totalAmount) - Number(sale.paidAmount),
            ),
            status: sale.status,
          })),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async account(id: string, query: LedgerPageDto): Promise<CustomerAccount> {
    // Summary and all histories share one read snapshot, even during a payment.
    return this.prisma.$transaction(
      async (tx) => {
        const customer = await tx.customer.findUnique({ where: { id } });
        if (!customer) throw new NotFoundException('Customer not found.');
        const page = query.page ?? 1,
          pageSize = query.pageSize ?? 25;
        const [
          totalsByCustomer,
          sales,
          outstandingInvoices,
          paymentHistory,
          openingDue,
        ] = await Promise.all([
          readAccountTotals(tx, [id]),
          readLedgerPage(tx, { customerId: id, page, pageSize }),
          readLedgerPage(tx, { customerId: id, page, pageSize }, true),
          readPaymentHistory(tx, id, page, pageSize),
          readOpeningDue(tx, id),
        ]);
        const totals = totalsByCustomer.get(id) ?? {
          totalSales: 0,
          totalPaid: 0,
          totalDue: 0,
        };
        return {
          id,
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
          address: customer.address,
          ...totals,
          openingDue,
          sales,
          outstandingInvoices,
          payments: paymentHistory,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async create(input: CustomerInput) {
    return this.write(undefined, input);
  }
  async update(id: string, input: CustomerInput) {
    return this.write(id, input);
  }
  private async write(id: string | undefined, input: CustomerInput) {
    const data = { ...customerIdentityInput(input), archivedAt: null };
    await assertCustomerPhoneAvailable(this.prisma, data.normalizedPhone, id);
    try {
      if (!id)
        return await this.prisma.customer.create({
          data,
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            address: true,
          },
        });
      const result = await this.prisma.customer.updateMany({
        where: { id, archivedAt: null },
        data,
      });
      if (!result.count) throw new NotFoundException('Customer not found.');
      return {
        id,
        name: data.name,
        phone: data.phone,
        email: data.email,
        address: data.address,
      };
    } catch (error) {
      if (isCustomerPhoneUniqueError(error) && data.normalizedPhone) {
        const owner = await this.prisma.customer.findUnique({
          where: { normalizedPhone: data.normalizedPhone },
          select: customerIdentitySelect,
        });
        if (owner) throw phoneConflict(owner);
        throw new ConflictException(
          'This phone was used by another request. Search for the existing customer or try again.',
        );
      }
      throw error;
    }
  }
  createWithOpeningDue(input: CustomerWithOpeningDueRequest, actorId: string) {
    const { openingDue, ...customer } = input;
    return createOpeningDue(
      this.prisma,
      undefined,
      openingDue,
      actorId,
      customer,
    );
  }
  addOpeningDue(id: string, input: OpeningDueRequest, actorId: string) {
    return createOpeningDue(this.prisma, id, input, actorId);
  }
  paymentContext(id: string) {
    return paymentContext(this.prisma, id);
  }
  receipt(id: string, receiptId: string) {
    return receiptDetails(this.prisma, id, receiptId);
  }
  receivePayment(id: string, input: ReceivePaymentRequest, actorId: string) {
    return receivePayment(this.prisma, id, input, actorId);
  }
  async archive(id: string) {
    return this.prisma.$transaction(
      async (tx) => {
        await lockCustomerAccount(tx, id);
        const customer = await tx.customer.findFirst({
          where: { id, archivedAt: null },
          include: { sales: { where: { status: 'COMPLETED' } } },
        });
        if (!customer) throw new NotFoundException('Customer not found.');
        const due = (await readAccountTotals(tx, [id])).get(id)?.totalDue ?? 0;
        if (due > 0)
          throw new ConflictException(
            `This customer still has ৳${due.toLocaleString()} due. Clear the balance before archiving.`,
          );
        await tx.customer.update({
          where: { id },
          data: { archivedAt: new Date() },
        });
        return { id, archived: true };
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }
}
const money = (value: number) => Number(value.toFixed(2));
