# Customer payment feature security review

Review scope: Customer Payment + Due Allocation changes, including API validation, receipt reads, allocation writes, Sale snapshot/void integration, migration and frontend submission behavior. This is a focused feature review; existing authentication and access policy are preserved.

No unresolved concrete security finding was identified within the reviewed feature and tested paths. Browser/visual verification remains manual.

| Concern | Control and evidence |
| --- | --- |
| Authorization | Existing global AuthGuard protects receipt/context/payment routes; unauthenticated requests return 401. Current single-shop STAFF/OWNER permissions are retained. |
| IDOR / allocation ownership | Receipt detail requires both routed customer ID and receipt ID. Allocation planning uses only completed Sales for the routed customer. Wrong-customer invoice allocations and receipt routes are tested. |
| Actor spoofing and mass assignment | Actor comes from CurrentUser, never request body. Explicit PaymentDto rejects unknown customerId, createdBy, receiptNumber and malformed nested rows, including runtimes without design metadata. |
| Cookie-authenticated payment submission | A non-simple `X-Afia-Payment` header is mandatory for cookie-authenticated payment POSTs, supported by existing exact-origin CORS settings. HTML forms cannot supply the header. Cookie requests without it return 403; proper signed-in requests succeed. Bearer authentication retains its existing behavior. |
| Amount and allocation tampering | Backend validates positive receipt total, no customer overpayment, nonnegative per-invoice allocations, eligibility, due ceiling, exact sum and stale account/invoice balances. |
| Decimal precision | Prisma Decimal does authoritative arithmetic; two-decimal finite amounts are enforced by DTO and service boundary. Frontend previews use integer cents. Database checks enforce allocation and receipt arithmetic. |
| Concurrency | Shared customer-account row lock/version fence, fresh transaction reads and conditional paidAmount increments prevent stale writes. Sale creation retries standard and raw PostgreSQL serialization conflicts. Concurrent payment/Sale/void tests verify balances. |
| Idempotency | Unique UUID submission key plus customer/actor/canonical-payload hash. Identical simultaneous/retried requests return one receipt with one audit; changed payload/actor reuse is rejected. |
| Atomicity | Receipt, allocations, invoice balances and audit are one PostgreSQL transaction. A forced audit trigger failure confirms complete rollback. |
| SQL injection | New production raw queries use Prisma tagged parameters. Dynamic identifiers exist only in generated temporary test schemas, never from request input. |
| Error leakage | Expected errors are safe Nest exceptions; unknown receipt-write failures produce a generic safe 503. Tests verify UI-facing responses contain no Prisma/SQL details. |
| Financial history integrity | Restricted foreign keys and blocked Sale void preserve receipt allocations. No payment receipt delete/reversal route exists. Legacy grouping is never guessed. |
| Frontend rendering and retries | React text rendering, visible labels and existing UI primitives; no new raw HTML sink. Confirmation freezes the reviewed context. Exact pending payload is retained for safe retry after uncertain connection outcomes. |

Key implementation: `apps/api/src/customers/payment.dto.ts`, `payment-accounting.ts`, `payment-receipts.ts`, `customers.controller.ts`, and `apps/api/src/sales/sales.service.ts`. Tests: `payment-receipts.database.spec.ts` and `payment-receipts-migration.spec.ts`. Frontend: `receive-payment-page.tsx`, `payment-components.tsx`, `payment-allocation.ts`.

Prisma's [official transaction documentation](https://docs.prisma.io/docs/orm/v7/prisma-client/queries/transactions) describes serializable transaction conflicts, retries and idempotent API design. The additional raw-query PostgreSQL conflict case was found and verified by this project's actual concurrent database test.

Operational limitations: receipt reversal is future work; Sales with receipt allocations cannot be voided. Backdated paidAt is a payment-date label, while allocation balances are posting-time snapshots. These limitations are documented in the locked business requirements and feature report.

## Opening Due and global Payments extension (2026-10-07)

The focused extension review found no unresolved concrete security finding in the implemented/tested feature paths. The existing single-shop STAFF/OWNER guard remains the authorization boundary; no new role or account tenancy policy was invented.

- **Financial history and ownership:** immutable opening event, unique customer/key, positive database amount check and exactly-one-source allocation check. The migration trigger checks receipt/source customer identity and locks the opening record before testing its payment ceiling. Manual source IDs are matched only against the routed customer's current sources in `payment-accounting.ts:80`. A wrong-customer opening or mismatched receipt route is rejected (`payment-receipts.ts:68`). No edit/delete route is present.
- **Atomic customer identity:** normalized-phone uniqueness is preserved. Customer creation, Opening Due and its audit commit together. The per-key advisory lock precedes identity creation (`opening-due.ts:68`), while the existing shared account row lock protects final customer state and account writers. Concurrent retry tests include Customers both with and without a phone. Wrong payload/actor/customer key reuse is rejected.
- **Money and stale previews:** decimal-based plan uses authoritative combined due sources, not client Total Due. Positive finite two-decimal amounts, per-source ceilings and exact receipt sums remain enforced. Two concurrent opening payments cannot produce a negative due. Mixed-payment and opening-event forced audit failures verify rollback, including a newly created Customer.
- **HTTP boundary:** both opening write routes require CurrentUser and the same custom header protection as receipt writes (`customers.controller.ts:89`, `:111`); DTOs reject extra actor/customer/originalAmount fields and malformed nested payloads. Unknown database exceptions become safe 503 text. Explicit validation pipes work with the existing tsx metadata behavior.
- **Global reads:** existing AuthGuard protects both Payments APIs. Bounded server pagination and fixed stable order are enforced before queries. SQL values are parameterized; percent/underscore searches are escaped as literal text consistently. Due aggregation and batched receipt/customer reads avoid per-row queries. Receipt detail still scopes both Customer ID and Receipt ID. Opening-only customers have no fabricated Sale link in React output.
- **Scope limits:** corrections and payment reversal require future audited workflows; opening/source immutability is enforced by exposed application routes, with no general database-administrator edit restriction claimed. Browser/visual tests remain manual. No Activity, Cashbook, credit or printable-document feature was added.

Verification is recorded in [Opening Due report](customer-opening-due.md), including migration preservation, authentication/CSRF/tampering and concurrency tests.
