import 'reflect-metadata';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type {
  InvoiceImportConfirmationResponse,
  InvoiceImportReview,
} from '@afia/contracts';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { PurchasesService } from '../purchases/purchases.service.js';
import { ContainersService } from '../containers/containers.service.js';
import { InvoiceImportsModule } from './invoice-imports.module.js';
import { InvoiceImportsService } from './invoice-imports.service.js';
import { InvoiceConfirmationService } from './invoice-confirmation.service.js';
import { PurchaseDocumentsService } from './purchase-documents.service.js';
import { DocumentExtractor } from './document-extractor.js';
import { INVOICE_STORAGE, LocalInvoiceStorage } from './invoice-storage.js';
import { reviewInput } from './invoice-review.js';
import { confirmationDatabase } from './fixtures/confirmation-database.js';
import {
  documentFixture,
  imageFixture,
  invoiceLines,
  pdfFixture,
} from './fixtures/sanitized-invoice.js';

describe('atomic import receipt and secure original document archive', () => {
  let db: Awaited<ReturnType<typeof confirmationDatabase>>;
  let app: INestApplication;
  let imports: InvoiceImportsService,
    confirm: InvoiceConfirmationService,
    purchases: PurchasesService,
    documents: PurchaseDocumentsService;
  let storage: LocalInvoiceStorage;
  let root: string, actor: string, otherActor: string, token: string;
  let seq = 0;
  const extract = vi.fn();
  const hash = (bytes: Buffer) =>
    createHash('sha256').update(bytes).digest('hex');
  beforeAll(async () => {
    db = await confirmationDatabase();
    root = await mkdtemp(join(tmpdir(), 'afia-confirm-'));
    actor = (
      await db.client.user.create({
        data: {
          name: 'Fixture owner',
          role: 'OWNER',
          passwordHash: 'test-only',
        },
      })
    ).id;
    otherActor = (
      await db.client.user.create({
        data: {
          name: 'Fixture staff',
          role: 'STAFF',
          passwordHash: 'test-only',
        },
      })
    ).id;
    storage = new LocalInvoiceStorage(
      new ConfigService({ INVOICE_IMPORT_STORAGE_ROOT: root }),
    );
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        PrismaModule,
        InvoiceImportsModule,
        JwtModule.register({
          global: true,
          secret: 'test-only-confirm-secret',
        }),
      ],
      providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
    })
      .overrideProvider(PrismaService)
      .useValue(db.client)
      .overrideProvider(ConfigService)
      .useValue(new ConfigService({ INVOICE_IMPORT_STORAGE_ROOT: root }))
      .overrideProvider(DocumentExtractor)
      .useValue({ extract })
      .overrideProvider(INVOICE_STORAGE)
      .useValue(storage)
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    imports = module.get(InvoiceImportsService);
    confirm = module.get(InvoiceConfirmationService);
    purchases = module.get(PurchasesService);
    documents = module.get(PurchaseDocumentsService);
    token = module
      .get(JwtService)
      .sign({ id: actor, role: 'OWNER', name: 'Fixture owner' });
  }, 30000);
  afterAll(async () => {
    await app?.close();
    if (db) await db.close();
    if (root) await rm(root, { recursive: true, force: true });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await db.client.invoiceImportDraft.updateMany({
      where: { status: { not: 'CONFIRMED' } },
      data: { expiresAt: new Date(0) },
    });
  });
  async function fresh(
    options: {
      mime?: string;
      bytes?: Buffer;
      owner?: string;
      save?: boolean;
      method?: 'OCR' | 'PDF_TEXT';
    } = {},
  ) {
    const n = ++seq;
    const mime = options.mime ?? 'application/pdf';
    const method =
      options.method ?? (mime === 'application/pdf' ? 'PDF_TEXT' : 'OCR');
    const lines = [
      ...invoiceLines,
      'Invoice Date: 20260930',
      `TEST SOURCE ${n}`,
    ];
    const source = documentFixture(lines);
    source.method = method;
    source.lines.forEach((l) => (l.method = method));
    extract.mockResolvedValue(source);
    const bytes =
      options.bytes ??
      (mime === 'application/pdf'
        ? await pdfFixture([lines])
        : imageFixture(
            [...lines, `Unique image ${n}`],
            mime === 'image/png' ? 'png' : 'jpg',
          ));
    const uploaded = await imports.upload(
      {
        buffer: bytes,
        size: bytes.length,
        originalname: `fixture-${n}.${mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg'}`,
        mimetype: mime,
      },
      options.owner ?? actor,
    );
    const parsed = await imports.parse(uploaded.id, options.owner ?? actor);
    const input = reviewInput(parsed.review!);
    input.supplier.name = `Confirm Supplier ${n}`;
    input.supplier.phone = null;
    input.containerNumber = `CONFIRM-C${n}`;
    input.purchaseNumber = `PUR-CONFIRM-${n}`;
    input.items.forEach((item, i) => {
      item.itemCode = `CONFIRM-${n}-ITEM${i}`;
      item.colors.forEach(
        (color, j) => (color.sourceRow = { item: i, color: j }),
      );
    });
    const saved =
      options.save === false
        ? parsed
        : await imports.updateReview(
            uploaded.id,
            options.owner ?? actor,
            input,
          );
    return {
      id: uploaded.id,
      input,
      bytes,
      saved,
      owner: options.owner ?? actor,
      n,
    };
  }
  const businessTables = [
    'Supplier',
    'Product',
    'ProductVariant',
    'Container',
    'Purchase',
    'PurchaseLine',
    'InventoryBatch',
    'Roll',
    'StockMovement',
    'AuditLog',
    'PurchaseDocument',
  ];
  async function snapshot() {
    const rows = await Promise.all(
      businessTables.map((t) =>
        db.client.$queryRawUnsafe(
          `SELECT row_to_json(t)::text AS row FROM "${db.schema}"."${t}" t ORDER BY id`,
        ),
      ),
    );
    return JSON.stringify(rows);
  }
  async function permanentFiles() {
    try {
      return (
        await readdir(join(root, 'invoices'), { recursive: true })
      ).filter((name) => /\.(pdf|jpg|png)$/.test(name));
    } catch {
      return [];
    }
  }
  const send = (path: string) =>
    request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Afia-Invoice-Import', '1');

  it('confirms a saved PDF via HTTP into the shared receipt records, original archive and audit event', async () => {
    const f = await fresh();
    expect(f.saved.readyForConfirmation).toBe(true);
    const original = (
      await db.client.invoiceImportDraft.findUniqueOrThrow({
        where: { id: f.id },
      })
    ).parsedData;
    const response = await send(`/api/invoice-imports/${f.id}/confirm`)
      .send({})
      .expect(201);
    const result = response.body;
    expect(result.purchase).toMatchObject({
      totalRolls: 154,
      totalMeter: 5670.5,
      purchaseNumber: f.input.purchaseNumber,
    });
    expect(result.itemCount).toBe(2);
    expect(result.colorCount).toBe(5);
    const record = await db.client.purchaseDocument.findUniqueOrThrow({
      where: { id: result.document.id },
    });
    expect(record.storageKey).toMatch(
      /^invoices\/2026\/CONFIRM-C\d+\/[a-f0-9-]+\.pdf$/,
    );
    expect(await storage.read(record.storageKey)).toEqual(f.bytes);
    expect(record.sha256Hash).toBe(hash(f.bytes));
    const stored = await db.client.invoiceImportDraft.findUniqueOrThrow({
      where: { id: f.id },
    });
    expect(stored.status).toBe('CONFIRMED');
    expect(stored.confirmedPurchaseId).toBe(result.purchase.id);
    expect(stored.confirmedAt).not.toBeNull();
    expect(stored.parsedData).toEqual(original);
    expect(stored.reviewedData).not.toBeNull();
    expect(stored.temporaryStorageKey).toBe('');
    const receipt = await db.client.purchase.findUniqueOrThrow({
      where: { id: result.purchase.id },
      include: { lines: { include: { batch: true } }, container: true },
    });
    expect(receipt.purchasedAt.toISOString()).toBe('2026-09-30T00:00:00.000Z');
    expect(receipt.container.containerNumber).toBe(f.input.containerNumber);
    expect(receipt.lines).toHaveLength(5);
    expect(receipt.lines.reduce((s, l) => s + l.batch.availableRolls, 0)).toBe(
      154,
    );
    expect(
      receipt.lines.reduce((s, l) => s + Number(l.batch.availableMeter), 0),
    ).toBe(5670.5);
    expect(
      await db.client.stockMovement.count({
        where: { reference: f.input.purchaseNumber!, type: 'PURCHASE' },
      }),
    ).toBe(5);
    expect(
      await db.client.auditLog.count({
        where: {
          action: 'PURCHASE_RECEIVED',
          entityId: receipt.id,
          userId: actor,
        },
      }),
    ).toBe(1);
    expect(
      await db.client.roll.count({
        where: { batch: { containerId: receipt.containerId } },
      }),
    ).toBe(0); // Existing receipt path tracks batch Rolls, not individual Roll creation.
    expect(JSON.stringify(result)).not.toContain('storageKey');
    expect(JSON.stringify(result)).not.toContain(root);
  });
  it.each(['image/png', 'image/jpeg'])(
    'confirms corrected %s OCR while preserving original bytes/warnings',
    async (mime) => {
      const f = await fresh({ mime });
      const row = await db.client.invoiceImportDraft.findUniqueOrThrow({
        where: { id: f.id },
      });
      const original = structuredClone(row.parsedData as InvoiceImportReview);
      original.items[0].colors[0].meter! += 13;
      original.parsedTotals.meter += 13;
      original.totalsMatch.meter = false;
      original.warnings.push({
        code: 'METER_TOTAL_MISMATCH',
        field: 'parsedTotals.meter',
        message: 'Original OCR total mismatch',
      });
      await db.client.invoiceImportDraft.update({
        where: { id: f.id },
        data: {
          parsedData: JSON.parse(JSON.stringify(original)),
          parseWarnings: JSON.parse(JSON.stringify(original.warnings)),
        },
      });
      const readCount = extract.mock.calls.length;
      const result = await confirm.confirm(f.id, actor, {});
      expect(result.purchase.totalMeter).toBe(5670.5);
      expect((await imports.get(f.id, actor)).originalExtractedData).toEqual(
        original,
      );
      expect(extract.mock.calls.length).toBe(readCount);
      expect((await documents.content(result.document.id)).bytes).toEqual(
        f.bytes,
      );
      expect(result.document.sha256Hash).toBe(hash(f.bytes));
    },
  );
  it('serializes simultaneous confirms and a retry even after draft expiry into exactly one stock increase', async () => {
    const f = await fresh();
    const [a, b] = await Promise.all([
      confirm.confirm(f.id, actor, {}),
      confirm.confirm(f.id, actor, {}),
    ]);
    expect(a.purchase.id).toBe(b.purchase.id);
    expect([a.alreadyConfirmed, b.alreadyConfirmed].sort()).toEqual([
      false,
      true,
    ]);
    expect(
      await db.client.purchase.count({
        where: { purchaseNumber: f.input.purchaseNumber! },
      }),
    ).toBe(1);
    expect(
      await db.client.container.count({
        where: { containerNumber: f.input.containerNumber },
      }),
    ).toBe(1);
    expect(
      await db.client.purchaseLine.count({
        where: { purchaseId: a.purchase.id },
      }),
    ).toBe(5);
    await db.client.invoiceImportDraft.update({
      where: { id: f.id },
      data: { expiresAt: new Date(0) },
    });
    const retried = await confirm.confirm(f.id, actor, {});
    expect(retried.purchase.id).toBe(a.purchase.id);
    expect(retried.alreadyConfirmed).toBe(true);
  });
  it('blocks the same SHA-256 from another owner/draft, without private record details', async () => {
    const a = await fresh();
    const b = await fresh({ bytes: a.bytes, owner: otherActor });
    await confirm.confirm(a.id, actor, {});
    const before = await snapshot();
    await expect(confirm.confirm(b.id, otherActor, {})).rejects.toThrow(
      'already received',
    );
    expect(await snapshot()).toBe(before);
  });
  it('allows only one receipt when separate source files race for the same container', async () => {
    const a = await fresh(),
      b = await fresh();
    b.input.containerNumber = a.input.containerNumber;
    await imports.updateReview(b.id, actor, b.input);
    const results = await Promise.allSettled([
      confirm.confirm(a.id, actor, {}),
      confirm.confirm(b.id, actor, {}),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(
      await db.client.container.count({
        where: { containerNumber: a.input.containerNumber },
      }),
    ).toBe(1);
  });
  it.each([
    'totals',
    'required',
    'rolls',
    'meter',
    'date',
    'reference',
    'duplicate item',
    'duplicate color',
    'quantity uncertainty',
  ])(
    'revalidates a stale or manipulated %s blocker without business changes',
    async (kind) => {
      const f = await fresh();
      const row = await db.client.invoiceImportDraft.findUniqueOrThrow({
        where: { id: f.id },
      });
      const review = structuredClone(row.reviewedData as InvoiceImportReview);
      if (kind === 'totals') review.items[0].colors[0].meter! += 1;
      if (kind === 'required') review.containerNumber = ' ';
      if (kind === 'rolls') review.items[0].colors[0].rolls = 1.5;
      if (kind === 'meter') review.items[0].colors[0].meter = -1;
      if (kind === 'date') review.purchasedAt = null;
      if (kind === 'reference') review.purchaseNumber = null;
      if (kind === 'duplicate item')
        review.items[1].itemCode = review.items[0].itemCode;
      if (kind === 'duplicate color')
        review.items[0].colors[1].color = review.items[0].colors[0].color;
      if (kind === 'quantity uncertainty') {
        const original = structuredClone(row.parsedData as InvoiceImportReview);
        const source = original.items[0].colors[0].source!;
        original.warnings.push({
          code: 'OCR_FIELD_UNCERTAIN',
          field: 'items.colors.rolls',
          page: source.page,
          line: source.line,
          message: 'Uncertain Rolls',
        });
        await db.client.invoiceImportDraft.update({
          where: { id: f.id },
          data: { parsedData: JSON.parse(JSON.stringify(original)) },
        });
      }
      review.validationPassed = true;
      review.parsedTotals = { rolls: 154, meter: 5670.5 };
      review.warnings = [];
      await db.client.invoiceImportDraft.update({
        where: { id: f.id },
        data: { reviewedData: JSON.parse(JSON.stringify(review)) },
      });
      const before = await snapshot();
      await expect(confirm.confirm(f.id, actor, {})).rejects.toThrow();
      expect(await snapshot()).toBe(before);
    },
  );
  it.each([
    'supplier ambiguity',
    'color ambiguity',
    'description conflict',
    'missing description',
    'existing container',
    'archived item',
    'archived color',
  ])('reruns matching against a new %s before receipt', async (kind) => {
    const f = await fresh();
    if (kind === 'supplier ambiguity')
      await db.client.supplier.createMany({
        data: [
          { name: f.input.supplier.name },
          { name: f.input.supplier.name },
        ],
      });
    if (kind === 'existing container') {
      const s = await db.client.supplier.create({
        data: { name: 'Existing container supplier' },
      });
      await db.client.container.create({
        data: {
          containerNumber: f.input.containerNumber,
          normalizedContainerNumber: f.input.containerNumber,
          supplierId: s.id,
        },
      });
    }
    if (!['supplier ambiguity', 'existing container'].includes(kind))
      await db.client.product.create({
        data: {
          itemCode: f.input.items[0].itemCode,
          normalizedItemCode: f.input.items[0].itemCode,
          description:
            kind === 'missing description'
              ? null
              : kind === 'description conflict'
                ? 'Conflicting size'
                : f.input.items[0].description,
          archivedAt: kind === 'archived item' ? new Date() : null,
          variants:
            kind === 'color ambiguity'
              ? {
                  create: [
                    {
                      color: f.input.items[0].colors[0].color,
                      variantKey: 'LEGACY-A',
                    },
                    {
                      color: f.input.items[0].colors[0].color,
                      variantKey: 'LEGACY-B',
                    },
                  ],
                }
              : kind === 'archived color'
                ? {
                    create: {
                      color: f.input.items[0].colors[0].color,
                      variantKey: f.input.items[0].colors[0].color
                        .toUpperCase()
                        .replaceAll(' ', ''),
                      archivedAt: new Date(),
                    },
                  }
                : undefined,
        },
      });
    const before = await snapshot();
    await expect(confirm.confirm(f.id, actor, {})).rejects.toThrow(
      'needs review',
    );
    expect(await snapshot()).toBe(before);
  });
  it('reuses existing supplier/product/color and creates only genuinely new masters, with no unsupported supplier fields', async () => {
    const f = await fresh();
    const supplier = await db.client.supplier.create({
      data: {
        name: f.input.supplier.name,
        phone: '123',
        address: 'Existing address',
      },
    });
    const product = await db.client.product.create({
      data: {
        itemCode: f.input.items[0].itemCode,
        normalizedItemCode: f.input.items[0].itemCode,
        description: f.input.items[0].description,
        variants: {
          create: {
            color: f.input.items[0].colors[0].color,
            variantKey: '1#BLACK',
          },
        },
      },
      include: { variants: true },
    });
    f.input.supplier.fax = 'Source fax';
    f.input.supplier.contactPerson = 'Source contact';
    f.input.supplier.address = 'Different invoice address';
    await imports.updateReview(f.id, actor, f.input);
    const result = await confirm.confirm(f.id, actor, {});
    const receipt = await db.client.purchase.findUniqueOrThrow({
      where: { id: result.purchase.id },
      include: { lines: true },
    });
    expect(receipt.supplierId).toBe(supplier.id);
    expect(
      await db.client.supplier.findUnique({ where: { id: supplier.id } }),
    ).toEqual(supplier);
    expect(
      receipt.lines.some((l) => l.variantId === product.variants[0].id),
    ).toBe(true);
    expect(
      await db.client.product.count({
        where: {
          normalizedItemCode: { in: f.input.items.map((i) => i.itemCode) },
        },
      }),
    ).toBe(2);
    expect(result.purchase.reusedItemCodes).toContain(product.itemCode);
    expect((await imports.get(f.id, actor)).review!.supplier.fax).toBe(
      'Source fax',
    );
  });
  it('creates a new supplier with intentional phone/address fields while retaining fax/contact in review only', async () => {
    const f = await fresh();
    f.input.supplier.phone = '+880 111-222';
    f.input.supplier.address = 'Invoice address';
    f.input.supplier.fax = 'Fax info';
    f.input.supplier.contactPerson = 'Contact info';
    await imports.updateReview(f.id, actor, f.input);
    const result = await confirm.confirm(f.id, actor, {});
    const receipt = await db.client.purchase.findUniqueOrThrow({
      where: { id: result.purchase.id },
      include: { supplier: true },
    });
    expect(receipt.supplier).toMatchObject({
      name: f.input.supplier.name,
      phone: '+880111222',
      address: 'Invoice address',
      notes: null,
    });
    expect(
      (await imports.get(f.id, actor)).review!.supplier.contactPerson,
    ).toBe('Contact info');
  });
  it('does not select an unrelated company by contact-only matching', async () => {
    const f = await fresh();
    await db.client.supplier.create({
      data: { name: 'Unrelated fixture supplier', phone: '+999111' },
    });
    f.input.supplier.phone = '+999111';
    await imports.updateReview(f.id, actor, f.input);
    const before = await snapshot();
    await expect(confirm.confirm(f.id, actor, {})).rejects.toThrow(
      'another existing supplier',
    );
    expect(await snapshot()).toBe(before);
  });
  it('rolls back partial receipt work and compensates the new archive copy on a midway failure', async () => {
    const f = await fresh();
    const before = await snapshot();
    const files = await permanentFiles();
    const temp = (
      await db.client.invoiceImportDraft.findUniqueOrThrow({
        where: { id: f.id },
      })
    ).temporaryStorageKey;
    await db.client.$executeRawUnsafe(
      `CREATE FUNCTION "${db.schema}".fail_receipt() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test SQL private detail'; END; $$ LANGUAGE plpgsql`,
    );
    await db.client.$executeRawUnsafe(
      `CREATE TRIGGER fail_receipt BEFORE INSERT ON "${db.schema}"."PurchaseLine" FOR EACH ROW EXECUTE FUNCTION "${db.schema}".fail_receipt()`,
    );
    try {
      await expect(confirm.confirm(f.id, actor, {})).rejects.toThrow(
        'Confirmation could not finish',
      );
    } finally {
      await db.client.$executeRawUnsafe(
        `DROP TRIGGER fail_receipt ON "${db.schema}"."PurchaseLine"`,
      );
      await db.client.$executeRawUnsafe(
        `DROP FUNCTION "${db.schema}".fail_receipt()`,
      );
    }
    expect(await snapshot()).toBe(before);
    expect(await permanentFiles()).toEqual(files);
    expect(await storage.read(temp)).toEqual(f.bytes);
    expect((await imports.get(f.id, actor)).status).toBe('REVIEW');
    expect((await confirm.confirm(f.id, actor, {})).purchase.totalRolls).toBe(
      154,
    );
  });
  it('rolls back all business records if permanent document insertion fails after receipt', async () => {
    const f = await fresh();
    const before = await snapshot();
    const files = await permanentFiles();
    await db.client.$executeRawUnsafe(
      `CREATE FUNCTION "${db.schema}".fail_document() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test doc failure'; END; $$ LANGUAGE plpgsql`,
    );
    await db.client.$executeRawUnsafe(
      `CREATE TRIGGER fail_document BEFORE INSERT ON "${db.schema}"."PurchaseDocument" FOR EACH ROW EXECUTE FUNCTION "${db.schema}".fail_document()`,
    );
    try {
      await expect(confirm.confirm(f.id, actor, {})).rejects.toThrow();
    } finally {
      await db.client.$executeRawUnsafe(
        `DROP TRIGGER fail_document ON "${db.schema}"."PurchaseDocument"`,
      );
      await db.client.$executeRawUnsafe(
        `DROP FUNCTION "${db.schema}".fail_document()`,
      );
    }
    expect(await snapshot()).toBe(before);
    expect(await permanentFiles()).toEqual(files);
  });
  it('keeps committed stock/archive when temp removal fails and lets cleanup recover without losing history', async () => {
    const f = await fresh();
    const temp = (
      await db.client.invoiceImportDraft.findUniqueOrThrow({
        where: { id: f.id },
      })
    ).temporaryStorageKey;
    const remove = storage.remove.bind(storage);
    vi.spyOn(storage, 'remove').mockImplementationOnce(async () => {
      throw new Error('Temporary cleanup failure');
    });
    const result = await confirm.confirm(f.id, actor, {});
    expect(await storage.read(temp)).toEqual(f.bytes);
    await db.client.invoiceImportDraft.update({
      where: { id: f.id },
      data: { expiresAt: new Date(0) },
    });
    await imports.cleanupExpired();
    expect(
      await storage.read(
        (
          await db.client.purchaseDocument.findUniqueOrThrow({
            where: { id: result.document.id },
          })
        ).storageKey,
      ),
    ).toEqual(f.bytes);
    expect(
      (await imports.get(f.id, actor)).originalExtractedData,
    ).not.toBeNull();
    expect((await imports.get(f.id, actor)).review).not.toBeNull();
    await expect(storage.read(temp)).rejects.toThrow();
    expect((await confirm.confirm(f.id, actor, {})).purchase.id).toBe(
      result.purchase.id,
    );
    void remove;
  });
  it('does not delete a committed archive when the database commit response is lost', async () => {
    const f = await fresh();
    const transaction = db.client.$transaction.bind(db.client);
    const loseResponse = async (
      callback: (
        tx: Prisma.TransactionClient,
      ) => Promise<InvoiceImportConfirmationResponse>,
      options?: { timeout?: number; maxWait?: number },
    ) => {
      await transaction(callback, options);
      throw new Error('Commit response lost');
    };
    vi.spyOn(db.client, '$transaction').mockImplementationOnce(
      loseResponse as unknown as typeof db.client.$transaction,
    );
    const result = await confirm.confirm(f.id, actor, {});
    expect(result.alreadyConfirmed).toBe(true);
    expect((await documents.content(result.document.id)).bytes).toEqual(
      f.bytes,
    );
    expect(
      await db.client.purchase.count({
        where: { purchaseNumber: f.input.purchaseNumber! },
      }),
    ).toBe(1);
    expect((await confirm.confirm(f.id, actor, {})).purchase.id).toBe(
      result.purchase.id,
    );
  });
  it('waits for a still-settling transaction before compensating a lost commit response', async () => {
    const f = await fresh();
    const transaction = db.client.$transaction.bind(db.client);
    let ready!: () => void, release!: () => void;
    const callbackReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const commitGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let settling!: Promise<InvoiceImportConfirmationResponse>;
    vi.spyOn(db.client, '$transaction').mockImplementationOnce((async (
      callback: (
        tx: Prisma.TransactionClient,
      ) => Promise<InvoiceImportConfirmationResponse>,
      options?: { timeout?: number; maxWait?: number },
    ) => {
      settling = transaction(async (tx) => {
        const result = await callback(tx);
        ready();
        await commitGate;
        return result;
      }, options);
      await callbackReady;
      throw new Error('Commit connection lost while settling');
    }) as unknown as typeof db.client.$transaction);
    const receiving = confirm.confirm(f.id, actor, {});
    await callbackReady;
    // The first receipt owns the same lock compensation must await.
    const observer = await transaction(
      async (tx) =>
        tx.$queryRaw<
          { available: boolean }[]
        >`SELECT pg_try_advisory_xact_lock(hashtext(${`invoice-confirm:${f.id}`})) AS available`,
    );
    expect(observer[0].available).toBe(false);
    release();
    await settling;
    const result = await receiving;
    expect(result.alreadyConfirmed).toBe(true);
    expect((await documents.content(result.document.id)).bytes).toEqual(
      f.bytes,
    );
    expect(
      await db.client.purchase.count({
        where: { purchaseNumber: f.input.purchaseNumber! },
      }),
    ).toBe(1);
  });
  it('serializes an attempted review save behind confirmation and refuses to overwrite confirmed history', async () => {
    const f = await fresh();
    let copied!: () => void, release!: () => void, saving!: () => void;
    const atCopy = new Promise<void>((r) => (copied = r)),
      canCopy = new Promise<void>((r) => (release = r)),
      atSave = new Promise<void>((r) => (saving = r));
    const put = storage.put.bind(storage);
    vi.spyOn(storage, 'put').mockImplementationOnce(async (key, bytes) => {
      copied();
      await canCopy;
      return put(key, bytes);
    });
    const receiving = confirm.confirm(f.id, actor, {});
    await atCopy;
    const transaction = db.client.$transaction.bind(db.client);
    vi.spyOn(db.client, '$transaction').mockImplementationOnce((callback, options) => {
      saving();
      return transaction(callback, options);
    });
    const edit = structuredClone(f.input);
    edit.containerNumber = 'UNSAVED-CONCURRENT-CONTAINER';
    const save = imports.updateReview(f.id, actor, edit);
    const saveResult = save.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await atSave;
    release();
    const received = await receiving;
    expect(await saveResult).toHaveProperty('error');
    expect(received.purchase.containerNumber).toBe(f.input.containerNumber);
    expect((await imports.get(f.id, actor)).status).toBe('CONFIRMED');
  });
  it('archive-copy failure leaves no receipt and keeps the source retryable', async () => {
    const f = await fresh();
    const before = await snapshot();
    const files = await permanentFiles();
    vi.spyOn(storage, 'put').mockRejectedValueOnce(
      new Error('Disk write failed'),
    );
    await expect(confirm.confirm(f.id, actor, {})).rejects.toThrow(
      'Confirmation could not finish',
    );
    expect(await snapshot()).toBe(before);
    expect(await permanentFiles()).toEqual(files);
    expect((await imports.get(f.id, actor)).status).toBe('REVIEW');
    expect((await confirm.confirm(f.id, actor, {})).purchase.totalRolls).toBe(
      154,
    );
  });
  it('cleanup preserves a recovery temp when its permanent file is unavailable and still cleans expired unconfirmed imports', async () => {
    const f = await fresh();
    const temp = (
      await db.client.invoiceImportDraft.findUniqueOrThrow({
        where: { id: f.id },
      })
    ).temporaryStorageKey;
    vi.spyOn(storage, 'remove').mockRejectedValueOnce(
      new Error('Temporary removal failed'),
    );
    const result = await confirm.confirm(f.id, actor, {});
    const record = await db.client.purchaseDocument.findUniqueOrThrow({
      where: { id: result.document.id },
    });
    await storage.remove(record.storageKey);
    await db.client.invoiceImportDraft.update({
      where: { id: f.id },
      data: { expiresAt: new Date(0) },
    });
    const expired = await fresh();
    await db.client.invoiceImportDraft.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(0) },
    });
    const retry = await confirm.confirm(f.id, actor, {});
    expect(retry.purchase.id).toBe(result.purchase.id);
    expect(await storage.read(temp)).toEqual(f.bytes);
    await imports.cleanupExpired();
    expect(await storage.read(temp)).toEqual(f.bytes);
    expect((await imports.get(f.id, actor)).status).toBe('CONFIRMED');
    expect((await imports.get(expired.id, actor)).status).toBe('EXPIRED');
  });
  it('rejects invalid source bytes before receipt and preserves the temporary source', async () => {
    const f = await fresh();
    const temp = (
      await db.client.invoiceImportDraft.findUniqueOrThrow({
        where: { id: f.id },
      })
    ).temporaryStorageKey;
    await writeFile(join(root, temp), Buffer.from('tampered'));
    const before = await snapshot();
    await expect(confirm.confirm(f.id, actor, {})).rejects.toThrow();
    expect(await snapshot()).toBe(before);
    expect((await imports.get(f.id, actor)).status).toBe('REVIEW');
  });
  it('blocks unsaved, expired, wrong-owner, inactive-user drafts and mass-assigned confirmation flags', async () => {
    const f = await fresh({ save: false });
    const path = `/api/invoice-imports/${f.id}/confirm`;
    await request(app.getHttpServer()).post(path).send({}).expect(401);
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(403);
    await send(path).send({ force: true }).expect(400);
    await expect(confirm.confirm(f.id, otherActor, {})).rejects.toThrow(
      'not found',
    );
    await expect(confirm.confirm(f.id, actor, {})).rejects.toThrow(
      'Save a current',
    );
    await imports.updateReview(f.id, actor, f.input);
    await db.client.invoiceImportDraft.update({
      where: { id: f.id },
      data: { expiresAt: new Date(0) },
    });
    await expect(confirm.confirm(f.id, actor, {})).rejects.toThrow('expired');
    const g = await fresh();
    await db.client.user.update({
      where: { id: actor },
      data: { isActive: false },
    });
    try {
      await send(`/api/invoice-imports/${g.id}/confirm`).send({}).expect(401);
      await expect(confirm.confirm(g.id, actor, {})).rejects.toThrow(
        'active account',
      );
    } finally {
      await db.client.user.update({
        where: { id: actor },
        data: { isActive: true },
      });
    }
  });
  it.each(['application/pdf', 'image/png', 'image/jpeg'])(
    'serves exact authenticated %s bytes inline and as a safe download',
    async (mime) => {
      const f = await fresh({ mime });
      const result = await confirm.confirm(f.id, actor, {});
      const path = `/api/documents/${result.document.id}`;
      await request(app.getHttpServer()).get(`${path}/content`).expect(401);
      const metadata = await request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(metadata.body).not.toHaveProperty('storageKey');
      const view = await request(app.getHttpServer())
        .get(`${path}/content`)
        .set('Authorization', `Bearer ${token}`)
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(view.headers['content-type']).toContain(mime);
      expect(view.headers['content-disposition']).toMatch(/^inline;/);
      expect(view.headers['x-content-type-options']).toBe('nosniff');
      expect(view.body).toEqual(f.bytes);
      const download = await request(app.getHttpServer())
        .get(`${path}/content?download=true`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(download.headers['content-disposition']).toMatch(/^attachment;/);
      // Active staff share confirmed purchase documents; unconfirmed drafts do not.
      const other = app.get(JwtService).sign({ id: otherActor, role: 'STAFF' });
      await request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${other}`)
        .expect(200);
    },
  );
  it('sanitizes Content-Disposition and rejects forged MIME, traversal keys, missing files and invalid IDs', async () => {
    const f = await fresh();
    const result = await confirm.confirm(f.id, actor, {});
    const id = result.document.id;
    const record = await db.client.purchaseDocument.findUniqueOrThrow({
      where: { id },
    });
    const path = `/api/documents/${id}/content`;
    await db.client.purchaseDocument.update({
      where: { id },
      data: { originalFileName: 'evil"\r\nX-Evil: yes/☃.pdf' },
    });
    const response = await request(app.getHttpServer())
      .get(`${path}?download=true`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(response.headers).not.toHaveProperty('x-evil');
    expect(response.headers['content-disposition']).not.toMatch(/[\r\n]/);
    await request(app.getHttpServer())
      .get(`${path}?download=../../secret`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    await request(app.getHttpServer())
      .get(`/api/documents/${randomUUID()}/content`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    await request(app.getHttpServer())
      .get('/api/documents/not-a-uuid/content')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    for (const patch of [
      { storageKey: '../../outside.pdf' },
      {
        storageKey:
          'tmp/invoice-imports/' + randomUUID() + '/' + randomUUID() + '.pdf',
      },
      { mimeType: 'text/html\r\nX-Evil: yes' },
      { mimeType: 'image/png' },
      { sha256Hash: '0'.repeat(64) },
    ]) {
      await db.client.purchaseDocument.update({
        where: { id },
        data: {
          storageKey: record.storageKey,
          mimeType: record.mimeType,
          sha256Hash: record.sha256Hash,
          ...patch,
        },
      });
      const rejected = await request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
      expect(JSON.stringify(rejected.body)).not.toContain(root);
      expect(JSON.stringify(rejected.body)).not.toContain('storageKey');
    }
    await db.client.purchaseDocument.update({
      where: { id },
      data: {
        storageKey: record.storageKey,
        mimeType: record.mimeType,
        sha256Hash: record.sha256Hash,
      },
    });
    await storage.remove(record.storageKey);
    await request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
  it('rejects inactive document readers and encoded path IDs, and enforces confirmation cookie-origin checks', async () => {
    const f = await fresh();
    const path = `/api/invoice-imports/${f.id}/confirm`;
    await request(app.getHttpServer())
      .post(path)
      .set('Cookie', `afia_session=${token}`)
      .set('X-Afia-Invoice-Import', '1')
      .set('Origin', 'https://untrusted.example')
      .send({})
      .expect(403);
    const received = await request(app.getHttpServer())
      .post(path)
      .set('Cookie', `afia_session=${token}`)
      .set('X-Afia-Invoice-Import', '1')
      .set('Origin', 'http://localhost:5174')
      .send({})
      .expect(201);
    const docId = received.body.document.id as string;
    await request(app.getHttpServer())
      .get('/api/documents/..%2foutside/content')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    await db.client.user.update({
      where: { id: actor },
      data: { isActive: false },
    });
    try {
      await request(app.getHttpServer())
        .get(`/api/documents/${docId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
      await request(app.getHttpServer())
        .get(`/api/documents/${docId}/content`)
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    } finally {
      await db.client.user.update({
        where: { id: actor },
        data: { isActive: true },
      });
    }
  });
  it('rejects symlink file traversal and only removes the targeted permanent file', async () => {
    const one = storage.createPermanentKey(2026, 'SAFE-CONTAINER', 'pdf'),
      two = storage.createPermanentKey(2026, 'SAFE-CONTAINER', 'pdf');
    await storage.put(one, Buffer.from('one'));
    await storage.put(two, Buffer.from('two'));
    await storage.remove(one);
    expect(await storage.read(two)).toEqual(Buffer.from('two'));
    const outside = join(root, 'outside.pdf');
    await writeFile(outside, Buffer.from('private'));
    await rm(join(root, two));
    await symlink(outside, join(root, two));
    await expect(storage.read(two)).rejects.toThrow('Invalid');
    await expect(storage.read('../outside.pdf')).rejects.toThrow('Invalid');
  });
  it('reverses imported receipts via the existing path, retains documents, and does not receive again on retry', async () => {
    const f = await fresh(),
      result = await confirm.confirm(f.id, actor, {});
    await purchases.reverse(result.purchase.id, 'Fixture correction', actor);
    const record = await db.client.purchaseDocument.findUniqueOrThrow({
      where: { id: result.document.id },
    });
    expect(await storage.read(record.storageKey)).toEqual(f.bytes);
    const stock = await db.client.inventoryBatch.aggregate({
      where: { containerId: result.containerId },
      _sum: { availableRolls: true, availableMeter: true },
    });
    expect(stock._sum.availableRolls).toBe(0);
    expect(Number(stock._sum.availableMeter)).toBe(0);
    expect(
      await db.client.stockMovement.count({
        where: {
          reference: result.purchase.purchaseNumber,
          type: 'PURCHASE_REVERSAL',
        },
      }),
    ).toBe(5);
    const retry = await confirm.confirm(f.id, actor, {});
    expect(retry.purchase.id).toBe(result.purchase.id);
    expect(retry.purchaseStatus).toBe('CANCELLED');
    expect((await purchases.get(result.purchase.id)).documents[0].id).toBe(
      record.id,
    );
  });
  it('never treats a permanent source as temporary cleanup on retry or expiry cleanup', async () => {
    const f = await fresh(),
      result = await confirm.confirm(f.id, actor, {});
    const doc = await db.client.purchaseDocument.findUniqueOrThrow({
      where: { id: result.document.id },
    });
    await db.client.invoiceImportDraft.update({
      where: { id: f.id },
      data: { temporaryStorageKey: doc.storageKey, expiresAt: new Date(0) },
    });
    await confirm.confirm(f.id, actor, {});
    await imports.cleanupExpired();
    expect(await storage.read(doc.storageKey)).toEqual(f.bytes);
    expect((await imports.get(f.id, actor)).status).toBe('CONFIRMED');
  });
  it('exposes one document through purchase/container relations without another file copy', async () => {
    const f = await fresh(),
      result = await confirm.confirm(f.id, actor, {});
    expect((await purchases.get(result.purchase.id)).documents[0].id).toBe(
      result.document.id,
    );
    const containers = await new ContainersService(
      db.client as unknown as PrismaService,
    ).list(f.input.containerNumber);
    expect(containers[0].documents![0].id).toBe(result.document.id);
    expect(
      await db.client.purchaseDocument.count({
        where: { purchaseId: result.purchase.id },
      }),
    ).toBe(1);
  });
  it('keeps manual receiving and reversal on the same receipt operation without requiring a document', async () => {
    const n = ++seq;
    const receipt = await purchases.receive(
      {
        supplier: { name: `Manual fixture ${n}` },
        containerNumber: `MANUAL-${n}`,
        purchaseNumber: `PUR-MANUAL-${n}`,
        purchasedAt: '2026-09-29',
        items: [
          {
            itemCode: `MANUAL-ITEM-${n}`,
            colors: [
              { color: '02#Pine green', rolls: 3 },
              { color: '01#Blue', rolls: 2, totalMeter: 3.25 },
            ],
          },
        ],
      },
      actor,
    );
    expect(receipt).toMatchObject({ totalRolls: 5, totalMeter: 3.25 });
    expect((await purchases.get(receipt.id)).documents).toEqual([]);
    await purchases.reverse(receipt.id, 'Manual correction', actor);
    expect((await purchases.get(receipt.id)).status).toBe('CANCELLED');
  });
});
