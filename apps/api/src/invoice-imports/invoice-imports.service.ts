import { auditMutation, appendActivity } from '../activity/activity-write.js';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import type {
  InvoiceImportDraftResponse,
  InvoiceImportIssue,
  InvoiceImportReview,
  InvoiceImportUploadResponse,
} from '@afia/contracts';
import { Prisma, type InvoiceImportDraft } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { normalizeCode, normalizeText } from '../common/normalize.js';
import { importConfig, SUPPORTED_MIME_TYPES } from './import-config.js';
import {
  INVOICE_STORAGE,
  isTemporaryInvoiceKey,
  isPermanentInvoiceKey,
  type InvoiceStorage,
} from './invoice-storage.js';
import { validateUpload, type InvoiceUpload } from './upload-validation.js';
import { DocumentExtractor } from './document-extractor.js';
import { DocumentReadError } from './document-types.js';
import {
  INVOICE_PARSER_VERSION,
  parseCommercialInvoice,
} from './commercial-invoice-parser.js';

import {
  blockingIssues,
  buildReviewedData,
  currentSourceIssues,
  reviewInput,
  recalculate,
  validateReviewInput,
} from './invoice-review.js';

const activeStatuses = ['UPLOADED', 'PARSING', 'REVIEW'] as const;
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

