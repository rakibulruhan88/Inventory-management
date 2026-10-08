# Opening Due and global Payments — implementation report

Opening Due is historical money owed to Afia Leather. It is a normal Customer account event, never a Sale or invoice. Collecting it is money received, not current revenue. Staff can add a customer and old due together, then continue directly to Receive Payment. Existing customers can use Add Old Due.

## 20-point report

1. **Model.** `CustomerOpeningBalance` stores Customer ID, original positive amount, Balance Date (`DATE`), note, actor, creation time, unique submission key and request hash. Remaining due comes from receipt allocations; no editable Customer.balance or separate opening paid-total field was added.
2. **Migration.** Two reviewed forward migrations add the model, nullable sale/opening source references, ownership/source/amount constraints and a global receipt-order index. They were applied locally without a reset. Before/after fingerprints preserved all existing customers, Sales, legacy Payments, Receipts and allocations; allocation rows gained only a null opening reference. The isolated migration regression also preserves nullable historical Sale snapshots.
3. **Duplicate/correction rule.** One initial Opening Due per Customer, even once fully paid. Exact retries return the existing event; changed details/key reuse fail. No edit/delete/correction endpoint is exposed. A future correction must explicitly audit and reverse history, rather than rewriting this record or posting a second initial balance.
4. **Total Due.** Shared `accountSourcesSql` combines completed Sales minus Sale.paidAmount with opening originalAmount minus its allocations. Accounts, bounded customer search, payment eligibility, global due lists, dashboard due and new-sale snapshots use this calculation. Account Payments Received combines applied Sale payments and opening payments; Opening Due does not inflate Sales.
5. **Payment architecture.** Existing receipts remain the sole due-payment system. Every allocation identifies exactly one Sale or Opening Due, and must belong to the receipt customer. One payment produces one receipt, including mixed payments.
6. **Oldest first.** Sources are ordered by soldAt / Balance Date, then creation time, ID and source kind. The staff label is Pay Old Due First. An invoice older than the Balance Date is paid first; the label does not override chronological order.
7. **Choose Invoices.** Staff may select Opening Due and/or invoices, skip sources, or split payment. Pay Now cannot exceed a source’s due; expected source/account balances must still match; the sum must equal the receipt amount. The backend validates independently using decimal arithmetic.
8. **Customer flow.** Payments → Receive Payment → search → Add Customer → name/contact/Opening Due/Balance Date/note → Save & Continue. Customer plus opening event is atomic and uses existing phone normalization/uniqueness. The following receipt is a separate atomic event. Existing Customer Account offers Add Old Due when no initial record exists. Search results without due open Add Old Due. Phone conflicts link to the existing account.
9. **Customer Account.** Compact summary shows original Opening Due, Sales, Payments Received and Total Due. An opening history section records its date, amount, payments, due left and note; existing paginated Sales/Invoice Due/Payment History remain available. Fully paid opening history stays visible.
10. **Global APIs.** Authenticated GET `/payments/outstanding-customers` and `/payments/receipts` accept page (1–1,000,000), pageSize (1–100, default 25), search (up to 200). Due query aggregates sources in SQL, identifies the oldest due and last completed sale, then paginates by due descending/name/ID. Receipt query paginates receipt rows by payment date/creation date descending/ID ascending, with batched customer data. No per-row reads or client-side pagination. Both read consistent database snapshots.
11. **Payments page.** Customers With Due includes opening-only, sale-only and mixed customers, shows an authoritative matching Total Due, oldest due and Receive Payment action. Receipts shows one row per receipt. Search supports customer/phone and receipt number where relevant, including normalized international phone lookup and literal wildcard characters. Legacy/at-sale Payment rows remain in Customer History, with no fabricated global receipt identity.
12. **Receipt detail.** Paid Against lists Opening Due without an invented invoice number/link, and real invoice links for Sale payments. Due Before, Paid Now, Due Left and whole-account Due After Payment retain posting-time snapshots. History remains one receipt per payment.
13. **New Sale snapshot.** Previous Due includes remaining opening and completed Sale dues before inserting the new Sale. Current invoice total and stock calculations remain independent. Old null snapshots are untouched; later payments do not rewrite new snapshots.
14. **AuditLog.** Opening creation records CUSTOMER_OPENING_BALANCE_CREATED with actor/customer/opening ID/amount/Balance Date/time. CUSTOMER_PAYMENT_RECEIVED identifies opening IDs, Sale IDs, receipt total, payment date, actor and posting time. Audit failure rolls back the entire business event.
15. **Sales reports.** Opening debt and collection create no Sales, SaleLines, invoices or stock movements. Sales ledger/report totals remain Sale-based; today's sales remain unchanged by old-due collection. Dashboard Customer Due includes opening due.
16. **Concurrency and retries.** Account writers share the existing customer row lock, including payments, Sales, archive and opening creation. Opening submissions take a per-key transaction advisory lock before creating an identity, so simultaneous identical new-customer requests (including optional phone) cannot create two Customers. Final due is reread inside the transaction; duplicate-key conflicts/deadlocks retry safely. Decimal validation, unique keys, source checks and opening-overpayment trigger prevent invalid posting. Pending frontend requests retain the exact payload/key across uncertain failures and reloads.
17. **Simple English.** Added/changed labels use Opening Due, Add Old Due, Balance Date, Total Due, Previous Due, Pay Now, Due After Payment, Pay Against, Paid Against, Pay Old Due First, Choose Invoices, Receive Payment and Payment History. Internal accounting terminology stays out of normal controls and safe error messages. Existing theme and compact mobile ledger layouts are retained.
18. **Verification.** Final results are recorded below. Tests cover opening creation/validation/identity, combined account totals, partial/full/mixed payments, chronology/manual choices, stale and concurrent submissions, exact retries, audit rollback, source ownership, HTTP authentication/CSRF/tampering, paginated search, migration preservation, Sale detail/report/stock/void regressions and UI rendering without browser automation.
19. **Files.** Backend and shared contracts changed under the explicit authorization. This extension touches schema plus the two new migrations; customer service/controller/module/payment DTO and accounting helpers; new opening DTO/service, balance and global ledger helpers/controllers; Sale snapshot and inventory summary calculations; relevant database/HTTP tests and their isolated-schema fixtures; shared contracts; frontend routes/API helpers, Payments/Add Old Due/search/receipt/account/payment pages and simple Sale/customer labels; locked requirements and payment/security documentation. Earlier uncommitted customer-identity, pricing and redesign work was preserved. No dependency upgrade, commit or push.
20. **Manual checklist.** Use the cases below for browser/visual review. Browser automation was not launched. Cashbook, Activity, printable invoice/receipt redesign and customer credit remain outside this completed feature.

