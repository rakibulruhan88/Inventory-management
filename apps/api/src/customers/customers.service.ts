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
import { normalizePhone } from '../common/party-resolution.js';
import { PrismaService } from '../prisma/prisma.service.js';
@Injectable()
export class CustomersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async list(search = ''): Promise<CustomerSummary[]> {
    const term = normalizeText(search);
    const phoneTerm = normalizePhone(term);
    const customers = await this.prisma.customer.findMany({
      where: {
        archivedAt: null,
        ...(term
          ? {
              OR: [
                { name: { contains: term, mode: 'insensitive' } },
                { phone: { contains: term } },
                ...(phoneTerm && phoneTerm !== term
                  ? [{ phone: { contains: phoneTerm } }]
                  : []),
                { email: { contains: term, mode: 'insensitive' } },
                { searchText: { contains: term, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        sales: {
          where: { status: 'COMPLETED' },
          select: { totalAmount: true, paidAmount: true },
        },
      },
      orderBy: { name: 'asc' },
      take: 50,
    });
    return customers.map((customer) => {
      const totalSales = customer.sales.reduce(
        (sum, sale) => sum + Number(sale.totalAmount),
        0,
      );
      const totalPaid = customer.sales.reduce(
        (sum, sale) => sum + Number(sale.paidAmount),
        0,
      );
      return {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
        email: customer.email,
        totalSales,
        totalPaid,
        totalDue: Number((totalSales - totalPaid).toFixed(2)),
      };
    });
  }
  async details(id: string): Promise<CustomerDetails> {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        sales: { orderBy: { soldAt: 'desc' } },
        payments: {
          where: { voidedAt: null },
          include: { sale: true },
          orderBy: { receivedAt: 'desc' },
        },
      },
    });
    if (!customer) throw new NotFoundException('Customer not found.');
    const completed = customer.sales.filter(
      (sale) => sale.status === 'COMPLETED',
    );
    const totalSales = completed.reduce(
      (sum, sale) => sum + Number(sale.totalAmount),
      0,
    );
    const totalPaid = completed.reduce(
      (sum, sale) => sum + Number(sale.paidAmount),
      0,
    );
    return {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
      totalSales,
      totalPaid,
      totalDue: money(totalSales - totalPaid),
      payments: customer.payments.map((p) => ({
        id: p.id,
        receivedAt: p.receivedAt.toISOString(),
        amount: Number(p.amount),
        method: p.method,
        reference: p.reference,
        notes: p.notes,
        invoiceNumber: p.sale?.invoiceNumber ?? null,
        saleId: p.saleId,
      })),
      sales: customer.sales.map((sale) => ({
        id: sale.id,
        invoiceNumber: sale.invoiceNumber,
        customerName: customer.name,
        soldAt: sale.soldAt.toISOString(),
        totalAmount: Number(sale.totalAmount),
        paidAmount: Number(sale.paidAmount),
        dueAmount: money(Number(sale.totalAmount) - Number(sale.paidAmount)),
        status: sale.status,
      })),
    };
  }
  async account(id: string, query: LedgerPageDto): Promise<CustomerAccount> {
    // Summary and all histories share one read snapshot, even during a payment.
    return this.prisma.$transaction(
      async (tx) => {
        const customer = await tx.customer.findUnique({ where: { id } });
        if (!customer) throw new NotFoundException('Customer not found.');
        const page = query.page ?? 1,
          pageSize = query.pageSize ?? 25;
        const [totals, sales, outstandingInvoices, paymentTotal, records] =
          await Promise.all([
            tx.sale.aggregate({
              where: { customerId: id, status: 'COMPLETED' },
              _sum: { totalAmount: true, paidAmount: true },
            }),
            readLedgerPage(tx, { customerId: id, page, pageSize }),
            readLedgerPage(tx, { customerId: id, page, pageSize }, true),
            tx.payment.count({ where: { customerId: id, voidedAt: null } }),
            tx.payment.findMany({
              where: { customerId: id, voidedAt: null },
              include: { sale: { select: { id: true, invoiceNumber: true } } },
              orderBy: [{ receivedAt: 'desc' }, { id: 'asc' }],
              take: pageSize,
              skip: (page - 1) * pageSize,
            }),
          ]);
        const totalSales = Number(totals._sum.totalAmount ?? 0);
        const totalPaid = Number(totals._sum.paidAmount ?? 0);
        return {
          id,
          name: customer.name,
          phone: customer.phone,
          email: customer.email,
          address: customer.address,
          totalSales,
          totalPaid,
          totalDue: money(totalSales - totalPaid),
          sales,
          outstandingInvoices,
          payments: {
            total: paymentTotal,
            page,
            pageSize,
            items: records.map((p) => ({
              id: p.id,
              receivedAt: p.receivedAt.toISOString(),
              amount: Number(p.amount),
              method: p.method,
              reference: p.reference,
              notes: p.notes,
              invoiceNumber: p.sale?.invoiceNumber ?? null,
              saleId: p.saleId,
            })),
          },
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
    const name = normalizeText(input.name);
    const phone = normalizePhone(input.phone) || null;
    const email = normalizeText(input.email).toLowerCase() || null;
    const address = normalizeText(input.address) || null;
    const data = {
      name,
      phone,
      email,
      address,
      searchText: [name, phone, email].filter(Boolean).join(' '),
      archivedAt: null,
    };
    if (!id)
      return this.prisma.customer.create({
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
    return { id, name, phone, email, address };
  }
  async receivePayment(
    id: string,
    amount: number,
    method: 'CASH' | 'BANK' | 'MOBILE_BANKING' | 'OTHER' = 'CASH',
    reference?: string,
    notes?: string,
    actorId?: string,
  ) {
    if (amount <= 0)
      throw new ConflictException('Payment must be greater than zero.');
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id, archivedAt: null },
        include: {
          sales: { where: { status: 'COMPLETED' }, orderBy: { soldAt: 'asc' } },
        },
      });
      if (!customer) throw new NotFoundException('Customer not found.');
      const due = customer.sales.reduce(
        (s, sale) => s + Number(sale.totalAmount) - Number(sale.paidAmount),
        0,
      );
      if (amount > due)
        throw new ConflictException(
          `Payment cannot exceed the current due of ৳${due.toLocaleString()}.`,
        );
      let left = amount;
      for (const sale of customer.sales) {
        const saleDue = Number(sale.totalAmount) - Number(sale.paidAmount);
        const applied = Math.min(left, saleDue);
        if (applied > 0) {
          await tx.sale.update({
            where: { id: sale.id },
            data: { paidAmount: { increment: applied } },
          });
          await tx.payment.create({
            data: {
              customerId: id,
              saleId: sale.id,
              amount: applied,
              method,
              reference: normalizeText(reference) || null,
              notes: normalizeText(notes) || null,
            },
          });
          left -= applied;
        }
        if (left <= 0) break;
      }
      await tx.auditLog.create({
        data: {
          action: 'PAYMENT_RECEIVED',
          entityType: 'Customer',
          entityId: id,
          reason: normalizeText(notes) || null,
          userId: actorId,
        },
      });
      return {
        received: amount,
        remainingDue: Number((due - amount).toFixed(2)),
      };
    });
  }
  async archive(id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, archivedAt: null },
      include: { sales: { where: { status: 'COMPLETED' } } },
    });
    if (!customer) throw new NotFoundException('Customer not found.');
    const due = customer.sales.reduce(
      (s, sale) => s + Number(sale.totalAmount) - Number(sale.paidAmount),
      0,
    );
    if (due > 0)
      throw new ConflictException(
        `This customer still has ৳${due.toLocaleString()} due. Clear the balance before archiving.`,
      );
    await this.prisma.customer.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
    return { id, archived: true };
  }
}
const money = (value: number) => Number(value.toFixed(2));
