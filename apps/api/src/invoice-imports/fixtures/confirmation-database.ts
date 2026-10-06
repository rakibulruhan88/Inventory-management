import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../../generated/prisma/client.js';

// Disposable PostgreSQL schema, including real enums, indexes and foreign keys.
// Connection search_path also scopes raw confirmation locks to this schema.
export async function confirmationDatabase() {
  const schema = `confirm_test_${randomUUID().replaceAll('-', '')}`;
  const url =
    process.env.DATABASE_URL ??
    'postgresql://afia:afia_local_password@localhost:5433/afia_inventory?schema=public';
  const admin = new PrismaClient({ adapter: new PrismaPg(url) });
  const tables = [
    'User',
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
    'InvoiceImportDraft',
    'PurchaseDocument',
  ];
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  for (const table of tables)
    await admin.$executeRawUnsafe(
      `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
    );
  const enums = await admin.$queryRaw<
    { name: string; labels: string[] }[]
  >`SELECT t.typname::text AS name, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' GROUP BY t.typname`;
  for (const type of enums) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(type.name))
      throw new Error('Invalid test enum');
    await admin.$executeRawUnsafe(
      `CREATE TYPE "${schema}"."${type.name}" AS ENUM (${type.labels.map((label) => "'" + label.replaceAll("'", "''") + "'").join(',')})`,
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
  for (const column of columns.filter((c) => tables.includes(c.table_name))) {
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
  // Recreate production FKs that involve cloned tables, scoped to the test schema.
  const foreignKeys = await admin.$queryRaw<
    { table: string; definition: string; target: string; name: string }[]
  >`SELECT c.relname::text AS table, pg_get_constraintdef(f.oid)::text AS definition, r.relname::text AS target, f.conname::text AS name FROM pg_constraint f JOIN pg_class c ON c.oid = f.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_class r ON r.oid = f.confrelid WHERE f.contype = 'f' AND n.nspname = 'public'`;
  for (const fk of foreignKeys.filter(
    (f) => tables.includes(f.table) && tables.includes(f.target),
  )) {
    const definition = fk.definition.replace(
      /REFERENCES (?:public\.)?"?[A-Za-z0-9_]+"?\(/,
      `REFERENCES "${schema}"."${fk.target}"(`,
    );
    await admin.$executeRawUnsafe(
      `ALTER TABLE "${schema}"."${fk.table}" ADD CONSTRAINT "${fk.name}" ${definition}`,
    );
  }
  const scopedUrl = new URL(url);
  scopedUrl.searchParams.set('options', `-c search_path=${schema}`);
  const client = new PrismaClient({
    adapter: new PrismaPg(scopedUrl.toString(), { schema }),
  });
  return {
    client,
    schema,
    close: async () => {
      await client.$disconnect();
      await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.$disconnect();
    },
  };
}