## Verification results

- `npm run typecheck`: passed for API, web and contracts.
- `npm run test`: **697 passed** across 38 test files: API **621** (32 files), web **76** (6 files). This extension adds 63 API and 6 frontend tests compared with the preceding global Payments draft.
- `npm run build`: passed for API and production web/PWA output.
- Prisma validate: valid schema. Migration status: **19 migrations, up to date**, including the two new forward migrations. Schema diff: **empty migration**. Custom CHECK constraints/triggers are reviewed in SQL and exercised by the real migration-chain tests; Prisma schema diff does not describe those protections.
- `git diff --check`: passed. `git diff --name-only` reviewed: backend and contracts are changed with explicit authorization; earlier uncommitted work remains present.
- Local migration preservation fingerprints: **8 Customers, 17 Sales, 14 legacy Payments, 2 Receipts and 4 allocation rows** unchanged, apart from the new null opening reference on existing allocations. The second migration only adds an index.
- No browser automation, commit or push. Visual/interaction testing remains the user's manual step.

## Manual browser checklist

Use disposable local test customers. Opening Due is immutable in this stage; review the amount and date before saving.

- [ ] Desktop and mobile navigation: Payments opens Customers With Due; Receipts and search remain usable at narrow widths and with long names/amounts.
- [ ] Receive Payment → search an absent customer → Add Customer. Enter Karim Traders, an unused valid phone, Opening Due ৳25,000, Balance Date and note; save once. Receive Payment opens for that customer without another search.
- [ ] Account shows Opening Due ৳25,000, Sales ৳0, Payments Received ৳0, Total Due ৳25,000; opening history shows the entered date/note.
- [ ] Receive ৳10,000 Cash. One receipt shows Opening Due, Due Before ৳25,000, Paid Now ৳10,000, Due Left / Due After Payment ৳15,000. Account/global due list both show ৳15,000. No Sale/invoice or stock change appears.
- [ ] Existing customer without opening history: Add Old Due, then receive payment. A customer whose due comes only from Opening Due appears in Customers With Due with Oldest Due “Opening Due” and no fake Sale link.
- [ ] With Opening Due ৳5,000 and later invoice due ৳3,000, receive ৳6,000 using Pay Old Due First. Receipt applies ৳5,000 to old due and ৳1,000 to invoice; account due left is ৳2,000. Sale Detail shows only ৳1,000 from that receipt.
- [ ] Choose Invoices: skip old due or split it with invoices. Review and confirmation show the same Pay Now amounts. Incorrect sums, excessive amounts and more than two decimals cannot submit.
- [ ] Pay the entire opening balance. It leaves Customers With Due when no Sale debt remains, but opening history and receipts remain visible. A second initial Opening Due is blocked even after full payment.
- [ ] Refresh/double-submit during uncertain saving: retry the same payment/save; confirm only one event/receipt is present. Two tabs attempting payment against the same balance cause the stale tab to refresh/review.
- [ ] Duplicate normalized phone: use local/international formatting for the same phone; the form points to the existing customer without creating a second account or old due.
- [ ] Search/pagination: due name/phone search and receipt number/customer/phone search; page changes and empty results; wildcard characters are literal. Changing a search/view resets the page.
- [ ] Create a Sale after Opening Due remains ৳10,000 and another invoice remains ৳5,000. New Sale shows Previous Due ৳15,000, excluding the current Sale. Later payments leave the saved snapshot unchanged.
- [ ] Compare Total Sales, Sales reports, today's sales and stock before/after Opening Due and its payment. Sales/stock stay unchanged; Customer Due and Payments Received change correctly.
- [ ] Customer Payment History/global Receipts show one receipt for a payment spanning both sources; opening receipt detail has no invoice number or Sale link. Legacy Payment rows still appear in customer history.
- [ ] Attempt voiding a Sale with receipt payments: blocked under the existing rule. A Sale with only legacy/at-sale payments still follows existing stock/payment reversal behavior.
- [ ] Keyboard/focus, error/retry states, date inputs, long fields, mobile drawer scrolling and safe-area bottom buttons work; no technical accounting terms appear in the new flow.

