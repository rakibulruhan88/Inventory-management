# Cashbook foundation and design report

## Existing sources and calculations

New Sale creates a `Sale` and, when money is applied, one `Payment` in the same transaction. Payment amount is `min(receivedAmount, totalAmount)`; excess is returned as change. Checkout is not a CustomerPaymentReceipt. Sale.paidAmount later increases with due receipts, so Cashbook never uses that field as a new cash event.

Receive Payment creates one CustomerPaymentReceipt and multiple CustomerPaymentAllocation rows. Each allocation pays a Sale or Opening Due. Receipt total is counted once; allocation sum is only its Old Due Collected breakdown. Opening Due creates debt, not Sales or Money In; collecting it creates Money In.

Older customer due payments wrote invoice-level Payment fragments, without a receipt identity. The forward migration classifies checkout only where Sale, Payment and SALE_CREATED audit share the original posting timestamp and original applied amount, or when one matching Payment falls inside the audited atomic Sale creation interval; due requires PAYMENT_RECEIVED audit evidence. Unclear history is “Older Payment,” still included once in Money In. No historical receipt groups or invoice numbers are invented. Old Due Collected cannot include unclassified historical money until its source is reviewed.

Sales: completed Sale.totalAmount by soldAt, excluding voided Sales. Money In: active Payment amounts + one total per receipt + active Other Money In. Old Due Collected: eligible receipt allocations + proven legacy due fragments. Money Out: explicit active Supplier Payment + Expense + Other Money Out. Net Money: Money In minus Money Out; never Profit or actual cash/bank balance.

Purchase has monetary columns, but the receiving flow does not establish an authoritative supplier liability. Purchase receipt therefore creates no Money Out. Supplier Payments may relate to an existing supplier/purchase/container but never claim remaining payable or change Purchase.paidAmount/stock.

## Schema and migration

FinancialEntry stores ID, direction, manual type, optional expense category, Decimal(14,2) amount, method, occurrence date, reference/note, optional supplier/purchase/container relations, creator/time, unique submission key/hash and void actor/time/reason. DB checks enforce positive amounts, supported direction/type combinations, supplier/category shape and complete void metadata; foreign keys restrict deletion of referenced sources.

Migration `20261007060000_cashbook` adds this table, audit actions and Payment.cashbookType. It is forward-only, reviewed and applied locally with no reset. A second forward migration, `20261008043000_cashbook_checkout_evidence`, handles Prisma’s individual creation timestamps: exactly one original-amount Payment must be inside its Sale-to-SALE_CREATED audit interval. A later request cannot see the Sale before that creation transaction commits. This refines origin metadata without changing money. All prior migrations and records remain. Prisma validation/status/schema comparison are part of verification.

## Flows, pages and documents

| Page | Purpose | Document |
|---|---|---|
| `/cashbook` | All money events and compact totals | Source links |
| `/cashbook/money-in` | Checkout, old due and other money received | Existing receipt/source |
| `/cashbook/expenses` | Business costs | Expense Voucher |
| `/cashbook/supplier-payments` | Explicit supplier payments | Supplier Payment |
| `/cashbook/money-out` | Other money paid out | Payment Voucher |
| Each section `/new` | Full-page entry form | Created detail after save |
| `/cashbook/entries/:entryId` | Manual record, print and void/history | Type-specific document |
| `/reports` | Financial Summary using the same service | Date-based summary |
| `/sales/:id/invoice` | Goods sold and due snapshots | Sale Invoice |
| `/customers/:id/receipts/:receiptId` | One customer receipt, including mixed debts | Payment Receipt |

Expense defaults: Transport, Loading, Rent, Electricity, Salary, Food, Delivery, Office, Repair, Other. Other requires a Note. Supplier is required only for Supplier Payment; Purchase/Container links are optional and validated for supplier consistency. Reference is not used as the duplicate-submission key. Other Money In/Out cannot impersonate checkout or due receipts.

Manual amounts/type/direction cannot be edited after save. Correct a mistake by voiding with a reason and creating a new record. Voiding is conditional/atomic, preserves original details and writes one audit. “All entries” and “Voided entries” keep history accessible, with voided amounts excluded from totals.

All staff-facing labels remain simple English. Warm off-white, near-black, restrained cognac, thin dividers and tabular money replace giant popups/cards. Mobile places totals before the transaction list; filters and breakdown open inline. Methods are clear buttons in forms. Optional supplier links use a disclosure. Searchable customer/supplier/document conventions are preserved.

Sale invoices emphasize item, description, textual color, Rolls, optional Meter, Unit Price / Roll and Amount; sale-time due and current invoice due are separate. Customer receipts emphasize Amount Received and Paid Against, with stored posting-time balances. Manual money documents use real Entry IDs, without inventing invoice sequences. Browser print/PDF supports distinct vouchers/receipts. Downloaded and emailed sale PDFs use the redesigned printable layout and an OFL Noto Sans Bengali font for ৳. No actual email was sent during this work.

