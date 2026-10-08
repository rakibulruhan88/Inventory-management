import { appendActivity } from '../activity/activity-write.js';
import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SaleInvoice } from '@afia/contracts';
import nodemailer from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  createInvoicePdf,
  dataUrlImage,
  invoiceFileName,
} from './invoice-pdf.js';

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>'"]/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[
        char
      ]!,
  );
@Injectable()
export class MailService {
  constructor(
    @Inject(ConfigService) private config: ConfigService,
    @Inject(PrismaService) private prisma: PrismaService,
  ) {}
  async sendInvoice(invoice: SaleInvoice, recipientOverride?: string | null, actorId?: string) {
    const recipient = recipientOverride || invoice.customer.email;
    if (!recipient)
      throw new ServiceUnavailableException(
        'This customer does not have an email address.',
      );
    const host = this.config.get<string>('MAIL_HOST');
    const user = this.config.get<string>('MAIL_USER');
    const pass = this.config.get<string>('MAIL_APP_PASSWORD');
    const fromEmail = this.config.get<string>('MAIL_FROM_EMAIL') || user;
    if (!host || !user || !pass || !fromEmail)
      return this.failed(
        invoice.id,
        recipient,
        'Invoice email is not configured yet.',
        actorId,
      );
    try {
      const pdf = await createInvoicePdf(invoice);
      const transport = nodemailer.createTransport({
        host,
        port: this.config.get<number>('MAIL_PORT', 587),
        secure: this.config.get<string>('MAIL_SECURE', 'false') === 'true',
        auth: { user, pass },
      });
      const s = invoice.settings;
      const money = (n: number) =>
        `${s.currencySymbol}${n.toLocaleString('en-BD')}`;
      const embeddedLogo = dataUrlImage(s.logoUrl);
      const logoCid = 'afia-store-logo';
      const logo = embeddedLogo
        ? `<img src="cid:${logoCid}" alt="${escapeHtml(s.storeName)}" style="display:block;max-height:60px;max-width:150px;margin:0 0 18px">`
        : '';
      const html = `<div style="margin:0;background:#F8FAFC;padding:24px;font-family:Arial,sans-serif;color:#334155"><div style="max-width:620px;margin:auto;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:12px;padding:28px">${logo}<h2 style="margin:0 0 4px;color:#0F172A;font-size:22px">${escapeHtml(s.storeName)}</h2><p style="margin:0 0 24px;color:#64748B;font-size:14px">Invoice <strong style="color:#1E40AF">${escapeHtml(invoice.invoiceNumber)}</strong></p><p style="margin:0 0 12px">Hello ${escapeHtml(invoice.customer.name)},</p><p style="margin:0 0 22px;line-height:1.6">Thank you for your purchase. Your professional invoice PDF is attached.</p><table role="presentation" style="width:100%;border-collapse:separate;border-spacing:0;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px"><tr><td style="padding:7px 4px;color:#64748B">Grand Total</td><td style="padding:7px 4px;text-align:right;font-weight:bold;color:#1E40AF">${money(invoice.totalAmount)}</td></tr><tr><td style="padding:7px 4px;color:#64748B">Total Paid</td><td style="padding:7px 4px;text-align:right;color:#334155">${money(invoice.paidAmount)}</td></tr><tr><td style="padding:7px 4px;color:#64748B">Due</td><td style="padding:7px 4px;text-align:right;color:#D97706;font-weight:bold">${money(invoice.dueAmount)}</td></tr></table><p style="margin-top:24px;color:#64748B;font-size:13px">${[
        s.storePhone,
        s.storeEmail,
      ]
        .filter(Boolean)
        .map((x) => escapeHtml(x!))
        .join(' · ')}</p></div></div>`;
      await transport.sendMail({
        from: {
          name: this.config.get('MAIL_FROM_NAME', s.storeName),
          address: fromEmail,
        },
        to: recipient,
        subject: `Invoice ${invoice.invoiceNumber} from ${s.storeName}`,
        html,
        attachments: [
          {
            filename: invoiceFileName(invoice),
            content: pdf,
            contentType: 'application/pdf',
          },
          ...(embeddedLogo
            ? [
                {
                  filename: `store-logo.${embeddedLogo.extension}`,
                  content: embeddedLogo.buffer,
                  contentType: embeddedLogo.contentType,
                  cid: logoCid,
                  contentDisposition: 'inline' as const,
                },
              ]
            : []),
        ],
      });
      await this.prisma.$transaction(async (tx) => {
        await tx.invoiceEmailLog.create({ data: { saleId: invoice.id, recipientEmail: recipient, status: 'SENT' } });
        await appendActivity(tx, { action: 'INVOICE_EMAIL_SENT', entityType: 'Sale', entityId: invoice.id, actorId, metadata: { reference: invoice.invoiceNumber, label: invoice.customer.name, recipient } });
      });
      return { sent: true, recipient, filename: invoiceFileName(invoice) };
    } catch (error) {
      return this.failed(
        invoice.id,
        recipient,
        error instanceof Error ? error.message : 'Email delivery failed.',
        actorId,
      );
    }
  }
  private async failed(
    saleId: string,
    recipient: string,
    reason: string,
    actorId?: string,
  ): Promise<never> {
    await this.prisma.$transaction(async (tx) => {
    await tx.invoiceEmailLog.create({
      data: {
        saleId,
        recipientEmail: recipient,
        status: 'FAILED',
        failureReason: reason.slice(0, 500),
      },
    });
    await appendActivity(tx, { action: 'INVOICE_EMAIL_FAILED', entityType: 'Sale', entityId: saleId, actorId, reason: 'The invoice email could not be sent.', metadata: { recipient } });
    });
    throw new ServiceUnavailableException(
      reason.includes('configured')
        ? reason
        : 'The invoice email could not be sent. Please check the mail settings.',
    );
  }
}