## Files in this continuation

Paths below are relative to the repository root; these identify this continuation rather than attributing every earlier uncommitted change to it.

- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/20261007050000_customer_opening_due/migration.sql`
- `apps/api/prisma/migrations/20261007051000_payment_receipt_order/migration.sql`
- `apps/api/src/customers/account-balances.ts`
- `apps/api/src/customers/opening-due.ts`
- `apps/api/src/customers/opening-due.dto.ts`
- `apps/api/src/customers/opening-due-migration.spec.ts`
- `apps/api/src/customers/payments-ledger.ts`
- `apps/api/src/customers/payments.controller.ts`
- `apps/api/src/customers/customers.controller.ts`
- `apps/api/src/customers/customers.module.ts`
- `apps/api/src/customers/customers.service.ts`
- `apps/api/src/customers/payment.dto.ts`
- `apps/api/src/customers/payment-accounting.ts`
- `apps/api/src/customers/payment-receipts.ts`
- `apps/api/src/customers/payment-receipts.database.spec.ts`
- `apps/api/src/customers/customer-identity.database.spec.ts` (isolated fixture table)
- `apps/api/src/sales/per-roll-sales.database.spec.ts` (isolated fixture table)
- `apps/api/src/sales/sales-ledger.database.spec.ts` (isolated fixture table)
- `apps/api/src/sales/ledger-access.spec.ts` (account-read fixture)
- `apps/api/src/sales/sales.service.ts` (Previous Due snapshot source)
- `apps/api/src/inventory/inventory.service.ts` (Customer Due summary)
- `packages/contracts/src/index.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/lib/api.ts`
- `apps/web/src/features/payments/opening-due-page.tsx`
- `apps/web/src/features/payments/payment-customer-search.tsx`
- `apps/web/src/features/payments/payments-page.tsx`
- `apps/web/src/features/payments/payments-ledgers.tsx`
- `apps/web/src/features/payments/payments-types.ts`
- `apps/web/src/features/payments/payments-integration.spec.ts`
- `apps/web/src/features/records/receive-payment-page.tsx`
- `apps/web/src/features/records/payment-components.tsx`
- `apps/web/src/features/records/payment-allocation.ts`
- `apps/web/src/features/records/payment-allocation.spec.ts`
- `apps/web/src/features/records/payment-receipt-page.tsx`
- `apps/web/src/features/records/customer-account-page.tsx`
- `apps/web/src/features/records/records-pages.tsx` (simple due label)
- `apps/web/src/features/sales/new-sale-page.tsx` (simple due label)
- `apps/web/src/features/sales/sale-payment-panel.tsx` (simple payment label)
- `docs/locked-requirements.md`
- `docs/customer-payment-allocation.md`
- `docs/customer-payment-security-review.md`
- `docs/customer-opening-due.md`
