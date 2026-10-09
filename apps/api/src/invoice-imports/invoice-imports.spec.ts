import 'reflect-metadata';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { Prisma, type InvoiceImportDraft } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { InvoiceImportsModule } from './invoice-imports.module.js';
import { InvoiceImportsService } from './invoice-imports.service.js';
import { DocumentExtractor } from './document-extractor.js';
import { LocalInvoiceStorage } from './invoice-storage.js';
import { validateUpload, type InvoiceUpload } from './upload-validation.js';
import { supplierLayoutLines } from './fixtures/supplier-layout-invoice.js';
import { reviewInput } from './invoice-review.js';
import type { InvoiceImportReviewInput } from '@afia/contracts';
import { DocumentReadError } from './document-types.js';
import {
  documentFixture,
  imageFixture,
  pdfFixture,
  invoiceLines,
} from './fixtures/sanitized-invoice.js';

function memoryPrisma() {
  const rows: InvoiceImportDraft[] = [];
  const matches = (
    row: InvoiceImportDraft,
    where: Record<string, unknown> = {},
  ): boolean =>
    Object.entries(where).every(([key, expected]) => {
      if (key === 'OR')
        return (expected as Record<string, unknown>[]).some((clause) =>
          matches(row, clause),
        );
      const value = row[key as keyof InvoiceImportDraft];
      if (
        expected &&
        typeof expected === 'object' &&
        !(expected instanceof Date)
      ) {
        const filter = expected as {
          in?: unknown[];
          notIn?: unknown[];
          not?: unknown;
          gt?: Date;
          lte?: Date;
          lt?: Date;
        };
        return (
          (!filter.in || filter.in.includes(value)) &&
          (!filter.notIn || !filter.notIn.includes(value)) &&
          (filter.not === undefined || value !== filter.not) &&
          (!filter.gt || (value as Date) > filter.gt) &&
          (!filter.lte || (value as Date) <= filter.lte) &&
          (!filter.lt || (value as Date) < filter.lt)
        );
      }
      return value instanceof Date && expected instanceof Date
        ? value.getTime() === expected.getTime()
        : value === expected;
    });
  const emptyDraft = (): InvoiceImportDraft => ({
    id: randomUUID(),
    originalFileName: 'invoice.pdf',
    mimeType: 'application/pdf',
    fileSize: 30,
    sha256Hash: '',
    temporaryStorageKey: '',
    status: 'UPLOADED',
    parsingMethod: null,
    parsedData: null,
    reviewedData: null,
    confirmedPurchaseId: null,
    confirmedAt: null,
    parseWarnings: null,
    parseErrors: null,
    detectedSupplierName: null,
    detectedContainerNumber: null,
    detectedInvoiceTotalRolls: null,
    detectedInvoiceTotalMeter: null,
    parsedTotalRolls: null,
    parsedTotalMeter: null,
    uploadedById: 'owner',
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: new Date(Date.now() + 86400000),
  });
  const normalizedData = (data: Partial<InvoiceImportDraft>) =>
    Object.fromEntries(
      Object.entries(data).map(([key, value]) => [
        key,
        (value as unknown) === Prisma.DbNull ? null : value,
      ]),
    );
  const invoiceImportDraft = {
    findFirst: vi.fn(
      async ({ where }: { where?: Record<string, unknown> } = {}) =>
        rows.find((row) => matches(row, where)) ?? null,
    ),
    findMany: vi.fn(
      async ({ where }: { where?: Record<string, unknown> } = {}) =>
        rows.filter((row) => matches(row, where)),
    ),
    count: vi.fn(
      async ({ where }: { where?: Record<string, unknown> } = {}) =>
        rows.filter((row) => matches(row, where)).length,
    ),
    create: vi.fn(async ({ data }: { data: Partial<InvoiceImportDraft> }) => {
      const row = { ...emptyDraft(), ...data };
      rows.push(row);
      return row;
    }),
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Partial<InvoiceImportDraft>;
      }) => {
        const matching = rows.filter((row) => matches(row, where));
        matching.forEach((row) =>
          Object.assign(row, normalizedData(data), { updatedAt: new Date() }),
        );
        return { count: matching.length };
      },
    ),
    update: vi.fn(
      async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Partial<InvoiceImportDraft>;
      }) => {
        const row = rows.find((row) => matches(row, where))!;
        Object.assign(row, normalizedData(data));
        return row;
      },
    ),
  };
  const forbiddenWrite = vi.fn(() => {
    throw new Error('Inventory/business write is forbidden during import!');
  });
  const writes = {
    create: forbiddenWrite,
    update: forbiddenWrite,
    upsert: forbiddenWrite,
    delete: forbiddenWrite,
    createMany: forbiddenWrite,
    updateMany: forbiddenWrite,
    deleteMany: forbiddenWrite,
  };
  const prisma = {
    invoiceImportDraft,
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(async (query: { values: unknown[] }) => rows.filter((row) => row.id === query.values[0])),
    auditLog: { create: vi.fn(async () => ({ id: 'audit' })) },
    product: { ...writes, findMany: vi.fn(async () => [] as unknown[]) },
    supplier: {
      ...writes,
      findMany: vi.fn(async () => [] as { id: string }[]),
    },
    container: {
      ...writes,
      findUnique: vi.fn(async () => null as { id: string } | null),
    },
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ id: where.id, name: 'Owner', role: 'OWNER', username: null, email: null, isActive: true, deletedAt: null, sessionVersion: 0, permissions: [] })),
      findFirst: vi.fn(async () => ({ id: 'owner' }) as { id: string } | null),
    },
    purchase: writes,
    productVariant: writes,
    inventoryBatch: writes,
    roll: writes,
    stockMovement: writes,
    sale: writes,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(prisma),
    ),
  };
  return { prisma, rows, forbiddenWrite };
}

