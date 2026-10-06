import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  INVOICE_STORAGE,
  isPermanentInvoiceKey,
  type InvoiceStorage,
} from './invoice-storage.js';
import { documentSummary } from './purchase-documents.js';
import { validateUpload } from './upload-validation.js';

@Injectable()
export class PurchaseDocumentsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(INVOICE_STORAGE) private readonly storage: InvoiceStorage,
  ) {}
  private async find(id: string) {
    const document = await this.prisma.purchaseDocument.findUnique({
      where: { id },
      include: { purchase: { select: { containerId: true } } },
    });
    if (!document) throw new NotFoundException('Source document not found.');
    return document;
  }
  async get(id: string) {
    const row = await this.find(id);
    return documentSummary(row, row.purchase.containerId);
  }
  async content(id: string) {
    const row = await this.find(id);
    try {
      if (!isPermanentInvoiceKey(row.storageKey))
        throw new Error('Invalid key');
      const bytes = await this.storage.read(row.storageKey);
      const validated = validateUpload(
        {
          buffer: bytes,
          size: bytes.length,
          originalname: `invoice.${row.storageKey.split('.').at(-1)}`,
          mimetype: row.mimeType,
        },
        50 * 1024 * 1024,
      );
      if (
        bytes.length !== row.fileSize ||
        validated.sha256Hash !== row.sha256Hash
      )
        throw new Error('Source integrity mismatch');
      return {
        bytes,
        mimeType: row.mimeType,
        originalFileName: row.originalFileName,
      };
    } catch {
      throw new NotFoundException(
        'Source document is unavailable. Contact the owner to restore the archived original.',
      );
    }
  }
}
