import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

it('backfills only agreed sizes, preserves conflicts and snapshots, and keeps duplicate variants', async () => {
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      'postgresql://afia:afia_local_password@localhost:5433/afia_inventory',
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Transaction-local fixture: never touches public inventory, and always rolls back.
    await client.query(`CREATE SCHEMA supplier_invoice_migration_test;
      SET LOCAL search_path TO supplier_invoice_migration_test;
      CREATE TABLE "Product" (id text PRIMARY KEY, "itemCode" text, description text, name text, "searchText" text);
      CREATE TABLE "ProductVariant" (id text PRIMARY KEY, "productId" text, color text, "colorCode" text NOT NULL DEFAULT '#8B5A2B', size text, "variantKey" text, "searchText" text, UNIQUE("productId", "variantKey"));
      CREATE INDEX "ProductVariant_size_idx" ON "ProductVariant" (size);
      CREATE TABLE "SaleLine" ("colorNameSnapshot" text, "colorCodeSnapshot" text);
      INSERT INTO "SaleLine" VALUES ('Old Black', '#000000');
      INSERT INTO "Product" (id, "itemCode", description) VALUES ('agreed','T902',NULL),('conflict','CONFLICT',NULL),('existing','EXISTING','Original description');
      INSERT INTO "ProductVariant" (id,"productId",color,"colorCode",size,"variantKey") VALUES
        ('a','agreed','Black','#000000','1.2mm*54"*36.5m','BLACK|SIZE'),
        ('b','agreed','Green','02#Pine green','1.2mm*54"*36.5m','GREEN|SIZE'),
        ('c','conflict','Black','#000000','10x10','BLACK|10'),
        ('d','conflict','Black','#000000','12x12','BLACK|12'),
        ('e','existing','Beige','#FFFFFF','Different size','BEIGE|SIZE');`);
    const migration = await readFile(
      new URL(
        '../prisma/migrations/20261005000000_supplier_invoice_identity/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await client.query(migration);
    const products = (
      await client.query('SELECT id, description FROM "Product" ORDER BY id')
    ).rows;
    expect(products).toEqual([
      { id: 'agreed', description: '1.2mm*54"*36.5m' },
      { id: 'conflict', description: null },
      { id: 'existing', description: 'Original description' },
    ]);
    const variants = (
      await client.query(
        'SELECT id, color, "legacySize", "legacyColorCode", "variantKey" FROM "ProductVariant" ORDER BY id',
      )
    ).rows;
    expect(variants).toHaveLength(5);
    expect(variants[1]).toMatchObject({
      color: '02#Pine green',
      legacyColorCode: '02#Pine green',
      variantKey: '02#PINEGREEN',
    });
    expect(variants[2]).toMatchObject({
      legacySize: '10x10',
      variantKey: 'LEGACY:c',
    });
    expect(variants[3]).toMatchObject({
      legacySize: '12x12',
      variantKey: 'LEGACY:d',
    });
    expect((await client.query('SELECT * FROM "SaleLine"')).rows).toEqual([
      {
        colorNameSnapshot: 'Old Black',
        colorCodeSnapshot: '#000000',
        descriptionSnapshot: null,
      },
    ]);
    expect(
      (
        await client.query(
          'SELECT count(*)::int AS count FROM "SupplierInvoiceMigrationArchive"',
        )
      ).rows[0].count,
    ).toBe(5);
    const conflicts = (
      await client.query(
        'SELECT "itemCode", reason FROM "SupplierInvoiceMigrationConflict"',
      )
    ).rows;
    expect(conflicts).toEqual(
      expect.arrayContaining([
        { itemCode: 'CONFLICT', reason: 'Conflicting item descriptions/sizes' },
        {
          itemCode: 'CONFLICT',
          reason: 'Multiple legacy variants share one color',
        },
        { itemCode: 'EXISTING', reason: 'Conflicting item descriptions/sizes' },
      ]),
    );
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
});