describe('safe upload storage and review-only import service', () => {
  let root: string;
  let config: ConfigService;
  let storage: LocalInvoiceStorage;
  let database: ReturnType<typeof memoryPrisma>;
  let service: InvoiceImportsService;
  let extract: ReturnType<typeof vi.fn>;
  let pdf: Buffer;
  const uploadFile = (
    buffer = pdf,
    mimetype = 'application/pdf',
    originalname = '../../invoice.pdf',
  ): InvoiceUpload => ({ buffer, size: buffer.length, mimetype, originalname });
  beforeAll(async () => {
    pdf = await pdfFixture([invoiceLines]);
  });
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'afia-invoice-test-'));
    config = new ConfigService({ INVOICE_IMPORT_STORAGE_ROOT: root });
    storage = new LocalInvoiceStorage(config);
    database = memoryPrisma();
    extract = vi.fn().mockResolvedValue(documentFixture());
    service = new InvoiceImportsService(
      database.prisma as unknown as PrismaService,
      config,
      storage,
      { extract } as unknown as DocumentExtractor,
    );
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  it.each([
    ['application/pdf', 'safe.pdf'],
    ['image/jpeg', 'safe.jpg'],
    ['image/png', 'safe.png'],
  ])(
    'accepts %s with real signatures and safe relative storage keys',
    async (mime, name) => {
      const buffer =
        mime === 'application/pdf'
          ? pdf
          : imageFixture(['test'], mime === 'image/png' ? 'png' : 'jpg');
      const uploaded = await service.upload(
        uploadFile(buffer, mime, name),
        'owner',
      );
      const row = database.rows[0];
      expect(row.temporaryStorageKey).toMatch(
        /^tmp\/invoice-imports\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(pdf|jpg|png)$/,
      );
      expect(row.sha256Hash).toMatch(/^[a-f0-9]{64}$/);
      expect(await storage.read(row.temporaryStorageKey)).toEqual(buffer);
      expect(uploaded).not.toHaveProperty('temporaryStorageKey');
      expect(JSON.stringify(uploaded)).not.toContain(root);
      expect(database.forbiddenWrite).not.toHaveBeenCalled();
    },
  );
  it('rejects unsupported, spoofed, empty, and oversized uploads before storing a draft', async () => {
    expect(() =>
      validateUpload(
        uploadFile(Buffer.from('<html>bad</html>'), 'text/html', 'bad.html'),
        1000,
      ),
    ).toThrow('Unsupported');
    expect(() =>
      validateUpload(
        uploadFile(Buffer.from('random'), 'application/pdf', 'bad.pdf'),
        1000,
      ),
    ).toThrow('Unsupported');
    expect(() =>
      validateUpload(uploadFile(pdf, 'image/png', 'file.png'), 100000),
    ).toThrow('Unsupported');
    expect(() => validateUpload(uploadFile(pdf), 10)).toThrow('size limit');
    expect(() => validateUpload(undefined, 1000)).toThrow('Choose');
    await expect(
      service.upload(uploadFile(Buffer.from('bad')), 'owner'),
    ).rejects.toThrow('Unsupported');
    expect(database.prisma.invoiceImportDraft.create).not.toHaveBeenCalled();
  });
  it('hashes uploaded bytes regardless of filename and returns the original active draft', async () => {
    const first = await service.upload(uploadFile(), 'owner');
    const second = await service.upload(
      uploadFile(pdf, 'application/pdf', 'renamed.pdf'),
      'owner',
    );
    expect(second).toMatchObject({
      id: first.id,
      duplicateFile: true,
      previousDraftId: first.id,
    });
    expect(database.prisma.invoiceImportDraft.create).toHaveBeenCalledTimes(1);
  });
  it('does not reveal another owner’s draft or reuse failed/expired documents permanently', async () => {
    const first = await service.upload(uploadFile(), 'owner');
    const other = await service.upload(uploadFile(), 'another-user');
    expect(other.duplicateFile).toBe(true);
    expect(other.previousDraftId).toBeNull();
    await expect(service.get(first.id, 'another-user')).rejects.toThrow(
      'not found',
    );
    await expect(service.parse(first.id, 'another-user')).rejects.toThrow(
      'not found',
    );
    database.rows[0].status = 'FAILED';
    const replacement = await service.upload(uploadFile(), 'owner');
    expect(replacement.id).not.toBe(first.id);
    expect(replacement.previousDraftId).toBeNull();
  });
  it('supports blocking a future confirmed document without a confirmation endpoint', async () => {
    await service.upload(uploadFile(), 'owner');
    database.rows[0].status = 'CONFIRMED';
    await expect(service.upload(uploadFile(), 'owner')).rejects.toThrow(
      'already been confirmed',
    );
  });
  it('upload and parsing cannot call any purchase, container, product, variant, stock, or sale mutation', async () => {
    const first = await service.upload(uploadFile(), 'owner');
    const parsed = await service.parse(first.id, 'owner');
    expect(parsed.status).toBe('REVIEW');
    expect(parsed.review?.parsedTotals.rolls).toBe(154);
    expect(database.forbiddenWrite).not.toHaveBeenCalled();
    expect(database.prisma.invoiceImportDraft.create).toHaveBeenCalledTimes(1);
    expect(database.prisma.invoiceImportDraft.updateMany).toHaveBeenCalledTimes(
      2,
    );
  });
  it('hides outdated review data and reparses its private upload without business writes', async () => {
    const uploaded = await service.upload(uploadFile(), 'owner');
    await service.parse(uploaded.id, 'owner');
    const old = database.rows[0].parsedData as Record<string, unknown>;
    delete old.parserVersion;
    const outdated = await service.get(uploaded.id, 'owner');
    expect(outdated.requiresReparse).toBe(true);
    expect(outdated.review).toBeNull();
    extract.mockImplementationOnce(async () => {
      const reading = await service.get(uploaded.id, 'owner');
      expect(reading.status).toBe('PARSING');
      expect(reading.review).toBeNull();
      return documentFixture();
    });
    const reparsed = await service.parse(uploaded.id, 'owner');
    expect(extract).toHaveBeenCalledTimes(2);
    expect(reparsed.requiresReparse).toBe(false);
    expect(reparsed.review?.parserVersion).toBe(3);
    await service.parse(uploaded.id, 'owner');
    expect(extract).toHaveBeenCalledTimes(2);
    expect(database.forbiddenWrite).not.toHaveBeenCalled();
  });
  it('returns OCR uncertainty as REVIEW without touching business records', async () => {
    const document = documentFixture();
    document.method = 'OCR';
    document.lines.forEach((line) => (line.method = 'OCR'));
    document.lines[4].text = document.lines[4].text.replace(
      'Rolls quantity',
      'Rolisquantity',
    );
    document.lines[5].text = document.lines[5].text.replace('1502', '121B');
    extract.mockResolvedValue(document);
    const image = imageFixture(invoiceLines);
    const review = await service.parse(
      (
        await service.upload(
          uploadFile(image, 'image/png', 'invoice.png'),
          'owner',
        )
      ).id,
      'owner',
    );
    expect(review.status).toBe('REVIEW');
    expect(review.review?.items[0].colors[0].meter).toBeNull();
    expect(
      review.review?.warnings.some((w) => w.code === 'METER_INVALID'),
    ).toBe(true);
    expect(database.forbiddenWrite).not.toHaveBeenCalled();
  });
  it('matches only the clean company name, without selecting by contact details', async () => {
    const lines = [...invoiceLines];
    lines[2] +=
      ' ADD: TEST ROAD Tel: +880-000-101 Fax: +880-000-102 Contact person: Test Operator';
    extract.mockResolvedValue(documentFixture(lines));
    const result = await service.parse(
      (await service.upload(uploadFile(), 'owner')).id,
      'owner',
    );
    expect(database.prisma.supplier.findMany).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        name: { equals: 'SANITIZED LEATHER CO., LTD', mode: 'insensitive' },
      },
      select: { id: true },
      take: 2,
    });
    expect(result.review?.supplier).toMatchObject({
      detectedName: 'SANITIZED LEATHER CO., LTD',
      phone: '+880-000-101',
      contactPerson: 'Test Operator',
      matchedSupplierId: null,
      matchStatus: 'NEW',
    });
    expect(database.forbiddenWrite).not.toHaveBeenCalled();
  });
  it('matches supplier, item and textual color with read-only queries', async () => {
    database.prisma.supplier.findMany.mockResolvedValue([
      { id: 'supplier-id' },
    ]);
    database.prisma.product.findMany.mockResolvedValue([
      {
        id: 'product-id',
        normalizedItemCode: 'T902',
        description: '1.2mm*54"*36.5m',
        archivedAt: null,
        variants: [
          { id: 'variant-id', color: '02#Pine green', archivedAt: null },
        ],
      },
    ]);
    const result = await service.parse(
      (await service.upload(uploadFile(), 'owner')).id,
      'owner',
    );
    expect(result.review?.supplier).toMatchObject({
      matchStatus: 'MATCHED',
      matchedSupplierId: 'supplier-id',
    });
    expect(result.review?.items[0]).toMatchObject({
      matchStatus: 'MATCHED',
      matchedProductId: 'product-id',
    });
    expect(result.review?.items[0].colors[1]).toMatchObject({
      matchStatus: 'MATCHED',
      matchedVariantId: 'variant-id',
    });
    expect(database.forbiddenWrite).not.toHaveBeenCalled();
  });
  it.each([
    ['other size', 'DESCRIPTION_CONFLICT'],
    [null, 'EXISTING_DESCRIPTION_MISSING'],
  ])(
    'reports existing description %s without updating the item',
    async (description, code) => {
      database.prisma.product.findMany.mockResolvedValue([
        {
          id: 'product-id',
          normalizedItemCode: 'T902',
          description,
          archivedAt: null,
          variants: [],
        },
      ]);
      const result = await service.parse(
        (await service.upload(uploadFile(), 'owner')).id,
        'owner',
      );
      expect(result.review?.warnings.some((w) => w.code === code)).toBe(true);
      expect(result.review?.validationPassed).toBe(false);
      expect(database.forbiddenWrite).not.toHaveBeenCalled();
    },
  );
  it('reports ambiguous existing supplier/color and existing container', async () => {
    database.prisma.supplier.findMany.mockResolvedValue([
      { id: 'a' },
      { id: 'b' },
    ]);
    database.prisma.product.findMany.mockResolvedValue([
      {
        id: 'p',
        normalizedItemCode: 'T902',
        description: null,
        archivedAt: null,
        variants: [
          { id: 'a', color: '1#Black' },
          { id: 'b', color: '1#black' },
        ],
      },
    ]);
    database.prisma.container.findUnique.mockResolvedValue({
      id: 'existing-container',
    });
    const result = await service.parse(
      (await service.upload(uploadFile(), 'owner')).id,
      'owner',
    );
    expect(result.review?.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining([
        'SUPPLIER_AMBIGUOUS',
        'COLOR_AMBIGUOUS',
        'CONTAINER_EXISTS',
      ]),
    );
    expect(result.review?.items[0].colors[0].matchedVariantId).toBeNull();
  });
  async function editableDraft() {
    const parsed = await service.parse(
      (await service.upload(uploadFile(), 'owner')).id,
      'owner',
    );
    return {
      id: parsed.id,
      original: structuredClone(parsed.originalExtractedData!),
      input: {
        ...reviewInput(parsed.review!),
        purchasedAt: '2026-09-30',
        purchaseNumber: 'PUR-TEST',
      },
    };
  }
  it.each([
    [
      'supplier name',
      (v: InvoiceImportReviewInput) => {
        v.supplier.name = 'Edited Supplier';
      },
    ],
    [
      'phone',
      (v: InvoiceImportReviewInput) => {
        v.supplier.phone = '+880 123';
      },
    ],
    [
      'fax',
      (v: InvoiceImportReviewInput) => {
        v.supplier.fax = '+880 456';
      },
    ],
    [
      'address',
      (v: InvoiceImportReviewInput) => {
        v.supplier.address = 'Verified Address';
      },
    ],
    [
      'contact person',
      (v: InvoiceImportReviewInput) => {
        v.supplier.contactPerson = 'Verified Contact';
      },
    ],
    [
      'container',
      (v: InvoiceImportReviewInput) => {
        v.containerNumber = 'EDITED-CONTAINER';
      },
    ],
    [
      'item code',
      (v: InvoiceImportReviewInput) => {
        v.items[0].itemCode = 'EDITED';
      },
    ],
    [
      'description',
      (v: InvoiceImportReviewInput) => {
        v.items[0].description = 'Verified size';
      },
    ],
    [
      'color code',
      (v: InvoiceImportReviewInput) => {
        v.items[0].colors[0].color = 'Edited color';
      },
    ],
    [
      'Rolls',
      (v: InvoiceImportReviewInput) => {
        v.items[0].colors[0].rolls = 12;
      },
    ],
    [
      'Meter',
      (v: InvoiceImportReviewInput) => {
        v.items[0].colors[0].meter = 12.25;
      },
    ],
    [
      'optional Meter',
      (v: InvoiceImportReviewInput) => {
        v.items[0].colors[0].meter = null;
      },
    ],
    [
      'add item',
      (v: InvoiceImportReviewInput) => {
        v.items.push({
          itemCode: 'NEW-ITEM',
          description: null,
          colors: [{ color: 'Textual blue', rolls: 2, meter: 3.25 }],
        });
      },
    ],
    [
      'remove item',
      (v: InvoiceImportReviewInput) => {
        v.items.pop();
      },
    ],
    [
      'add color',
      (v: InvoiceImportReviewInput) => {
        v.items[0].colors.push({ color: 'Textual red', rolls: 3, meter: null });
      },
    ],
    [
      'remove color',
      (v: InvoiceImportReviewInput) => {
        v.items[0].colors.pop();
      },
    ],
  ])(
    'saves %s separately, with immutable extraction and no business writes',
    async (_, change) => {
      const { id, original, input } = await editableDraft();
      const hash = database.rows[0].sha256Hash;
      expect(database.rows[0].reviewedData).toBeNull();
      change(input);
      const saved = await service.updateReview(id, 'owner', input);
      expect(reviewInput(saved.review!)).toEqual(input);
      expect(saved.originalExtractedData).toEqual(original);
      expect(database.rows[0].parsedData).toEqual(original);
      expect(database.rows[0].sha256Hash).toBe(hash);
      expect(saved.hasReviewedChanges).toBe(true);
      expect(database.forbiddenWrite).not.toHaveBeenCalled();
      expect((await service.upload(uploadFile(), 'owner')).id).toBe(id);
    },
  );
  it.each([
    [
      'supplier.name',
      (v: InvoiceImportReviewInput) => {
        v.supplier.name = ' ';
      },
    ],
    [
      'containerNumber',
      (v: InvoiceImportReviewInput) => {
        v.containerNumber = '';
      },
    ],
    [
      'items',
      (v: InvoiceImportReviewInput) => {
        v.items = [];
      },
    ],
    [
      'items.0.itemCode',
      (v: InvoiceImportReviewInput) => {
        v.items[0].itemCode = ' ';
      },
    ],
    [
      'items.1.itemCode',
      (v: InvoiceImportReviewInput) => {
        v.items[1].itemCode = v.items[0].itemCode.toLowerCase();
      },
    ],
    [
      'items.0.colors',
      (v: InvoiceImportReviewInput) => {
        v.items[0].colors = [];
      },
    ],
    [
      'items.0.colors.0.color',
      (v: InvoiceImportReviewInput) => {
        v.items[0].colors[0].color = '';
      },
    ],
    [
      'items.0.colors.1.color',
      (v: InvoiceImportReviewInput) => {
        v.items[0].colors[1].color = v.items[0].colors[0].color.toLowerCase();
      },
    ],
    ...[null, 0, -1, 1.5, '12'].map(
      (n) =>
        [
          'items.0.colors.0.rolls',
          (v: InvoiceImportReviewInput) => {
            v.items[0].colors[0].rolls = n as number;
          },
        ] as const,
    ),
    ...[-1, '12', 0.001].map(
      (n) =>
        [
          'items.0.colors.0.meter',
          (v: InvoiceImportReviewInput) => {
            v.items[0].colors[0].meter = n as number;
          },
        ] as const,
    ),
  ] as [string, (v: InvoiceImportReviewInput) => void][])(
    'rejects invalid %s with structured errors, without saving',
    async (field, change) => {
      const { id, input } = await editableDraft();
      change(input);
      try {
        await service.updateReview(id, 'owner', input);
        throw new Error('Expected validation rejection');
      } catch (error) {
        expect(
          (error as { getResponse(): unknown }).getResponse(),
        ).toMatchObject({
          fieldErrors: expect.arrayContaining([
            expect.objectContaining({ field }),
          ]),
        });
      }
      expect(database.rows[0].reviewedData).toBeNull();
      expect(database.forbiddenWrite).not.toHaveBeenCalled();
    },
  );
  it('recalculates totals authoritatively and clears current mismatch after manual correction', async () => {
    const { id, input, original } = await editableDraft();
    input.items[0].colors[0].meter! += 13;
    const mismatched = await service.updateReview(id, 'owner', input);
    expect(mismatched.review!.parsedTotals.meter).toBe(
      original.parsedTotals.meter + 13,
    );
    expect(mismatched.readyForConfirmation).toBe(false);
    expect(mismatched.blockingIssues).toContainEqual(
      expect.objectContaining({
        code: 'SOURCE_TOTAL_MISMATCH',
        field: 'totals.meter',
      }),
    );
    input.items[0].colors[0].meter! -= 13;
    const corrected = await service.updateReview(id, 'owner', input);
    expect(corrected.readyForConfirmation).toBe(true);
    expect(corrected.blockingIssues).toEqual([]);
    expect(corrected.review!.invoiceTotals).toEqual(original.invoiceTotals);
  });
  it('preserves OCR values and warnings while a manual correction resolves current blocking totals', async () => {
    const doc = documentFixture();
    doc.method = 'OCR';
    doc.lines.forEach((l) => (l.method = 'OCR'));
    extract.mockResolvedValue(doc);
    const { id, input } = await editableDraft();
    const extracted = database.rows[0].parsedData as NonNullable<
      Awaited<ReturnType<typeof service.get>>['review']
    >;
    extracted.items[0].colors[0].meter! += 13;
    extracted.parsedTotals.meter += 13;
    extracted.totalsMatch.meter = false;
    extracted.warnings.push({
      code: 'METER_TOTAL_MISMATCH',
      field: 'parsedTotals.meter',
      message: 'Original OCR mismatch',
    });
    const original = structuredClone(extracted);
    const result = await service.updateReview(id, 'owner', input);
    expect(result.review!.parsedTotals.meter).toBe(
      original.parsedTotals.meter - 13,
    );
    expect(result.readyForConfirmation).toBe(true);
    expect(result.originalExtractedData).toEqual(original);
    expect(result.originalExtractedData!.warnings).toContainEqual(
      expect.objectContaining({ code: 'METER_TOTAL_MISMATCH' }),
    );
    expect(result.parsingMethod).toBe('OCR');
  });
  it('retains the seven-item/23-color OCR mismatch until explicit correction (964 Rolls, 35063 vs 35050 Meter)', async () => {
    const lines = supplierLayoutLines.map((line) => {
      if (!line.includes('906#Khaki')) return line;
      const cells = line.split('|');
      cells[3] = '1513';
      return cells.join('|');
    });
    const doc = documentFixture(lines);
    doc.method = 'OCR';
    doc.lines.forEach((line) => (line.method = 'OCR'));
    extract.mockResolvedValue(doc);
    const parsed = await service.parse(
      (await service.upload(uploadFile(), 'owner')).id,
      'owner',
    );
    expect(parsed.review!.items).toHaveLength(7);
    expect(parsed.review!.items.flatMap((item) => item.colors)).toHaveLength(
      23,
    );
    expect(parsed.review!.parsedTotals).toEqual({ rolls: 964, meter: 35063 });
    expect(parsed.review!.invoiceTotals).toEqual({ rolls: 964, meter: 35050 });
    expect(parsed.readyForConfirmation).toBe(false);
    const input = {
      ...reviewInput(parsed.review!),
      purchasedAt: '2026-09-30',
      purchaseNumber: 'PUR-TEST',
    };
    input.items
      .find((item) => item.itemCode === 'K311')!
      .colors.find((color) => color.color === '906#Khaki')!.meter = 1500;
    const corrected = await service.updateReview(parsed.id, 'owner', input);
    expect(corrected.readyForConfirmation).toBe(true);
    expect(corrected.review!.parsedTotals).toEqual({
      rolls: 964,
      meter: 35050,
    });
    expect(corrected.originalExtractedData!.parsedTotals.meter).toBe(35063);
    expect(
      corrected.originalExtractedData!.warnings.map((w) => w.code),
    ).toContain('METER_TOTAL_MISMATCH');
    expect(extract).toHaveBeenCalledTimes(1);
  });
  it('reruns item/color/description/supplier matching and container safety without stale IDs', async () => {
    const { id, input } = await editableDraft();
    database.prisma.product.findMany.mockResolvedValue([
      {
        id: 'p',
        normalizedItemCode: 'EDITED',
        description: 'Existing description',
        archivedAt: null,
        variants: [{ id: 'v', color: 'New color', archivedAt: null }],
      },
    ]);
    database.prisma.supplier.findMany.mockResolvedValue([{ id: 's' }]);
    database.prisma.container.findUnique.mockResolvedValue({ id: 'container' });
    input.items[0].itemCode = 'EDITED';
    input.items[0].colors[0].color = 'New color';
    input.supplier.name = 'Edited supplier';
    const matched = await service.updateReview(id, 'owner', input);
    expect(matched.review!.items[0]).toMatchObject({
      matchedProductId: 'p',
      matchStatus: 'DESCRIPTION_CONFLICT',
    });
    expect(matched.review!.items[0].colors[0]).toMatchObject({
      matchedVariantId: 'v',
      matchStatus: 'MATCHED',
    });
    expect(matched.readyForConfirmation).toBe(false);
    expect(matched.blockingIssues.map((i) => i.code)).toContain(
      'CONTAINER_EXISTS',
    );
    input.items[0].itemCode = 'UNKNOWN';
    input.items[0].colors[0].color = 'Another color';
    input.supplier.name = 'Unknown supplier';
    database.prisma.supplier.findMany.mockResolvedValue([]);
    database.prisma.container.findUnique.mockResolvedValue(null);
    const fresh = await service.updateReview(id, 'owner', input);
    expect(fresh.review!.supplier.matchedSupplierId).toBeNull();
    expect(fresh.review!.items[0].matchedProductId).toBeNull();
    expect(fresh.review!.items[0].colors[0].matchedVariantId).toBeNull();
    expect(fresh.blockingIssues).toEqual([]);
    expect(database.forbiddenWrite).not.toHaveBeenCalled();
  });
  it('keeps an unchanged uncertain OCR field blocking until manually corrected', async () => {
    const { id, input } = await editableDraft();
    const original = database.rows[0].parsedData as NonNullable<
      Awaited<ReturnType<typeof service.get>>['review']
    >;
    const source = original.items[0].colors[0].source!;
    original.warnings.push({
      code: 'COLOR_CODE_UNCERTAIN',
      field: 'items.colors.color',
      message: 'Verify uncertain color text',
      page: source.page,
      line: source.line,
    });
    const saved = await service.updateReview(id, 'owner', input);
    expect(saved.readyForConfirmation).toBe(false);
    expect(saved.blockingIssues.map((w) => w.code)).toContain(
      'REVIEW_SOURCE_UNCERTAIN',
    );
    input.items[0].colors[0].color = 'Verified textual color';
    const corrected = await service.updateReview(id, 'owner', input);
    expect(corrected.readyForConfirmation).toBe(true);
    expect(
      corrected.originalExtractedData!.warnings.map((w) => w.code),
    ).toContain('COLOR_CODE_UNCERTAIN');
  });
  it('reset restores extraction, recalculates current matching and totals without reading the file', async () => {
    const { id, original, input } = await editableDraft();
    input.items[0].colors[0].rolls = 1;
    input.containerNumber = 'Changed';
    await service.updateReview(id, 'owner', input);
    database.prisma.container.findUnique.mockResolvedValue({ id: 'existing' });
    const reset = await service.updateReview(id, 'owner', {}, true);
    expect(reviewInput(reset.review!)).toEqual(reviewInput(original));
    expect(reset.review!.parsedTotals).toEqual(original.parsedTotals);
    expect(reset.hasReviewedChanges).toBe(false);
    expect(reset.blockingIssues.map((i) => i.code)).toContain(
      'CONTAINER_EXISTS',
    );
    expect(extract).toHaveBeenCalledTimes(1);
    expect(reset.originalExtractedData).toEqual(original);
    expect(database.forbiddenWrite).not.toHaveBeenCalled();
  });
  it('enforces ownership, expiry, status, strict nested allowlists and immutable declared totals', async () => {
    const { id, input } = await editableDraft();
    await expect(
      service.updateReview(id, 'another-user', input),
    ).rejects.toThrow('not found');
    await expect(
      service.updateReview(id, 'another-user', {}, true),
    ).rejects.toThrow('not found');
    for (const patch of [
      { invoiceTotals: { rolls: 1 } },
      { status: 'CONFIRMED' },
      { supplier: { ...input.supplier, matchedSupplierId: 'hacked' } },
      { items: [{ ...input.items[0], matchedProductId: 'hacked' }] },
    ])
      await expect(
        service.updateReview(id, 'owner', { ...input, ...patch }),
      ).rejects.toThrow('highlighted');
    database.rows[0].expiresAt = new Date(0);
    await expect(service.updateReview(id, 'owner', input)).rejects.toThrow(
      'expired',
    );
    await expect(service.updateReview(id, 'owner', {}, true)).rejects.toThrow(
      'expired',
    );
    database.rows[0].expiresAt = new Date(Date.now() + 100000);
    for (const status of [
      'CONFIRMED',
      'PARSING',
      'FAILED',
      'UPLOADED',
    ] as const) {
      database.rows[0].status = status;
      await expect(service.updateReview(id, 'owner', input)).rejects.toThrow(
        'Only a current',
      );
    }
    expect(database.rows[0].reviewedData).toBeNull();
  });
  it('retains original row sources through edits/reordering and rejects duplicated provenance', async () => {
    const { id, input, original } = await editableDraft();
    input.items.forEach((item, i) =>
      item.colors.forEach((color, j) => {
        color.sourceRow = { item: i, color: j };
      }),
    );
    input.items[0].colors.reverse();
    input.items[0].colors[0].color = 'Corrected source color';
    const saved = await service.updateReview(id, 'owner', input);
    expect(saved.review!.items[0].colors[0].source).toEqual(
      original.items[0].colors.at(-1)!.source,
    );
    expect(saved.originalExtractedData).toEqual(original);
    input.items[0].colors[1].sourceRow = input.items[0].colors[0].sourceRow;
    await expect(service.updateReview(id, 'owner', input)).rejects.toThrow(
      'Invalid extraction',
    );
  });
  it('preserves unresolved row ownership and uncertain source totals as blockers after saving', async () => {
    const { id, input } = await editableDraft();
    const original = database.rows[0].parsedData as NonNullable<
      Awaited<ReturnType<typeof service.get>>['review']
    >;
    original.unassignedRows.push({
      itemCode: null,
      description: null,
      color: 'Unknown',
      rolls: 1,
      meter: null,
      text: 'Unresolved source row',
      reason: 'Unknown owner',
      source: { page: 1, line: 999, method: 'OCR' },
    });
    original.invoiceTotals.meter = null;
    original.warnings.push({
      code: 'INVOICE_TOTAL_UNCERTAIN',
      field: 'invoiceTotals.meter',
      message: 'Source total uncertain',
    });
    const saved = await service.updateReview(id, 'owner', input);
    expect(saved.readyForConfirmation).toBe(false);
    expect(saved.blockingIssues.map((w) => w.code)).toEqual(
      expect.arrayContaining(['ROW_OWNERSHIP', 'INVOICE_TOTAL_UNCERTAIN']),
    );
    expect(saved.review!.unassignedRows).toEqual(original.unassignedRows);
  });
  it('clears invalid OCR Meter uncertainty only after a manual value correction', async () => {
    const { id, input } = await editableDraft();
    const original = database.rows[0].parsedData as NonNullable<
      Awaited<ReturnType<typeof service.get>>['review']
    >;
    const color = original.items[0].colors[0];
    original.warnings.push({
      code: 'METER_INVALID',
      field: 'items.colors.meter',
      message: 'Uncertain OCR Meter',
      page: color.source!.page,
      line: color.source!.line,
    });
    color.meter = null;
    const saved = await service.updateReview(id, 'owner', input);
    expect(saved.readyForConfirmation).toBe(true);
    expect(saved.originalExtractedData!.items[0].colors[0].meter).toBeNull();
    expect(saved.originalExtractedData!.warnings.map((w) => w.code)).toContain(
      'METER_INVALID',
    );
  });
  it('rejects a concurrent draft modification and forged extraction references', async () => {
    const { id, input } = await editableDraft();
    input.items[0].colors[0].sourceRow = { item: 999, color: 0 };
    await expect(service.updateReview(id, 'owner', input)).rejects.toThrow(
      'Invalid extraction',
    );
    delete input.items[0].colors[0].sourceRow;
    database.prisma.invoiceImportDraft.updateMany.mockResolvedValueOnce({
      count: 0,
    });
    await expect(service.updateReview(id, 'owner', input)).rejects.toThrow(
      'changed or expired',
    );
  });
  it('fails unrecognized files and sanitizes unexpected processing errors', async () => {
    extract.mockResolvedValue(documentFixture(['Random text 123']));
    const id = (await service.upload(uploadFile(), 'owner')).id;
    expect((await service.parse(id, 'owner')).status).toBe('FAILED');
    extract.mockRejectedValue(new Error('/private/path secret stack'));
    const failed = await service.parse(id, 'owner');
    expect(failed.errors[0].code).toBe('PARSE_FAILED');
    expect(JSON.stringify(failed)).not.toContain('/private/path');
    extract.mockRejectedValue(
      new DocumentReadError('DOCUMENT_TIMEOUT', 'Reading timed out.'),
    );
    expect((await service.parse(id, 'owner')).errors[0].code).toBe(
      'DOCUMENT_TIMEOUT',
    );
    expect(database.forbiddenWrite).not.toHaveBeenCalled();
  });
  it('cleans only expired temporary files and preserves confirmed files', async () => {
    const upload = await service.upload(uploadFile(), 'owner');
    const key = database.rows[0].temporaryStorageKey;
    database.rows[0].expiresAt = new Date(0);
    await expect(service.parse(upload.id, 'owner')).rejects.toThrow('expired');
    const confirmed = await service.upload(
      uploadFile(Buffer.concat([pdf.subarray(0, -6), Buffer.from('\n%%EOF')])),
      'owner',
    );
    const permanent = database.rows.find((row) => row.id === confirmed.id)!;
    permanent.status = 'CONFIRMED';
    permanent.expiresAt = new Date(0);
    expect(await service.cleanupExpired()).toEqual({ removed: 1 });
    await expect(storage.read(key)).rejects.toThrow();
    expect(await storage.read(permanent.temporaryStorageKey)).toBeTruthy();
    expect(await service.cleanupExpired()).toEqual({ removed: 0 });
  });
  it('rejects path traversal keys and strips original path components', async () => {
    await expect(storage.put('../../escape.pdf', pdf)).rejects.toThrow(
      'Invalid',
    );
    const result = await service.upload(uploadFile(), 'owner');
    expect(result.originalFileName).toBe('invoice.pdf');
    expect(database.rows[0].temporaryStorageKey).not.toContain('invoice.pdf');
  });
});

