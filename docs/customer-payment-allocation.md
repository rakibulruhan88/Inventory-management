> Updated 2026-10-07: Opening Due and global Payments now extend this receipt system. The current rules, verification and manual checklist are in [Opening Due integration](customer-opening-due.md). Older sale-only terminology and verification counts below describe the preceding implementation.

# Customer Payment + Due Allocation — implementation report

Implemented on 7 October 2026. This feature settles a customer's existing invoice due without creating a Sale. The printable invoice, printable receipt, Activity page and customer credit remain future work.

## 1. Payment receipt schema

`CustomerPaymentReceipt` contains `id`, unique `receiptNumber`, relational `customerId`, Decimal(14,2) `totalAmount`, existing `PaymentMethod` `method`, optional `reference`/`notes`, editable `paidAt`, required relational `createdBy`, `createdAt`, unique `idempotencyKey`, canonical `requestHash`, and Decimal account snapshots `outstandingBefore`/`outstandingAfter`.

Customer and actor relations restrict deletion. One due-payment submission creates one receipt. Payments collected during Sale creation retain their existing single-invoice `Payment` representation.

## 2. Allocation schema

`CustomerPaymentAllocation` contains `id`, `receiptId`, `saleId`, Decimal(14,2) `amount`, posting-time `previousDue`/`remainingDue`, and `createdAt`. `(receiptId, saleId)` is unique. Receipt and Sale foreign keys restrict deletion. A check constraint enforces positive applied money, no over-allocation, and exact remaining due. Zero-valued manual rows are validated but do not create allocation records.

## 3. Forward migration

`apps/api/prisma/migrations/20261007040000_customer_payment_receipts/migration.sql` adds both tables, unique constraints, indexes, restricted foreign keys, money check constraints, a receipt-number sequence, nullable Sale snapshots and nullable AuditLog metadata, plus `CUSTOMER_PAYMENT_RECEIVED` in the audit enum.

Applied to the local database with `prisma migrate deploy`. No reset, legacy regrouping or historical snapshot backfill occurred. A dedicated migration test applies the actual preceding migration chain in a temporary schema, inserts legacy financial rows, and verifies the new migration preserves them.

## 4. Endpoints

All routes remain behind the existing global authentication guard and single-shop staff/owner access policy:

| Method | Route, beneath `/api` | Purpose |
| --- | --- | --- |
| GET | `/customers/:id/payment-context` | Consistent customer balance and all eligible outstanding invoices in allocation order |
| POST | `/customers/:id/payments` | Validate and atomically receive one due-payment receipt |
| GET | `/customers/:id/payment-receipts/:receiptId` | Receipt detail scoped to the routed customer ID |
| GET | `/customers/:id/account` | Paginated Sales, outstanding invoices, and combined receipt/legacy payment history |
| GET | `/customers/:id` | Compatible customer details including both receipt and legacy history |

The POST requires `amount`, `expectedOutstanding`, `paidAt`, UUID `idempotencyKey`, and `allocationMode` (`AUTO` or `MANUAL`). Existing `method` values and optional `reference`/`notes` remain. MANUAL supplies `{ saleId, amount, expectedDue }` rows. Unrecognized fields are rejected through an explicitly bound DTO, including the tsx runtime that omits decorator parameter metadata.

Cookie-authenticated submissions require `X-Afia-Payment: receive-payment`. Bearer-token clients retain their existing authentication approach. The browser payment client sends this header under the existing exact-origin CORS allowlist.

## 5. Oldest-first logic

Eligible invoices have `status = COMPLETED` and positive `totalAmount - paidAmount`. Ordering is ascending `soldAt`, then `createdAt`, then `id`. The backend uses Prisma Decimal for comparisons and allocation arithmetic. For due 5,000 + 3,000 and a payment of 6,000, the first invoice receives 5,000 and the second receives 1,000.

## 6. Manual allocation

Manual rows are checked against the transaction's eligible invoices, customer identity and current due. Duplicate invoice rows, negative/unsupported amounts, over-allocation, changed invoice balances, foreign-customer invoices, settled invoices and voided/ineligible invoices are rejected. The exact Decimal sum must equal receipt total.

## 7. Invoice and customer balances

Invoice Total remains unchanged. The existing authoritative `Sale.paidAmount` increases by that Sale's allocation. Invoice Due is Total minus Paid; Customer Outstanding is derived from completed invoice balances. There is no editable `Customer.balance`, new Sale for payment-only activity, or customer credit.

The receipt architecture stores new due-payment allocations directly, without also creating duplicate split `Payment` rows. Existing summary/report calculations continue reading Sale balances. Account and customer-details histories use consistent read transactions.

## 8. Receipt numbering