@Injectable()
export class InvoiceImportsService {
  private readonly logger = new Logger(InvoiceImportsService.name);
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(INVOICE_STORAGE) private readonly storage: InvoiceStorage,
    @Inject(DocumentExtractor) private readonly extractor: DocumentExtractor,
  ) {}
  limits() {
    return {
      maxFileBytes: importConfig(this.config).maxFileBytes,
      supportedMimeTypes: SUPPORTED_MIME_TYPES,
    };
  }
  async upload(
    file: InvoiceUpload | undefined,
    userId: string,
  ): Promise<InvoiceImportUploadResponse> {
    const settings = importConfig(this.config);
    const validated = validateUpload(file, settings.maxFileBytes);
    const id = randomUUID();
    const key = this.storage.createKey(id, validated.extension);
    let written = false;
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Serialize per-owner uploads (duplicate checks and outstanding-draft quota).
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice-import:${userId}`}))`;
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice-file:${validated.sha256Hash}`}))`;
          // Reserved for the future confirmed-document stage; no endpoint here can confirm.
          const confirmed = await tx.invoiceImportDraft.findFirst({
            where: { sha256Hash: validated.sha256Hash, status: 'CONFIRMED' },
          });
          if (confirmed)
            throw new ConflictException(
              'This document has already been confirmed.',
            );
          const previous = await tx.invoiceImportDraft.findFirst({
            where: {
              uploadedById: userId,
              sha256Hash: validated.sha256Hash,
              status: { in: [...activeStatuses] },
              expiresAt: { gt: new Date() },
            },
            orderBy: { createdAt: 'desc' },
          });
          if (previous)
            return {
              ...this.response(previous),
              duplicateFile: true,
              previousDraftId: previous.id,
            };
          const otherOwnerDuplicate = await tx.invoiceImportDraft.findFirst({
            where: {
              sha256Hash: validated.sha256Hash,
              status: { in: [...activeStatuses] },
              expiresAt: { gt: new Date() },
            },
            select: { id: true },
          });
          const count = await tx.invoiceImportDraft.count({
            where: {
              uploadedById: userId,
              status: { notIn: ['EXPIRED', 'CONFIRMED'] },
              expiresAt: { gt: new Date() },
            },
          });
          if (count >= 20)
            throw new BadRequestException(
              'Too many temporary imports. Clean up expired drafts before uploading more files.',
            );
          await this.storage.put(key, file!.buffer);
          written = true;
          const draft = await tx.invoiceImportDraft.create({
            data: {
              id,
              temporaryStorageKey: key,
              originalFileName: validated.originalFileName,
              mimeType: file!.mimetype,
              fileSize: file!.buffer.length,
              sha256Hash: validated.sha256Hash,
              uploadedById: userId,
              expiresAt: new Date(Date.now() + settings.ttlMs),
            },
          });
          await appendActivity(tx, { action: 'RECORD_CREATED', entityType: 'InvoiceImportDraft', entityId: id, actorId: userId, metadata: { label: draft.originalFileName, status: draft.status } });
          return {
            ...this.response(draft),
            duplicateFile: Boolean(otherOwnerDuplicate),
            previousDraftId: null,
          };
        },
        { timeout: 15_000 },
      );
    } catch (error) {
      if (written) await this.storage.remove(key);
      throw error;
    }
  }
  private async owned(id: string, userId: string) {
    const draft = await this.prisma.invoiceImportDraft.findFirst({
      where: { id, uploadedById: userId },
    });
    if (!draft) throw new NotFoundException('Invoice import not found.');
    return draft;
  }
  async get(id: string, userId: string) {
    return this.response(await this.owned(id, userId));
  }
  async parse(id: string, userId: string): Promise<InvoiceImportDraftResponse> {
    const draft = await this.owned(id, userId);
    if (draft.status === 'EXPIRED' || draft.expiresAt <= new Date())
      throw new GoneException(
        'This temporary import has expired. Upload the file again.',
      );
    if (
      draft.status === 'REVIEW' &&
      (draft.parsedData as InvoiceImportReview | null)?.parserVersion ===
        INVOICE_PARSER_VERSION
    )
      return this.response(draft);
    if (draft.status === 'CONFIRMED')
      throw new ConflictException('This document has already been confirmed.');
    const claimed = await this.prisma.invoiceImportDraft.updateMany({
      where: {
        id,
        uploadedById: userId,
        status: { in: ['UPLOADED', 'FAILED', 'REVIEW'] },
        expiresAt: { gt: new Date() },
      },
      data: { status: 'PARSING', parseErrors: Prisma.DbNull },
    });
    if (!claimed.count)
      throw new ConflictException(
        'This document is already being read. Please wait.',
      );
    try {
      const bytes = await this.storage.read(draft.temporaryStorageKey);
      const document = await this.extractor.extract(bytes, draft.mimeType);
      const review = parseCommercialInvoice(document, id);
      await this.matchExisting(review);
      if (
        review.parsedTotals.rolls > 2_147_483_647 ||
        review.parsedTotals.meter > 9_999_999_999.99
      )
        throw new DocumentReadError(
          'TOTAL_LIMIT',
          'The parsed invoice totals exceed the supported limits.',
        );
      await auditMutation(this.prisma, { action: 'RECORD_UPDATED', entityType: 'InvoiceImportDraft', entityId: id, actorId: userId }, async (tx) => tx.invoiceImportDraft.updateMany({
        where: { id, status: 'PARSING' },
        data: {
          status: 'REVIEW',
          parsingMethod: document.method,
          parsedData: json(review),
          reviewedData: Prisma.DbNull,
          parseWarnings: json(review.warnings),
          parseErrors: Prisma.DbNull,
          detectedSupplierName: review.supplier.detectedName,
          detectedContainerNumber: review.containerNumber,
          detectedInvoiceTotalRolls: review.invoiceTotals.rolls,
          detectedInvoiceTotalMeter: review.invoiceTotals.meter,
          parsedTotalRolls: review.parsedTotals.rolls,
          parsedTotalMeter: review.parsedTotals.meter,
        },
      }));
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        await auditMutation(this.prisma, { action: 'RECORD_UPDATED', entityType: 'InvoiceImportDraft', entityId: id, actorId: userId }, async (tx) => tx.invoiceImportDraft.updateMany({
          where: { id, status: 'PARSING' },
          data: { status: draft.status },
        }));
        throw error;
      }
      const issue: InvoiceImportIssue =
        error instanceof DocumentReadError
          ? { code: error.code, message: error.message }
          : {
              code: 'PARSE_FAILED',
              message:
                'Could not read this invoice. Try a clearer PDF, JPG, or PNG. No inventory was changed.',
            };
      await auditMutation(this.prisma, { action: 'RECORD_UPDATED', entityType: 'InvoiceImportDraft', entityId: id, actorId: userId }, async (tx) => tx.invoiceImportDraft.updateMany({
        where: { id, status: 'PARSING' },
        data: {
          status: 'FAILED',
          parsedData: Prisma.DbNull,
          reviewedData: Prisma.DbNull,
          parseErrors: json([issue]),
        },
      }));
    }
    return this.get(id, userId);
  }
  async updateReview(
    id: string,
    userId: string,
    body: unknown,
    reset = false,
  ): Promise<InvoiceImportDraftResponse> {
    const draft = await this.owned(id, userId);
    if (draft.status === 'EXPIRED' || draft.expiresAt <= new Date())
      throw new GoneException(
        'This temporary import has expired. Upload the file again.',
      );
    const original = draft.parsedData as InvoiceImportReview | null;
    if (
      draft.status !== 'REVIEW' ||
      !original ||
      original.parserVersion !== INVOICE_PARSER_VERSION
    )
      throw new ConflictException(
        'Only a current extracted review can be edited.',
      );
    if (
      reset &&
      body !== undefined &&
      (body === null ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).length)
    )
      throw new BadRequestException('Reset does not accept review fields.');
    const review = reset
      ? structuredClone(original)
      : buildReviewedData(original, validateReviewInput(body));
    // Clear extraction-era matching before every fresh read-only lookup.
    review.supplier.matchedSupplierId = null;
    review.supplier.matchStatus = review.supplier.detectedName
      ? 'NEW'
      : 'NOT_DETECTED';
    for (const item of review.items) {
      item.matchedProductId = null;
      item.existingDescription = null;
      item.matchStatus = 'NEW';
      item.descriptionMissingInExisting = false;
      for (const color of item.colors) {
        color.matchedVariantId = null;
        color.matchStatus = 'NEW';
      }
    }
    review.warnings = reset
      ? original.warnings.filter(
          (w) =>
            ![
              'SUPPLIER_AMBIGUOUS',
              'CONTAINER_EXISTS',
              'DESCRIPTION_CONFLICT',
              'EXISTING_DESCRIPTION_MISSING',
              'ITEM_ARCHIVED',
              'COLOR_ARCHIVED',
              'COLOR_AMBIGUOUS',
            ].includes(w.code),
        )
      : currentSourceIssues(original, review);
    recalculate(review);
    await this.matchExisting(review);
    review.validationPassed = blockingIssues(review, !reset).length === 0;
    // Compare-and-save prevents expiry, cleanup, parsing, or concurrent edits from being overwritten.
    const saved = await auditMutation(this.prisma, { action: 'RECORD_UPDATED', entityType: 'InvoiceImportDraft', entityId: id, actorId: userId }, async (tx) => tx.invoiceImportDraft.updateMany({
      where: {
        id,
        uploadedById: userId,
        status: 'REVIEW',
        expiresAt: { gt: new Date() },
        updatedAt: draft.updatedAt,
      },
      data: { reviewedData: json(review) },
    }));
    if (!saved.count)
      throw new ConflictException(
        'This review changed or expired. Refresh it before saving again.',
      );
    return this.get(id, userId);
  }
  async revalidateForConfirmation(
    review: InvoiceImportReview,
    original: InvoiceImportReview,
    db: Prisma.TransactionClient,
  ) {
    // Do not trust saved totals, source totals, readiness, warnings or match IDs.
    validateReviewInput(reviewInput(review));
    review.invoiceTotals = structuredClone(original.invoiceTotals);
    review.unassignedRows = structuredClone(original.unassignedRows);
    review.supplier.matchedSupplierId = null;
    review.supplier.matchStatus = review.supplier.detectedName
      ? 'NEW'
      : 'NOT_DETECTED';
    for (const item of review.items) {
      item.matchedProductId = null;
      item.existingDescription = null;
      item.matchStatus = 'NEW';
      item.descriptionMissingInExisting = false;
      for (const color of item.colors) {
        color.matchedVariantId = null;
        color.matchStatus = 'NEW';
      }
    }
    review.warnings = currentSourceIssues(original, review);
    recalculate(review);
    await this.matchExisting(review, db);
    const issues = blockingIssues(review, true);
    review.validationPassed = !issues.length;
    return issues;
  }
  private async matchExisting(
    review: InvoiceImportReview,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    // Exact normalized identity only. Fuzzy search must never silently select a master.
    if (review.supplier.detectedName) {
      const suppliers = await db.supplier.findMany({
        where: {
          archivedAt: null,
          name: {
            equals: normalizeText(review.supplier.detectedName),
            mode: 'insensitive',
          },
        },
        select: { id: true },
        take: 2,
      });
      if (suppliers.length === 1) {
        review.supplier.matchedSupplierId = suppliers[0].id;
        review.supplier.matchStatus = 'MATCHED';
      } else if (suppliers.length > 1) {
        review.supplier.matchStatus = 'AMBIGUOUS';
        review.warnings.push({
          code: 'SUPPLIER_AMBIGUOUS',
          message:
            'More than one existing supplier has this name. Review the supplier.',
          field: 'supplier',
        });
      }
    }
    const products = await db.product.findMany({
      where: {
        normalizedItemCode: {
          in: review.items.map((item) => normalizeCode(item.itemCode)),
        },
      },
      select: {
        id: true,
        normalizedItemCode: true,
        description: true,
        archivedAt: true,
        variants: { select: { id: true, color: true, archivedAt: true } },
      },
    });
    for (const item of review.items) {
      const product = products.find(
        (product) =>
          product.normalizedItemCode === normalizeCode(item.itemCode),
      );
      if (!product) continue;
      item.matchedProductId = product.id;
      item.existingDescription = product.description;
      item.matchStatus = 'MATCHED';
      if (product.archivedAt)
        review.warnings.push({
          code: 'ITEM_ARCHIVED',
          message: `${item.itemCode} exists but is archived.`,
          field: 'items',
        });
      if (item.description && !product.description) {
        item.descriptionMissingInExisting = true;
        review.warnings.push({
          code: 'EXISTING_DESCRIPTION_MISSING',
          message: `${item.itemCode} has no existing Description / Size. No database value was updated.`,
          field: 'items.description',
        });
      } else if (
        item.description &&
        normalizeText(item.description) !==
          normalizeText(product.description ?? '')
      ) {
        item.matchStatus = 'DESCRIPTION_CONFLICT';
        review.warnings.push({
          code: 'DESCRIPTION_CONFLICT',
          message: `Description / Size differs from the existing item ${item.itemCode}.`,
          field: 'items.description',
        });
      }
      for (const color of item.colors) {
        const matches = product.variants.filter(
          (variant) =>
            normalizeCode(variant.color) === normalizeCode(color.color),
        );
        color.matchStatus =
          matches.length > 1
            ? 'AMBIGUOUS'
            : matches.length === 1
              ? 'MATCHED'
              : 'NEW';
        color.matchedVariantId = matches.length === 1 ? matches[0].id : null;
        if (matches.length > 1)
          review.warnings.push({
            code: 'COLOR_AMBIGUOUS',
            message: `Multiple existing colors match ${item.itemCode} / ${color.color}.`,
            field: 'items.colors',
          });
        else if (matches[0]?.archivedAt)
          review.warnings.push({
            code: 'COLOR_ARCHIVED',
            message: `${item.itemCode} / ${color.color} is archived.`,
            field: 'items.colors',
          });
      }
    }
    if (
      review.containerNumber &&
      (await db.container.findUnique({
        where: {
          normalizedContainerNumber: normalizeCode(review.containerNumber),
        },
        select: { id: true },
      }))
    )
      review.warnings.push({
        code: 'CONTAINER_EXISTS',
        message: `Container ${review.containerNumber} already exists. It cannot be received again.`,
        field: 'containerNumber',
      });
    review.validationPassed =
      review.warnings.length === 0 &&
      review.totalsMatch.rolls === true &&
      review.totalsMatch.meter === true;
  }
  async cleanupExpired(now = new Date()) {
    const confirmed = await this.prisma.invoiceImportDraft.findMany({
      where: {
        status: 'CONFIRMED',
        expiresAt: { lte: now },
        temporaryStorageKey: { not: '' },
      },
      take: 100,
    });
    for (const draft of confirmed) {
      if (
        !draft.confirmedPurchaseId ||
        !isTemporaryInvoiceKey(draft.temporaryStorageKey)
      )
        continue;
      try {
        const doc = await this.prisma.purchaseDocument.findUnique({
          where: { purchaseId: draft.confirmedPurchaseId },
        });
        if (!doc || !isPermanentInvoiceKey(doc.storageKey)) continue;
        const bytes = await this.storage.read(doc.storageKey);
        if (createHash('sha256').update(bytes).digest('hex') !== doc.sha256Hash)
          continue;
        await this.storage.remove(draft.temporaryStorageKey);
        await this.prisma.invoiceImportDraft.updateMany({
          where: {
            id: draft.id,
            status: 'CONFIRMED',
            temporaryStorageKey: draft.temporaryStorageKey,
          },
          data: { temporaryStorageKey: '' },
        });
      } catch {
        this.logger.warn(
          `Confirmed import ${draft.id} needs source cleanup recovery. Temporary source and history were retained.`,
        );
      }
    }

    // Retry EXPIRED records too, so a failed filesystem deletion is recoverable.
    const drafts = await this.prisma.invoiceImportDraft.findMany({
      where: {
        expiresAt: { lte: now },
        temporaryStorageKey: { not: '' },
        status: { not: 'CONFIRMED' },
        OR: [
          { status: { not: 'PARSING' } },
          { updatedAt: { lt: new Date(now.getTime() - 600_000) } },
        ],
      },
      take: 100,
      orderBy: { expiresAt: 'asc' },
    });
    let removed = 0;
    for (const draft of drafts) {
      if (!isTemporaryInvoiceKey(draft.temporaryStorageKey)) {
        this.logger.warn(
          `Import ${draft.id} has an invalid temporary storage reference. Cleanup skipped it.`,
        );
        continue;
      }
      const claimed = await this.prisma.invoiceImportDraft.updateMany({
        where: {
          id: draft.id,
          status: draft.status,
          updatedAt: draft.updatedAt,
        },
        data: { status: 'EXPIRED' },
      });
      if (!claimed.count) continue;
      await this.storage.remove(draft.temporaryStorageKey);
      // Keep hash / metadata for review history, but remove sensitive parsed contents.
      await this.prisma.invoiceImportDraft.update({
        where: { id: draft.id },
        data: {
          parsedData: Prisma.DbNull,
          reviewedData: Prisma.DbNull,
          parseWarnings: Prisma.DbNull,
          parseErrors: Prisma.DbNull,
          temporaryStorageKey: '',
        },
      });
      removed++;
    }
    return { removed };
  }
  private response(draft: InvoiceImportDraft): InvoiceImportDraftResponse {
    const expired =
      draft.status !== 'CONFIRMED' &&
      (draft.status === 'EXPIRED' || draft.expiresAt <= new Date());
    const requiresReparse =
      !expired &&
      draft.status === 'REVIEW' &&
      (draft.parsedData as InvoiceImportReview | null)?.parserVersion !==
        INVOICE_PARSER_VERSION;
    const original =
      expired ||
      requiresReparse ||
      !['REVIEW', 'CONFIRMED'].includes(draft.status)
        ? null
        : (draft.parsedData as InvoiceImportReview | null);
    const current = original
      ? structuredClone(
          (draft.reviewedData as InvoiceImportReview | null) ?? original,
        )
      : null;
    const hasReviewedChanges = Boolean(
      original &&
      draft.reviewedData &&
      JSON.stringify(reviewInput(current!)) !==
        JSON.stringify(reviewInput(original)),
    );
    const issues = current
      ? blockingIssues(
          current,
          Boolean(draft.reviewedData) && hasReviewedChanges,
        )
      : [];
    if (current) current.validationPassed = issues.length === 0;
    return {
      confirmedPurchaseId: draft.confirmedPurchaseId,
      originalExtractedData: original,
      hasReviewedChanges,
      validationPassed: Boolean(current && !issues.length),
      readyForConfirmation: Boolean(
        draft.status === 'REVIEW' &&
        draft.reviewedData &&
        current &&
        !issues.length,
      ),
      blockingIssues: issues,
      requiresReparse,
      id: draft.id,
      originalFileName: draft.originalFileName,
      mimeType: draft.mimeType,
      fileSize: draft.fileSize,
      status: expired ? 'EXPIRED' : draft.status,
      parsingMethod: draft.parsingMethod,
      review: current,
      warnings: expired
        ? []
        : ((draft.parseWarnings as InvoiceImportIssue[] | null) ?? []),
      errors: expired
        ? []
        : ((draft.parseErrors as InvoiceImportIssue[] | null) ?? []),
      createdAt: draft.createdAt.toISOString(),
      expiresAt: draft.expiresAt.toISOString(),
    };
  }
}
