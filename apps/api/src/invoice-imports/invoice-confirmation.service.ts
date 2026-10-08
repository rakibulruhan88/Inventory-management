import { appendActivity } from '../activity/activity-write.js';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  InvoiceImportConfirmationResponse,
  InvoiceImportReview,
} from '@afia/contracts';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PurchasesService } from '../purchases/purchases.service.js';
import { normalizeCode } from '../common/normalize.js';
import {
  normalizePartyInput,
  resolvePartyMatch,
} from '../common/party-resolution.js';
import { InvoiceImportsService } from './invoice-imports.service.js';
import {
  INVOICE_STORAGE,
  isTemporaryInvoiceKey,
  type InvoiceStorage,
} from './invoice-storage.js';
import { INVOICE_PARSER_VERSION } from './commercial-invoice-parser.js';
import { validateUpload } from './upload-validation.js';
import { documentSummary } from './purchase-documents.js';
import { createHash } from 'node:crypto';
import { isPermanentInvoiceKey } from './invoice-storage.js';

@Injectable()
export class InvoiceConfirmationService {
  private readonly logger = new Logger(InvoiceConfirmationService.name);
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PurchasesService) private readonly purchases: PurchasesService,
    @Inject(InvoiceImportsService)
    private readonly imports: InvoiceImportsService,
    @Inject(INVOICE_STORAGE) private readonly storage: InvoiceStorage,
  ) {}

  async confirm(
    id: string,
    userId: string,
    body: unknown,
  ): Promise<InvoiceImportConfirmationResponse> {
    if (
      body !== undefined &&
      (!body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).length)
    )
      throw new BadRequestException(
        'Confirmation accepts no editable fields. Save review changes first.',
      );
    let promoted: string | null = null;
    let temporary: string | null = null;
    let result: InvoiceImportConfirmationResponse;
    try {
      result = await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice-confirm:${id}`}))`;
          // Row lock also serializes review saving and expiry cleanup, not just confirmations.
          await tx.$queryRaw`SELECT id FROM "InvoiceImportDraft" WHERE id = ${id} AND "uploadedById" = ${userId} FOR UPDATE`;
          const draft = await tx.invoiceImportDraft.findFirst({
            where: { id, uploadedById: userId },
          });
          if (!draft) throw new NotFoundException('Invoice import not found.');
          const active = await tx.$queryRaw<
            { id: string }[]
          >`SELECT id FROM "User" WHERE id = ${userId} AND "isActive" = true FOR SHARE`;
          if (!active.length)
            throw new UnauthorizedException(
              'Please sign in with an active account.',
            );
          if (draft.status === 'CONFIRMED' && draft.confirmedPurchaseId) {
            temporary = isTemporaryInvoiceKey(draft.temporaryStorageKey)
              ? draft.temporaryStorageKey
              : null;
            return this.confirmedResult(tx, draft.confirmedPurchaseId, true);
          }
          if (draft.expiresAt <= new Date() || draft.status === 'EXPIRED')
            throw new GoneException(
              'This temporary import has expired. Upload the file again.',
            );
          const original = draft.parsedData as InvoiceImportReview | null;
          if (
            draft.status !== 'REVIEW' ||
            !draft.reviewedData ||
            !original ||
            original.parserVersion !== INVOICE_PARSER_VERSION
          )
            throw new ConflictException(
              'Save a current reviewed invoice before receiving stock.',
            );
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice-file:${draft.sha256Hash}`}))`;
          const duplicate = await tx.invoiceImportDraft.findFirst({
            where: {
              sha256Hash: draft.sha256Hash,
              status: 'CONFIRMED',
              id: { not: id },
            },
            select: { id: true },
          });
          if (
            duplicate ||
            (await tx.purchaseDocument.findUnique({
              where: { sha256Hash: draft.sha256Hash },
              select: { id: true },
            }))
          )
            throw new ConflictException(
              'This source document has already received stock. Check Purchases before proceeding.',
            );
          const review = structuredClone(
            draft.reviewedData as InvoiceImportReview,
          );
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('afia-supplier-resolution'))`;
          for (const code of [
            ...new Set(
              review.items.map((item) => normalizeCode(item.itemCode)),
            ),
          ].sort())
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${code}))`;
          const issues = await this.imports.revalidateForConfirmation(
            review,
            original,
            tx,
          );
          if (issues.length)
            throw new ConflictException({
              message:
                'This invoice needs review before stock can be received. Refresh the review and resolve the blocking issues.',
              blockingIssues: issues,
            });
          let supplierId = review.supplier.matchedSupplierId;
          if (!supplierId) {
            const activeSuppliers = await tx.supplier.findMany({
              where: { archivedAt: null },
              select: {
                id: true,
                name: true,
                phone: true,
                email: true,
                address: true,
              },
            });
            const contactMatch = resolvePartyMatch(
              normalizePartyInput({
                name: review.supplier.detectedName!,
                phone: review.supplier.phone ?? undefined,
                address: review.supplier.address ?? undefined,
              }),
              activeSuppliers,
              'supplier',
            );
            // An unmatched company cannot silently become a different company by phone.
            if (contactMatch)
              throw new ConflictException(
                'Supplier contact details match another existing supplier. Verify the supplier name before receiving.',
              );
          }
          if (!isTemporaryInvoiceKey(draft.temporaryStorageKey))
            throw new ConflictException(
              'The original source is unavailable. Contact the owner before receiving.',
            );
          temporary = draft.temporaryStorageKey;
          const bytes = await this.storage.read(temporary);
          const validated = validateUpload(
            {
              buffer: bytes,
              size: bytes.length,
              originalname: `invoice.${temporary.split('.').at(-1)}`,
              mimetype: draft.mimeType,
            },
            50 * 1024 * 1024,
          );
          if (
            validated.sha256Hash !== draft.sha256Hash ||
            bytes.length !== draft.fileSize
          )
            throw new ConflictException(
              'The original source failed its integrity check. Contact the owner before receiving.',
            );
          const key = this.storage.createPermanentKey(
            Number(review.purchasedAt!.slice(0, 4)),
            review.containerNumber!,
            validated.extension,
          );
          await this.storage.put(key, bytes);
          promoted = key;
          // Verify the durable copy before any business write. Never archive OCR output.
          const archived = await this.storage.read(key);
          if (!archived.equals(bytes))
            throw new ServiceUnavailableException(
              'Source archive verification failed. No stock was received. Retry confirmation.',
            );
          if (draft.expiresAt <= new Date())
            throw new GoneException(
              'This temporary import expired before receipt. Upload the file again.',
            );
          const received = await this.purchases.receiveInTransaction(
            tx,
            {
              purchaseNumber: review.purchaseNumber!,
              purchasedAt: `${review.purchasedAt}T00:00:00.000Z`,
              containerNumber: review.containerNumber!,
              ...(supplierId
                ? { supplierId }
                : {
                    supplier: {
                      name: review.supplier.detectedName!,
                      phone: review.supplier.phone ?? undefined,
                      address: review.supplier.address ?? undefined,
                    },
                  }),
              items: review.items.map((item) => ({
                itemCode: item.itemCode,
                description: item.description ?? undefined,
                colors: item.colors.map((color) => ({
                  color: color.color,
                  rolls: color.rolls!,
                  totalMeter: color.meter ?? undefined,
                })),
              })),
            },
            userId,
          );
          await tx.purchaseDocument.create({
            data: {
              purchaseId: received.id,
              originalFileName: draft.originalFileName,
              storageKey: key,
              mimeType: draft.mimeType,
              fileSize: draft.fileSize,
              sha256Hash: draft.sha256Hash,
              uploadedById: userId,
            },
          });
          await tx.invoiceImportDraft.update({
            where: { id },
            data: {
              status: 'CONFIRMED',
              confirmedAt: new Date(),
              confirmedPurchaseId: received.id,
              reviewedData: JSON.parse(
                JSON.stringify(review),
              ) as Prisma.InputJsonValue,
            },
          });
          await appendActivity(tx, { action: 'RECORD_UPDATED', entityType: 'InvoiceImportDraft', entityId: id, actorId: userId, metadata: { label: draft.originalFileName, reference: received.purchaseNumber, status: 'CONFIRMED', confirmedPurchaseId: received.id } });
          return this.confirmedResult(tx, received.id, false);
        },
        { timeout: 60_000, maxWait: 10_000 },
      );
    } catch (error) {
      if (promoted) {
        // A lost DB connection can make commit outcome uncertain. Never delete a
        // file which a committed document references; retain it if DB is unavailable.
        try {
          const promotedKey = promoted;
          const committed = await this.prisma.$transaction(
            async (tx) => {
              // Wait for the original transaction to commit/abort before inspecting
              // its outcome. A disconnected COMMIT can still be settling in Postgres.
              await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice-confirm:${id}`}))`;
              return tx.purchaseDocument.findUnique({
                where: { storageKey: promotedKey },
                select: { purchaseId: true },
              });
            },
            { timeout: 60_000, maxWait: 10_000 },
          );
          if (committed)
            return await this.confirmedResult(
              this.prisma,
              committed.purchaseId,
              true,
            );
          await this.storage.remove(promoted);
        } catch {
          this.logger.warn(
            `Archive compensation needs recovery for import ${id}. The copy was retained.`,
          );
        }
      }
      if (error instanceof HttpException) throw error;
      const code =
        typeof error === 'object' && error && 'code' in error
          ? error.code
          : undefined;
      if (code === 'P2002')
        throw new ConflictException(
          'This container, purchase reference or source document has already been received. Refresh Purchases and review the reference.',
        );
      throw new ServiceUnavailableException(
        'Confirmation could not finish. Your review is preserved. Refresh the result and retry; stock will not be received twice.',
      );
    }
    if (temporary) {
      try {
        // A retry must retain the recovery source if an archive was lost after commit.
        const document = await this.prisma.purchaseDocument.findUniqueOrThrow({
          where: { purchaseId: result.purchase.id },
        });
        if (!isPermanentInvoiceKey(document.storageKey))
          throw new Error('Invalid permanent source reference');
        const archived = await this.storage.read(document.storageKey);
        if (
          archived.length !== document.fileSize ||
          createHash('sha256').update(archived).digest('hex') !==
            document.sha256Hash
        )
          throw new Error('Permanent source integrity mismatch');
        await this.storage.remove(temporary);
        await this.prisma.invoiceImportDraft.updateMany({
          where: {
            id,
            uploadedById: userId,
            status: 'CONFIRMED',
            temporaryStorageKey: temporary,
          },
          data: { temporaryStorageKey: '' },
        });
      } catch {
        this.logger.warn(
          `Temporary source cleanup needs retry for confirmed import ${id}. The archive and receipt are retained.`,
        );
      }
    }
    return result;
  }
  private async confirmedResult(
    db: Prisma.TransactionClient | PrismaService,
    purchaseId: string,
    alreadyConfirmed: boolean,
  ): Promise<InvoiceImportConfirmationResponse> {
    const purchase = await db.purchase.findUnique({
      where: { id: purchaseId },
      include: {
        container: true,
        documents: true,
        lines: { include: { variant: { select: { productId: true } } } },
        invoiceImport: true,
      },
    });
    if (!purchase?.documents[0])
      throw new ConflictException(
        'The confirmed source linkage needs owner review. Do not receive this file again.',
      );
    const review = purchase.invoiceImport
      ?.reviewedData as InvoiceImportReview | null;
    return {
      purchase: {
        id: purchase.id,
        purchaseNumber: purchase.purchaseNumber,
        containerNumber: purchase.container.containerNumber,
        totalRolls: purchase.lines.reduce(
          (sum, line) => sum + line.rollCount,
          0,
        ),
        totalMeter: Number(
          purchase.lines
            .reduce((sum, line) => sum + Number(line.totalMeter), 0)
            .toFixed(2),
        ),
        reusedItemCodes:
          review?.items
            .filter((item) => item.matchedProductId)
            .map((item) => normalizeCode(item.itemCode)) ?? [],
      },
      containerId: purchase.containerId,
      document: documentSummary(purchase.documents[0], purchase.containerId),
      itemCount: new Set(purchase.lines.map((line) => line.variant.productId))
        .size,
      colorCount: purchase.lines.length,
      alreadyConfirmed,
      purchaseStatus: purchase.status,
    };
  }
}
