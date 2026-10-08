import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

it('adds a nullable unit price without changing historical amounts or snapshots', async () => {
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      'postgresql://afia:afia_local_password@localhost:5433/afia_inventory',
  });
  const connection = await pool.connect();
  const schema = `sale_price_migration_${randomUUID().replaceAll('-', '')}`;
  try {
    await connection.query(
      `CREATE SCHEMA "${schema}"; SET search_path TO "${schema}"; CREATE TABLE "SaleLine" (id text, "rollsSold" integer, "meterSold" numeric, "lineTotal" numeric, "colorCodeSnapshot" text); INSERT INTO "SaleLine" VALUES ('old',3,550,1000,'1#Black')`,
    );
    const migration = await readFile(
      new URL(
        '../../prisma/migrations/20261007030000_sale_per_roll_price/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await connection.query(migration);
    const { rows } = await connection.query('SELECT * FROM "SaleLine"');
    expect(rows).toEqual([
      {
        id: 'old',
        rollsSold: 3,
        meterSold: '550',
        lineTotal: '1000',
        colorCodeSnapshot: '1#Black',
        unitPricePerRoll: null,
      },
    ]);
  } finally {
    await connection.query(
      `SET search_path TO public; DROP SCHEMA IF EXISTS "${schema}" CASCADE`,
    );
    connection.release();
    await pool.end();
  }
});
