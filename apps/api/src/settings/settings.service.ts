import { auditMutation } from '../activity/activity-write.js';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { StoreSettingsContract } from '@afia/contracts';
import { PrismaService } from '../prisma/prisma.service.js';
import type { SettingsDto } from './settings.dto.js';
@Injectable()
export class SettingsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  async get(): Promise<StoreSettingsContract> {
    const x = await this.prisma.storeSettings.upsert({
      where: { id: 'default' },
      create: {},
      update: {},
    });
    const { invoiceSequence: _invoiceSequence, ...settings } = x;
    return {
      ...settings,
      lowStockMeterThreshold: Number(x.lowStockMeterThreshold),
      defaultPaymentMethod: x.defaultPaymentMethod,
    };
  }
  async update(input: SettingsDto, actorId?: string) {
    this.validateBrandImage(input.logoUrl);
    this.validateBrandImage(input.faviconUrl);
    const data = {
      storeName: input.storeName,
      currency: input.currency,
      currencySymbol: input.currencySymbol,
      invoicePrefix: input.invoicePrefix,
      defaultPaymentMethod: input.defaultPaymentMethod,
      lowStockRollThreshold: input.lowStockRollThreshold,
      lowStockMeterThreshold: input.lowStockMeterThreshold,
      brandAccent: input.brandAccent,
      logoUrl: input.logoUrl || null,
      faviconUrl: input.faviconUrl || null,
      storePhone: input.storePhone || null,
      storeEmail: input.storeEmail || null,
      storeAddress: input.storeAddress || null,
    };
    const x = await auditMutation(this.prisma, { action: 'RECORD_UPDATED', entityType: 'StoreSettings', entityId: 'default', actorId }, async (tx) => tx.storeSettings.upsert({
      where: { id: 'default' },
      create: data,
      update: data,
    }));
    const { invoiceSequence: _invoiceSequence, ...settings } = x;
    return {
      ...settings,
      lowStockMeterThreshold: Number(x.lowStockMeterThreshold),
    };
  }
  private validateBrandImage(value?: string | null) {
    if (!value) return;
    if (value.startsWith('data:')) {
      if (
        !/^data:image\/(png|jpeg|x-icon);base64,/i.test(value) ||
        value.length > 210_000
      )
        throw new BadRequestException(
          'Brand images must be PNG, JPG or ICO files under 150 KB.',
        );
      return;
    }
    try {
      const url = new URL(value);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error();
    } catch {
      throw new BadRequestException('Brand image URL is not valid.');
    }
  }
}