describe('authenticated invoice import HTTP routes', () => {
  let app: INestApplication;
  let root: string;
  let token: string;
  let database: ReturnType<typeof memoryPrisma>;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'afia-invoice-http-'));
    database = memoryPrisma();
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PrismaModule,
        InvoiceImportsModule,
        JwtModule.register({ global: true, secret: 'sanitized-test-secret' }),
      ],
      providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
    })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({
          INVOICE_IMPORT_STORAGE_ROOT: root,
          INVOICE_IMPORT_MAX_FILE_MB: 1,
        }),
      )
      .overrideProvider(PrismaService)
      .useValue(database.prisma)
      .overrideProvider(DocumentExtractor)
      .useValue({ extract: vi.fn().mockResolvedValue(documentFixture()) })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    token = module
      .get(JwtService)
      .sign({ id: 'owner', name: 'Owner', role: 'OWNER' });
  });
  afterAll(async () => {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  });
  it('requires authentication on upload, parse, get and limits', async () => {
    const id = randomUUID();
    await request(app.getHttpServer()).post('/api/invoice-imports').expect(401);
    await request(app.getHttpServer())
      .post(`/api/invoice-imports/${id}/parse`)
      .expect(401);
    await request(app.getHttpServer())
      .get(`/api/invoice-imports/${id}`)
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/invoice-imports/limits')
      .expect(401);
  });
  it('supports authenticated upload → parse → get and enforces owner access', async () => {
    const upload = await request(app.getHttpServer())
      .post('/api/invoice-imports')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Afia-Invoice-Import', '1')
      .attach('file', await pdfFixture([invoiceLines]), {
        filename: 'fixture.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    const id = upload.body.id as string;
    const parsed = await request(app.getHttpServer())
      .post(`/api/invoice-imports/${id}/parse`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Afia-Invoice-Import', '1')
      .expect(201);
    expect(parsed.body.status).toBe('REVIEW');
    const result = await request(app.getHttpServer())
      .get(`/api/invoice-imports/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(result.body.review.items[0].colors[1].color).toBe('02#Pine green');
    const another = app
      .get(JwtService)
      .sign({ id: 'another-owner', role: 'OWNER' });
    await request(app.getHttpServer())
      .get(`/api/invoice-imports/${id}`)
      .set('Authorization', `Bearer ${another}`)
      .expect(404);
    expect(database.forbiddenWrite).not.toHaveBeenCalled();
  });
  it('authenticates review/reset, protects PUT against CSRF, and reports structured field errors', async () => {
    const id = database.rows.find((row) => row.status === 'REVIEW')!.id;
    const path = `/api/invoice-imports/${id}/review`;
    await request(app.getHttpServer()).put(path).send({}).expect(401);
    await request(app.getHttpServer())
      .post(`${path}/reset`)
      .send({})
      .expect(401);
    await request(app.getHttpServer())
      .put(path)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(403);
    await request(app.getHttpServer())
      .put(path)
      .set('Cookie', `afia_session=${token}`)
      .set('X-Afia-Invoice-Import', '1')
      .set('Origin', 'https://untrusted.example')
      .send({})
      .expect(403);
    const invalid = await request(app.getHttpServer())
      .put(path)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Afia-Invoice-Import', '1')
      .send({ status: 'CONFIRMED' })
      .expect(400);
    expect(invalid.body.fieldErrors).toBeDefined();
    const input = reviewInput(
      (await app.get(InvoiceImportsService).get(id, 'owner')).review!,
    );
    input.supplier.phone = 'Verified phone';
    const saved = await request(app.getHttpServer())
      .put(path)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Afia-Invoice-Import', '1')
      .send(input)
      .expect(200);
    expect(saved.body.review.supplier.phone).toBe('Verified phone');
    await request(app.getHttpServer())
      .post(`${path}/reset`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Afia-Invoice-Import', '1')
      .send({ status: 'CONFIRMED' })
      .expect(400);
    await request(app.getHttpServer())
      .post(`${path}/reset`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Afia-Invoice-Import', '1')
      .send({})
      .expect(201);
  });
  it('rejects unsupported uploads, excess fields, multiple files, and multipart oversize', async () => {
    const send = () =>
      request(app.getHttpServer())
        .post('/api/invoice-imports')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Afia-Invoice-Import', '1');
    await send()
      .attach('file', Buffer.from('hello'), {
        filename: 'fake.txt',
        contentType: 'text/plain',
      })
      .expect(400);
    await send()
      .attach('file', Buffer.alloc(1024 * 1024 + 1), {
        filename: 'large.pdf',
        contentType: 'application/pdf',
      })
      .expect(413);
    await send().field('extra', 'not accepted').expect(400);
    await send()
      .attach('file', Buffer.from('small'), 'a.pdf')
      .attach('file', Buffer.from('small'), 'b.pdf')
      .expect(400);
  });
  it('requires non-simple verification header and allowed cookie-authenticated origin', async () => {
    await request(app.getHttpServer())
      .post('/api/invoice-imports')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/invoice-imports')
      .set('Cookie', `afia_session=${token}`)
      .set('X-Afia-Invoice-Import', '1')
      .set('Origin', 'https://untrusted.example')
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/invoice-imports')
      .set('Cookie', `afia_session=${token}`)
      .set('X-Afia-Invoice-Import', '1')
      .set('Origin', 'http://localhost:5174')
      .attach('file', imageFixture(['invoice']), {
        filename: 'fixture.png',
        contentType: 'image/png',
      })
      .expect(201);
  });
  it('rejects disabled accounts and malformed draft IDs', async () => {
    await request(app.getHttpServer())
      .get('/api/invoice-imports/not-a-uuid')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    database.prisma.user.findFirst.mockResolvedValueOnce(null);
    await request(app.getHttpServer())
      .get('/api/invoice-imports/limits')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });
});
