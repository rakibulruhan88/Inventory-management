import { config } from 'dotenv';
import { Pool } from 'pg';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  auditCustomerPhones,
  type CustomerPhoneAuditRecord,
} from '../src/customers/customer-phone-audit.js';
const root = new URL('../../../', import.meta.url);
config({ path: fileURLToPath(new URL('.env', root)), quiet: true });
const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    'postgresql://afia:afia_local_password@localhost:5433/afia_inventory',
});
try {
  // All records, including archived customers. Audit never writes to the database.
  const { rows } = await pool.query<CustomerPhoneAuditRecord>(
    `SELECT c.id,c.name,c.phone,c."archivedAt",(SELECT count(*)::int FROM "Sale" s WHERE s."customerId"=c.id) AS "salesCount",(SELECT count(*)::int FROM "Payment" p WHERE p."customerId"=c.id) AS "paymentCount",(SELECT COALESCE(sum(s."totalAmount"-s."paidAmount"),0)::text FROM "Sale" s WHERE s."customerId"=c.id AND s.status='COMPLETED') AS outstanding FROM "Customer" c ORDER BY c.name,c.id`,
  );
  const audit = auditCustomerPhones(rows);
  const timestamp = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Asia/Dhaka',
  }).format(new Date());
  const report = [
    `# Customer phone migration audit`,
    '',
    `Audited ${timestamp} (Asia/Dhaka). Includes active and archived customers.`,
    '',
    `- Customers: ${audit.total}`,
    `- Valid unique phones: ${audit.validUnique.length}`,
    `- Blank/null phones: ${audit.blank.length}`,
    `- Invalid phones: ${audit.invalid.length}`,
    `- Duplicate normalized phone groups: ${audit.duplicates.length}`,
    '',
    'Canonical format: `8801XXXXXXXXX` (Bangladesh mobile prefixes 013–019). Phone remains optional. Invalid historical phones remain unchanged with null normalized identity. No customer IDs, Sales, Payments, balances, or audit histories are merged or transferred.',
    '',
    '## Owner review',
    '',
  ];
  const review = [
    ...audit.invalid,
    ...audit.duplicates.flatMap((d) => d.customers),
  ];
  if (!review.length)
    report.push(
      'No records require manual correction or duplicate ownership decisions.',
    );
  else {
    report.push(
      '| ID | Customer | Original phone | Normalized phone | Issue | Sales | Payments | Outstanding |',
      '|---|---|---|---|---|---:|---:|---:|',
    );
    for (const r of review)
      report.push(
        `| ${[r.id, r.name, r.phone ?? '—', r.normalizedPhone ?? '—', r.category, r.salesCount, r.paymentCount, r.outstanding].map((v) => String(v).replaceAll('|', '\\|').replaceAll('\n', ' ')).join(' | ')} |`,
      );
  }
  report.push(
    '',
    audit.duplicates.length
      ? '**Migration blocked. Owner decisions are required before applying uniqueness. No database writes performed.**'
      : 'No normalized duplicate conflicts were found. The forward migration can backfill the valid unique records and enforce uniqueness; it independently rechecks duplicates under a table lock.',
    '',
    'Customer phone edits currently have no dedicated AuditLog action. Existing audit behavior is preserved.',
    '',
  );
  await writeFile(
    new URL('docs/customer-phone-audit.md', root),
    report.join('\n'),
  );
  console.log(
    `Customer phone audit: ${audit.total} customers; ${audit.validUnique.length} unique valid, ${audit.blank.length} blank, ${audit.invalid.length} invalid, ${audit.duplicates.length} duplicate groups. Report: docs/customer-phone-audit.md`,
  );
  if (audit.duplicates.length) process.exitCode = 1;
} finally {
  await pool.end();
}
