# Customer phone migration audit

Audited 7 October 2026 at 03:34 (Asia/Dhaka). Includes active and archived customers.

- Customers: 7
- Valid unique phones: 6
- Blank/null phones: 0
- Invalid phones: 1
- Duplicate normalized phone groups: 0

Canonical format: `8801XXXXXXXXX` (Bangladesh mobile prefixes 013–019). Phone remains optional. Invalid historical phones remain unchanged with null normalized identity. No customer IDs, Sales, Payments, balances, or audit histories are merged or transferred.

## Owner review

| ID | Customer | Original phone | Normalized phone | Issue | Sales | Payments | Outstanding |
|---|---|---|---|---|---:|---:|---:|
| cmu79qaku000f5exit1l2tvw5 | mamun | 013243558345 | — | invalid | 2 | 2 | 4500.00 |

No normalized duplicate conflicts were found. The forward migration can backfill the valid unique records and enforce uniqueness; it independently rechecks duplicates under a table lock.

Customer phone edits currently have no dedicated AuditLog action. Existing audit behavior is preserved.

## Local migration result

The forward migration `20261007020000_customer_phone_identity` was applied safely after the audit. Six valid phones were backfilled; the invalid phone was preserved with null normalized identity. The unique index is active. Before/after checksums verified all original customer fields and every Sale, Payment, AuditLog, inventory batch, and stock movement were unchanged.