Dashboard was left for a focused later task; Cashbook/Reports provide authoritative financial summaries. No broad shell redesign or full accounting suite was added.

## Filters, totals and security

Today/Yesterday/This Week/This Month/Specific Date/Custom Dates use Asia/Dhaka complete-day half-open boundaries; week starts Monday. Page size defaults 25, max 100; ordering is source createdAt descending then source-prefixed ID ascending, so newly added records appear first even when backdated. Date filters continue to use the business occurrence/payment date. New manual entries and due payments capture the Bangladesh clock time at submission instead of fixed noon/midnight; retries retain their original exact timestamp. Historical timestamps are unchanged. Database summaries use the entire filtered set in the same RepeatableRead snapshot. Sales stays a date-only revenue metric when cash filters are used; UI explains this. Money In has a server-side direction filter.

Finance reuses the session guard and additionally checks an active User from the DB. OWNER may create/void; STAFF may view the shared business ledger. No granular finance permissions exist. IDs identify shared business resources; receipt source URLs retain customer-scoped receipt access. DTO allowlists reject mass assignment, unsupported types/methods, excessive amounts, invalid links and oversized pages. Parameterized SQL escapes search patterns. Decimal arithmetic avoids persisted float calculations. Database failures return simple messages.

Financial cookie writes require a non-simple header and allowed origin. Submission keys are serialized before payload/actor-bound lookup; exact concurrent retries return the original event. The frontend keeps uncertain submissions in sessionStorage in that user’s tab and retries the same key/payload. Definitive validation rejections unlock correction. AuditLog creation/void metadata records actor, entry ID, type, amount, supplier and business date. This does not introduce a large RBAC or Activity redesign.

## Manual verification checklist

- At desktop and 390px/320px mobile widths, open Cashbook and each section; confirm totals are visible early, tabs scroll, and no entry/detail popup opens.
- Open each full-page entry form; choose methods, optional supplier links, and save. Confirm the detail document matches its type.
- Try zero/negative amounts, Other expense without Note, bad supplier links and an interrupted save followed by Retry Save.
- Create a ৳100,000 partial-paid Sale with ৳40,000 paid. Confirm Sales ৳100,000 and Money In ৳40,000. Collect ৳20,000 old due: Sales unchanged, Money In +৳20,000.
- Collect one receipt spanning multiple invoices and Opening Due; confirm one Cashbook receipt, full amount counted once, and correct source links.
- Record an Expense and Supplier Payment; stock, purchase totals and Sales stay unchanged. Void a mistake; active totals fall, history and reason remain.
- Test Today across midnight in Dhaka, complete custom end dates, search/type/method/status filters and Next/Previous pages. Totals must stay independent from the current page.
- Sign in as staff: view records, no finance write actions. Sign out: API/view access denied.
- Print Sale Invoice and Customer Receipt; verify they look different and remain readable with long names, repeated colors, many rows and missing optional data.
- Print all manual document types and a voided record. Check Print / Save PDF at mobile and desktop. Download a long sale PDF; check repeated headers, ৳, due snapshots, footer/page numbering and no blank trailing pages.
- Regression check New Sale, Customer Payment, Opening Due, Purchase Receive, Inventory and source invoice/receipt navigation.

## Changes and verification

Task-specific changes: new API finance module/service/DTO/guard/read model/tests; schema and cashbook migration; explicit checkout Payment origin; shared finance contracts; Cashbook routes/navigation/API functions; separate finance lists/forms/detail documents; Reports integration; document styles/components; Sale Invoice and Customer Receipt presentation; PDF formatter/font/build assets; locked requirements and this report. Earlier uncommitted customer/payment/sale/inventory work was preserved.

Backend and shared contract files changed as authorized by the foundation request; later backend edits cover server-side Money In filtering and sale PDF presentation/assets. No dependency upgrade, commit, push, browser automation, reset, supplier payable calculation or payment reversal occurred.

Final verification (8 October 2026): root typecheck and build passed; root test passed with 669 API tests and 95 web tests (764 total). New coverage includes 44 finance/PostgreSQL/date/security/migration tests, four PDF tests and seven manual-document/precision tests. Prisma schema is valid, all 21 migrations are applied locally, and database-to-schema diff is empty. `git diff --check` passed. `git diff --name-only` and untracked task files were reviewed; backend/contracts changes are within the authorized financial foundation and document/filter work. Existing unrelated changes remain untouched.

PDF visual verification used rendered single-page and multi-page samples, including payment history, ৳, repeated headings, preserved due snapshots, signatures and numbered footers. Browser and mobile visual testing remains manual as requested. No commit or push was made.
