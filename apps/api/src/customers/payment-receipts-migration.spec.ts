import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { Pool } from 'pg';

describe('forward receipt migration preserves legacy financial history', () => {
  it('keeps old Sales, Payments and AuditLog rows unchanged with null historical snapshots', async () => {
    const schema = `receipt_migration_${randomUUID().replaceAll('-', '')}`;
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
      const root = new URL('../../prisma/migrations/', import.meta.url);
      const target = '20261007040000_customer_payment_receipts';
      for (const folder of readdirSync(root)
        .sort()
        .filter((f) => !f.endsWith('.toml') && f < target))
        await c.query(
          readFileSync(new URL(`${folder}/migration.sql`, root), 'utf8'),
        );
      await c.query(`INSERT INTO "Customer" (id,name,"updatedAt") VALUES ('c','Legacy',now());
        INSERT INTO "Sale" (id,"invoiceNumber","customerId",status,"totalAmount","paidAmount","updatedAt") VALUES ('s','OLD-1','c','COMPLETED',8000,3000,now());
        INSERT INTO "Payment" (id,"customerId","saleId",amount,method) VALUES ('p1','c','s',1000,'CASH'),('p2','c','s',2000,'BANK');
        INSERT INTO "AuditLog" (id,action,"entityType","entityId") VALUES ('a','PAYMENT_RECEIVED','Customer','c');`);
      const before = (await c.query('SELECT * FROM "Payment" ORDER BY id'))
        .rows;
      await c.query(
        readFileSync(new URL(`${target}/migration.sql`, root), 'utf8'),
      );
      expect(
        (await c.query('SELECT * FROM "Payment" ORDER BY id')).rows,
      ).toEqual(before);
      expect(
        (
          await c.query(
            'SELECT "totalAmount","paidAmount","previousOutstandingBeforeSale","outstandingAfterSale" FROM "Sale"',
          )
        ).rows[0],
      ).toEqual({
        totalAmount: '8000.00',
        paidAmount: '3000.00',
        previousOutstandingBeforeSale: null,
        outstandingAfterSale: null,
      });
      expect(
        (
          await c.query(
            'SELECT COUNT(*)::int AS n FROM "CustomerPaymentReceipt"',
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (await c.query('SELECT id,action,metadata FROM "AuditLog"')).rows[0],
      ).toEqual({ id: 'a', action: 'PAYMENT_RECEIVED', metadata: null });
    } finally {
      await c.query(
        `SET search_path TO public; DROP SCHEMA IF EXISTS "${schema}" CASCADE`,
      );
      c.release();
      await pool.end();
    }
  }, 30000);
});
