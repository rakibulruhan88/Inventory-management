import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { reviewInput } from './invoice-review.js';
import { InvoiceImportsService } from './invoice-imports.service.js';
import { LocalInvoiceStorage } from './invoice-storage.js';
import { DocumentExtractor } from './document-extractor.js';
import { invoiceLines, pdfFixture } from './fixtures/sanitized-invoice.js';

// An isolated schema prevents full-suite receipt/sale tests from changing our safety baseline.
describe('invoice import PostgreSQL persistence and inventory safety', () => {
  const schema = `invoice_test_${randomUUID().replaceAll('-', '')}`;
  const url =
    process.env.DATABASE_URL ??
    'postgresql://afia:afia_local_password@localhost:5433/afia_inventory?schema=public';
  const admin = new PrismaClient({ adapter: new PrismaPg(url) });
  let client: PrismaClient;
  let root: string;
  let service: InvoiceImportsService;
  let actor: string;
  let pdf: Buffer;
  const domain = [
    'Supplier',
    'Purchase',
    'Container',
    'Product',
    'ProductVariant',
    'InventoryBatch',
    'Roll',
    'StockMovement',
    'Sale',
  ];
  beforeAll(async () => {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    for (const table of ['User', 'InvoiceImportDraft', ...domain])
      await admin.$executeRawUnsafe(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    // Prisma qualifies enum casts too. Clone enums and retype cloned columns locally.
    const enums = await admin.$queryRaw<
      { name: string; labels: string[] }[]
    >`SELECT t.typname::text AS name, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' GROUP BY t.typname`;
    for (const type of enums) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(type.name))
        throw new Error('Unexpected test enum name.');
      const labels = type.labels
        .map((label) => "'" + label.replaceAll("'", "''") + "'")
        .join(',');
      await admin.$executeRawUnsafe(
        `CREATE TYPE "${schema}"."${type.name}" AS ENUM (${labels})`,
      );
    }
    const columns = await admin.$queryRaw<
      {
        table_name: string;
        column_name: string;
        udt_name: string;
        column_default: string | null;
      }[]
    >`SELECT table_name::text, column_name::text, udt_name::text, column_default::text FROM information_schema.columns WHERE table_schema = 'public' AND data_type = 'USER-DEFINED'`;
    for (const column of columns.filter((column) =>
      ['User', 'InvoiceImportDraft', ...domain].includes(column.table_name),
    )) {
      const target = `"${schema}"."${column.table_name}"`;
      await admin.$executeRawUnsafe(
        `ALTER TABLE ${target} ALTER COLUMN "${column.column_name}" DROP DEFAULT`,
      );
      await admin.$executeRawUnsafe(
        `ALTER TABLE ${target} ALTER COLUMN "${column.column_name}" TYPE "${schema}"."${column.udt_name}" USING "${column.column_name}"::text::"${schema}"."${column.udt_name}"`,
      );
      const label = column.column_default?.match(/'([^']+)'/)?.[1];
      if (label)
        await admin.$executeRawUnsafe(
          `ALTER TABLE ${target} ALTER COLUMN "${column.column_name}" SET DEFAULT '${label.replaceAll("'", "''")}'::"${schema}"."${column.udt_name}"`,
        );
    }
    client = new PrismaClient({ adapter: new PrismaPg(url, { schema }) });
    actor = (
      await client.user.create({
        data: {
          name: 'Sanitized Import Tester',
          passwordHash: 'not-a-real-credential',
          role: 'STAFF',
        },
      })
    ).id;
    await client.supplier.create({
      data: { name: 'SANITIZED LEATHER CO., LTD' },
    });
    await client.product.create({
      data: {
        itemCode: 'T902',
        normalizedItemCode: 'T902',
        description: '1.2mm*54"*36.5m',
        variants: {
          create: { color: '02#Pine green', variantKey: '02#PINEGREEN' },
        },
      },
    });
    root = await mkdtemp(join(tmpdir(), 'afia-invoice-pg-'));
    const config = new ConfigService({ INVOICE_IMPORT_STORAGE_ROOT: root });
    service = new InvoiceImportsService(
      client as unknown as PrismaService,
      config,
      new LocalInvoiceStorage(config),
      new DocumentExtractor(config),
    );
    pdf = await pdfFixture([invoiceLines]);
  }, 30_000);
  afterAll(async () => {
    await client?.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.$disconnect();
    if (root) await rm(root, { recursive: true, force: true });
  });
  const snapshot = async () => {
    const records = await Promise.all(
      domain.map((table) =>
        admin.$queryRawUnsafe(
          `SELECT row_to_json(t)::text AS record FROM "${schema}"."${table}" AS t ORDER BY id`,
        ),
      ),
    );
    return JSON.stringify(records);
  };
  const file = () => ({
    buffer: pdf,
    originalname: 'safe-fixture.pdf',
    mimetype: 'application/pdf',
    size: pdf.length,
  });
  it('stores a native PDF draft/review while every inventory and purchase record remains identical', async () => {
    const before = await snapshot();
    const draft = await service.upload(file(), actor);
    expect(await snapshot()).toBe(before);
    const parsed = await service.parse(draft.id, actor);
    expect(parsed.status).toBe('REVIEW');
    expect(parsed.parsingMethod).toBe('PDF_TEXT');
    expect(parsed.review?.totalsMatch).toEqual({ rolls: true, meter: true });
    expect(parsed.review?.supplier.matchStatus).toBe('MATCHED');
    expect(parsed.review?.items[0].colors[1].matchStatus).toBe('MATCHED');
    expect(parsed.errors).toEqual([]);
    const stored = await client.invoiceImportDraft.findUniqueOrThrow({
      where: { id: draft.id },
    });
    expect(Number(stored.parsedTotalMeter)).toBe(5670.5);
    expect(await snapshot()).toBe(before);
  }, 30_000);
  it('persists edits and reset while master records, stock values, extraction and hash remain identical', async () => {
    const before = await snapshot();
    const parsed = await service.parse(
      (await service.upload(file(), actor)).id,
      actor,
    );
    const stored = await client.invoiceImportDraft.findUniqueOrThrow({
      where: { id: parsed.id },
    });
    const input = reviewInput(parsed.review!);
    input.supplier.phone = 'Verified phone';
    input.items[0].colors[0].meter! += 1.25;
    const saved = await service.updateReview(parsed.id, actor, input);
    expect(saved.readyForConfirmation).toBe(false);
    const after = await client.invoiceImportDraft.findUniqueOrThrow({
      where: { id: parsed.id },
    });
    expect(after.parsedData).toEqual(stored.parsedData);
    expect(after.parseWarnings).toEqual(stored.parseWarnings);
    expect(after.sha256Hash).toBe(stored.sha256Hash);
    expect(after.reviewedData).not.toBeNull();
    expect(await snapshot()).toBe(before);
    const reset = await service.updateReview(parsed.id, actor, {}, true);
    expect(reset.hasReviewedChanges).toBe(false);
    expect(reset.review!.parsedTotals).toEqual(parsed.review!.parsedTotals);
    expect(reset.originalExtractedData).toEqual(parsed.originalExtractedData);
    expect(await snapshot()).toBe(before);
    const expiresAt = new Date(0);
    await client.invoiceImportDraft.update({
      where: { id: parsed.id },
      data: { expiresAt },
    });
    await service.cleanupExpired();
    const cleaned = await client.invoiceImportDraft.findUniqueOrThrow({
      where: { id: parsed.id },
    });
    expect(cleaned.reviewedData).toBeNull();
    expect(cleaned.parsedData).toBeNull();
  }, 30_000);
  it('serializes simultaneous duplicate uploads without creating another active draft', async () => {
    await client.invoiceImportDraft.deleteMany();
    const results = await Promise.all([
      service.upload(file(), actor),
      service.upload(file(), actor),
    ]);
    expect(results[0].id).toBe(results[1].id);
    expect(results.filter((result) => result.duplicateFile)).toHaveLength(1);
    expect(await client.invoiceImportDraft.count()).toBe(1);
  });
});
