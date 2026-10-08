import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { Pool } from 'pg';
describe('Opening Due forward migration', () => {
  it('preserves all existing customer, sale, legacy payment and multi-sale receipt data', async () => {
    const schema = `opening_migration_${randomUUID().replaceAll('-', '')}`;
    const pool = new Pool({
      connectionString:
        process.env.DATABASE_URL ??
        'postgresql://afia:afia_local_password@localhost:5433/afia_inventory',
    });
    const c = await pool.connect();
    try {
      await c.query(
        `CREATE SCHEMA "${schema}"; SET search_path TO "${schema}"`,
      );
      const root = new URL('../../prisma/migrations/', import.meta.url),
        target = '20261007050000_customer_opening_due';
      for (const folder of readdirSync(root)
        .sort()
        .filter((f) => !f.endsWith('.toml') && f < target))
        await c.query(
          readFileSync(new URL(`${folder}/migration.sql`, root), 'utf8'),
        );
      await c.query(`INSERT INTO "User" (id,name,"passwordHash","updatedAt") VALUES ('u','Staff','test',now());
    INSERT INTO "Customer" (id,name,"updatedAt") VALUES ('c','Customer',now());
    INSERT INTO "Sale" (id,"invoiceNumber","customerId","totalAmount","paidAmount","previousOutstandingBeforeSale","outstandingAfterSale","updatedAt") VALUES ('s1','AF-1','c',1000,500,42,1042,now()),('s2','AF-2','c',1000,100,NULL,NULL,now());
    INSERT INTO "Payment" (id,"customerId","saleId",amount,method) VALUES ('p','c','s1',100,'CASH');
    INSERT INTO "CustomerPaymentReceipt" (id,"receiptNumber","customerId","totalAmount",method,"paidAt","createdBy","idempotencyKey","requestHash","outstandingBefore","outstandingAfter") VALUES ('r','PAY-OLD','c',500,'CASH',now(),'u','key','hash',2000,1500);
    INSERT INTO "CustomerPaymentAllocation" (id,"receiptId","saleId",amount,"previousDue","remainingDue") VALUES ('a1','r','s1',400,900,500),('a2','r','s2',100,1000,900);`);
      const tables = [
        'Customer',
        'Sale',
        'Payment',
        'CustomerPaymentReceipt',
        'CustomerPaymentAllocation',
      ];
      const before = new Map<string, unknown[]>();
      for (const table of tables)
        before.set(
          table,
          (await c.query(`SELECT * FROM "${table}" ORDER BY id`)).rows,
        );
      await c.query(
        readFileSync(new URL(`${target}/migration.sql`, root), 'utf8'),
      );
      for (const table of tables) {
        const rows = (await c.query(`SELECT * FROM "${table}" ORDER BY id`))
          .rows;
        if (table === 'CustomerPaymentAllocation')
          for (const row of rows) {
            expect(row.openingBalanceId).toBeNull();
            delete row.openingBalanceId;
          }
        expect(rows).toEqual(before.get(table));
      }
      expect(
        (
          await c.query(
            'SELECT COUNT(*)::int AS n FROM "CustomerOpeningBalance"',
          )
        ).rows[0].n,
      ).toBe(0);
    } finally {
      await c.query(
        `SET search_path TO public; DROP SCHEMA IF EXISTS "${schema}" CASCADE`,
      );
      c.release();
      await pool.end();
    }
  }, 30000);
});
