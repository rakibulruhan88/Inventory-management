import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool, type PoolClient } from 'pg';
import { normalizeCustomerPhone } from '@afia/contracts';

const migration = await readFile(
  new URL(
    '../../prisma/migrations/20261007020000_customer_phone_identity/migration.sql',
    import.meta.url,
  ),
  'utf8',
);
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://afia:afia_local_password@localhost:5433/afia_inventory',
});
let client: PoolClient;
let schema: string;
beforeEach(async () => {
  client = await pool.connect();
  schema = `phone_migration_${randomUUID().replaceAll('-', '')}`;
  await client.query(
    `CREATE SCHEMA "${schema}"; SET search_path TO "${schema}"; CREATE TABLE "Customer" (id text PRIMARY KEY,name text,phone text); CREATE TABLE "Sale" (id text,"customerId" text); CREATE TABLE "Payment" (id text,"customerId" text);`,
  );
});
afterEach(async () => {
  await client.query('ROLLBACK');
  await client.query(
    `SET search_path TO public; DROP SCHEMA "${schema}" CASCADE`,
  );
  client.release();
});
afterAll(async () => pool.end());
it('backfills using shared normalization parity, preserving every display phone and invalid record', async () => {
  const phones = [
    '01712-345678',
    '01822 222222',
    '+8801912345678',
    '8801612345678',
    '+880 1512 345678',
    '+880 (1412) 345678',
    '\t01312345678\v',
    '013243558345',
    null,
    '',
    '  ',
    'abc01712345678',
    '01712--345678',
    '+01712345678',
    '01012345678',
    '(01712345678',
    'v01712345678',
    '\u00a001712345678',
  ];
  for (let i = 0; i < phones.length; i++)
    await client.query('INSERT INTO "Customer" VALUES ($1,$1,$2)', [
      String(i),
      phones[i],
    ]);
  await client.query(
    "INSERT INTO \"Sale\" VALUES ('sale','0'); INSERT INTO \"Payment\" VALUES ('payment','0')",
  );
  await client.query(migration);
  const rows = (
    await client.query(
      'SELECT id,phone,"normalizedPhone" FROM "Customer" ORDER BY id::int',
    )
  ).rows;
  for (let i = 0; i < phones.length; i++) {
    let normalized = null;
    try {
      normalized = normalizeCustomerPhone(phones[i]);
    } catch {
      /* invalid must remain null */
    }
    expect(rows[i]).toEqual({
      id: String(i),
      phone: phones[i],
      normalizedPhone: normalized,
    });
  }
  expect((await client.query('SELECT * FROM "Sale"')).rows).toEqual([
    { id: 'sale', customerId: '0' },
  ]);
  expect((await client.query('SELECT * FROM "Payment"')).rows).toEqual([
    { id: 'payment', customerId: '0' },
  ]);
  await expect(
    client.query(
      'INSERT INTO "Customer" (id, "normalizedPhone") VALUES (\'duplicate\',\'8801712345678\')',
    ),
  ).rejects.toMatchObject({ code: '23505' });
  await client.query(
    "INSERT INTO \"Customer\" (id) VALUES ('blank1'),('blank2')",
  );
});
it('blocks duplicate normalized phones atomically without choosing an owner or changing relationships', async () => {
  await client.query(
    `INSERT INTO "Customer" VALUES ('a','Rahim','01712-345678'),('b','Rahim Store','+8801712345678'); INSERT INTO "Sale" VALUES ('sale-a','a'),('sale-b','b'); INSERT INTO "Payment" VALUES ('payment-a','a'),('payment-b','b');`,
  );
  await expect(client.query(migration)).rejects.toThrow(
    'duplicate normalized phones',
  );
  await client.query('ROLLBACK');
  expect(
    (await client.query('SELECT * FROM "Customer" ORDER BY id')).rows,
  ).toEqual([
    { id: 'a', name: 'Rahim', phone: '01712-345678' },
    { id: 'b', name: 'Rahim Store', phone: '+8801712345678' },
  ]);
  expect((await client.query('SELECT * FROM "Sale" ORDER BY id')).rows).toEqual(
    [
      { id: 'sale-a', customerId: 'a' },
      { id: 'sale-b', customerId: 'b' },
    ],
  );
  expect(
    (await client.query('SELECT count(*)::int AS count FROM "Payment"')).rows[0]
      .count,
  ).toBe(2);
});