The database sequence `customer_payment_receipt_sequence` supplies a unique, concurrency-safe suffix. Numbers are `PAY-YYYYMMDD-NNNNNN`, with the issue day in Asia/Dhaka. The suffix is global and may grow beyond six digits. Gaps following rolled-back transactions are intentional. `receiptNumber` is also protected by a database unique constraint.

## 9. Atomicity, concurrency and idempotency

Receipt confirmation runs in one PostgreSQL Read Committed transaction:

1. Lock/version-write the customer row; reload customer and check archived status.
2. Return an existing identical idempotent receipt, or reject reuse with another customer, actor or payload.
3. Reload completed invoices and recompute current due.
4. Validate amount, expected account balance and allocation plan.
5. Create receipt, conditionally increment each Sale paid amount, and create allocations.
6. Create AuditLog and return receipt detail.

Conditional Sale updates also compare original paid/total/status/customer values. Any failure rolls back all financial writes. Sale creation, Sale void and customer archive share the customer-account lock. The no-op row version write makes an older Serializable Sale transaction retry after a concurrent payment, preserving truthful Sale snapshots.

Write conflicts and uniqueness races have bounded retries. Both Prisma `P2034` and PostgreSQL serialization/deadlock errors surfaced through raw-query `P2010` are handled. Exhausted conflicts and database failures produce safe messages.

A globally unique UUID plus SHA-256 hash of normalized customer/actor/payload makes duplicate submissions idempotent. The frontend holds the exact pending submission in session storage and retries it unchanged after connection failures or reloads. It freezes the reviewed account context, disables duplicate confirmation, and refreshes after definitive validation/stale-balance rejection.

## 10. Customer Account UI

Account summary and invoice histories remain. Receive Payment appears for positive due and is disabled at zero outstanding. A dedicated page provides amount, payment date, automatic/manual allocation, existing payment methods, optional reference/note, and a separate explicit confirmation step. Success offers View Receipt, Back to Customer and Receive Another Payment.

Payment history merges receipts and legacy rows with deterministic pagination. Receipt rows show number, amount, date, method, reference/note, and allocation details. Desktop uses compact ledger rows; mobile stacks rows and fields. Loading, empty, validation, failure, pending retry, disabled and keyboard-focus states are included. Browser/visual testing is reserved for the owner.

## 11. Sale payment history

Sale detail exposes each receipt's allocation to that Sale, with payment date, receipt number, amount and a link to receipt detail. A shared receipt's entire total is never displayed as the payment to each Sale. Existing Sale-payment/legacy rows remain. Sales ledger method/reference searches and the older Sales search also include receipt data.

The new on-screen payment region sits outside the printable invoice. The printable layout was not redesigned.

## 12. Sale historical snapshots

New Sales write authoritative nullable `previousOutstandingBeforeSale` and `outstandingAfterSale` inside the Sale transaction. The latter equals prior outstanding plus the current Sale's initial due. A prior 10,000 balance, Sale Total 15,000 and received/applied 5,000 yield snapshots 10,000 and 20,000; Sale Total stays 15,000.

Later payments leave these fields unchanged. Original received/change/total fields retain the information needed to derive initial Sale paid/due. Legacy Sales remain readable with null snapshots. New Sale now refreshes the selected customer's account context and adds an outstanding-after preview without redesigning its worksheet.

## 13. AuditLog

`CUSTOMER_PAYMENT_RECEIVED` records the existing actor relation, receipt entity, optional reason, creation timestamp and JSON metadata: `customerId`, `receiptId`, exact decimal `totalAmount`, affected `saleIds` and `paidAt`. Receipt/allocations/audit commit together. Idempotent replays do not add audit events.

## 14. Legacy history

No legacy payment rows are changed or guessed into groups. History labels them ungrouped and shows known invoice links. No fake receipt numbers or fabricated prior-outstanding values are generated. Historical customer relations remain ID-based when names or phone numbers change.

## 15. Void and reversal limitations

A Sale with any receipt allocation history is blocked from voiding on the backend; its UI explains and disables the action. A payment-versus-void race either saves the receipt and blocks void, or voids first and rejects the payment. Financial history is never silently deleted.

Legacy-only Sale void continues restoring stock and voiding its old `Payment` rows. Receipt reversal/deletion has no endpoint; safe receipt reversal will be a dedicated future task.

Payment Date is editable and defaults to the current Dhaka business date. Balance snapshots describe posting-time balances. Entering an earlier Payment Date does not reconstruct historical balances for that date.

## 16. Tests and verification

The feature adds 69 tests: 57 PostgreSQL accounting/security tests, one forward migration preservation test, and 11 frontend allocation/input tests. Regression fixtures were extended to include the new receipt tables. Existing legacy-only void coverage remains.

Coverage includes automatic/manual allocation, exact/partial/full settlement, unchanged totals, derived outstanding, deterministic ordering, overpayment, mixed legacy/receipt history, authorization, cookie submission protection, wrong-customer allocations/receipt routes, unknown fields, amount tampering, decimal precision, idempotency, simultaneous payments, receipt-number races, Sale-versus-payment/void races, forced mid-transaction audit failure, phone changes, immutable snapshots, audit metadata and receipt ledger searches.

Final verification passed:

| Check | Result |
| --- | --- |
| `npm run typecheck` | API, web and shared contracts passed |
| `npm run test` | 613 tests passed: 558 API + 55 web, across 35 test files |
| `npm run build` | Passed for the configured workspace builds |
| `git diff --check` | Passed |
| `git diff --name-only` | Reviewed; backend, Prisma and contracts changed as authorized, alongside preserved prior work |
| Prisma validate | Valid schema |
| Prisma migration status | All 17 local migrations applied; database is up to date |
| Prisma schema diff | No difference between local database and Prisma schema |

The existing PostgreSQL test runner reports a `pg` client-query deprecation warning; all tests pass. No dependency upgrade was made. Browser automation was not used.

## 17. Files changed for this feature

Existing uncommitted phone-identity and per-roll Sale work was preserved. The following list identifies files touched by this feature, rather than attributing every current Git change to it.

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20261007040000_customer_payment_receipts/migration.sql`
- `apps/api/src/customers/customers.controller.ts`
- `apps/api/src/customers/customers.service.ts`
- `apps/api/src/customers/payment.dto.ts`
- `apps/api/src/customers/payment-accounting.ts`
- `apps/api/src/customers/payment-receipts.ts`
- `apps/api/src/customers/payment-receipts.database.spec.ts`
- `apps/api/src/customers/payment-receipts-migration.spec.ts`
- `apps/api/src/customers/customer-identity.database.spec.ts`
- `apps/api/src/inventory-rules.spec.ts`
- `apps/api/src/sales/sales.service.ts`
- `apps/api/src/sales/sales-ledger.ts`
- `apps/api/src/sales/sales-ledger.database.spec.ts`
- `apps/api/src/sales/ledger-access.spec.ts`
- `apps/api/src/sales/per-roll-sales.database.spec.ts`
- `packages/contracts/src/index.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/lib/api.ts`
- `apps/web/src/features/records/records-pages.tsx`
- `apps/web/src/features/records/customer-account-page.tsx`
- `apps/web/src/features/records/payment-allocation.ts`
- `apps/web/src/features/records/payment-allocation.spec.ts`
- `apps/web/src/features/records/payment-components.tsx`
- `apps/web/src/features/records/receive-payment-page.tsx`
- `apps/web/src/features/records/payment-receipt-page.tsx`
- `apps/web/src/features/sales/new-sale-page.tsx`
- `apps/web/src/features/sales/sale-invoice-page.tsx`
- `docs/locked-requirements.md`
- `docs/customer-payment-allocation.md`
- `docs/customer-payment-security-review.md`

Backend, Prisma and shared contract files changed under the feature's explicit authorization. No dependencies were added/upgraded by this task. No commit or push was made.

## 18. Manual browser checklist

- [ ] Open a Customer Account with due on multiple invoices. Verify totals and Receive Payment.
- [ ] With invoice due 5,000 + 3,000, pay 6,000 automatically. Review 5,000 + 1,000, confirm once, and verify remaining due 2,000 and one receipt.
- [ ] Use manual allocation to split a payment deliberately. Check sum-under, sum-over, negative/invalid decimal and per-invoice over-allocation feedback.
- [ ] Try an amount above outstanding. Review must stay disabled; server submission must also reject it.
- [ ] Verify Cash, Bank, Mobile Banking and Other; optional reference/note and edited Payment Date. Receipt should retain them.
- [ ] Open receipt detail and each linked invoice. Check previous due, paid now and remaining due snapshots; Sale detail must show only its allocation.
- [ ] Pay the exact final outstanding. Customer Account and the payment page should show no outstanding and disable another payment.
- [ ] Confirm that legacy ungrouped history and known invoice links remain without invented receipt numbers.
- [ ] Change the customer's phone. Customer Account/receipt history should stay attached to the same customer, and historical Sale customer snapshots should remain unchanged.
- [ ] Check New Sale's prior outstanding and after-Sale preview. Complete a Sale and verify old debt does not increase Sale Total; later payments must not change Sale account snapshots.
- [ ] Try voiding a Sale with receipt history; it must be blocked. Verify a legacy-only Sale still follows the existing stock/payment reversal behavior.
- [ ] In two tabs, review payments against the same balance. After one succeeds, the stale tab must request review with refreshed balances.
- [ ] Simulate a connection failure during confirmation, then retry/reload. Resolve the pending submission with Retry Same Payment; verify one receipt only.
- [ ] Check mobile allocation rows, long names/references, keyboard labels/focus, confirmation focus, loading/error recovery and all success actions.
