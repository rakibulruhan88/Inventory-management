# Locked product and engineering requirements

## Product language

- The business UI uses **Rolls** and **Meter**, never “Quantity”.
- Products are purchased by **Roll**. Sales default to **Roll**, with an additive **Meter** mode per row. Roll rows sell at least one integer Roll; Meter rows sell zero Rolls and positive Meter.
- In Roll mode, Meter is optional tracking information. A Roll sale with Meter deducts both Rolls and Meter; a blank Meter deducts only Rolls. Meter mode requires positive Meter and deducts no Rolls.
- Roll-only sales retain zero-Roll Meter normalization. When a variant has a Meter sale row, preserve its unused Meter, including at zero Rolls. Zero Rolls with positive Meter is sellable stock.
- Main inventory aggregates Rolls and optional Meter while preserving batch and container history.

## Product identity and stock history

- The supplier Commercial Invoice Contract No. is the Container Number (`containerNumber`). It is unique and cannot be reused; there is no separate contract number.
- Item code identifies one reusable product master across containers.
- Repeated item codes reuse the existing product; they do not create duplicate product masters.
- Each container receipt remains a separate inventory batch.
- Every item has one optional **Description / Size** in `Product.description`, shared by all colors (for example `1.2mm*54"*36.5m`). Colors never have their own size. Item Code and Description / Size are sufficient; product name is optional.
- Every item has at least one required color. `ProductVariant.color` contains the complete textual supplier **Color Code** (for example `02#Pine green`), never a CSS/hex color. Do not fabricate swatches.
- Receive Purchase enters Item Code and Description / Size once, then one Color Code, Rolls, and optional Meter per color. Existing item codes reuse their master and description. A conflicting description is rejected; use an explicit Inventory edit first.
- Legacy variant sizes and hex codes are retained only for migration review. Backfill an item description only when sizes agree; record conflicts instead of guessing. Ambiguous legacy variants cannot be reused by receiving a purchase until explicitly resolved.
- New sales snapshot the item description and supplier color; historical invoice snapshots remain unchanged.

## Experience

- Mobile-first, light-only, warm off-white and restrained cognac visual language.
- Calm, practical screens for a non-technical shop owner; no generic dashboard styling.
- No default HTML select controls for important data. Use searchable command/combobox patterns, with a sheet or drawer on small screens.
- Products, item codes, rolls, meter, customers, phone numbers, suppliers, containers, purchases, sales, and invoices must be searchable.
- Feedback uses clear loading, disabled, validation, success, and error states. Motion explains state changes and is not decorative.

## Architecture

- React, Vite, TypeScript, Tailwind CSS, shadcn/ui, Radix UI, Lucide React, Motion, AutoAnimate, Sonner, Vaul, TanStack Query/Table, React Hook Form, Zod, date-fns, and Recharts where useful.
- NestJS and TypeScript API with Prisma and PostgreSQL.
- Docker-based local development now, VPS deployment later.
- Business logic stays in the API/domain layer so a future React Native + Expo client can reuse the same API, authentication, and shared contracts.

## Customer identity

- `Customer.id` is the primary relational identity. Sales, Payments, invoice/account history, and audit references remain linked by customer ID.
- Optional Bangladesh mobile phones normalize to `8801XXXXXXXXX` (013–019 prefixes); the nullable `normalizedPhone` is the unique business identity, including archived customers. Display phone is preserved separately.
- Names and emails are not unique identifiers. Inline sales reuse an explicitly selected ID or an exact normalized phone; names/email alone never silently select another customer.
- Phone edits update display and normalized phone together and never change historical relationships or invoice snapshots.
- Existing invalid phones remain unchanged with null normalized identity pending manual correction. Duplicate customers are never automatically deleted, merged, or reassigned.
- Before applying the phone identity migration, run `npm run customer-phone:audit --workspace @afia/api`. Resolve any duplicate group explicitly with the owner; the migration rechecks duplicates and rolls back safely on conflicts.

## New Sale entry and pricing

- An item stays in one frontend group; its textual color may repeat across intentional sale rows. Repeated rows are never merged.
- Roll rows store Unit Price / Roll and backend-calculated `lineTotal = rollsSold × unitPricePerRoll`, using integer cents/Decimal. Meter remains optional tracking in Roll mode. Meter rows reuse `SaleMode.BY_METER` and `ratePerMeter`, with `lineTotal = meterSold × ratePerMeter`, rounded once to the nearest cent. Unit prices and Meter have at most two decimal places. Meter rows deduct only Meter; Roll rows retain existing stock semantics. Historical pricing is never inferred.
- Stock validation aggregates all rows by ProductVariant before oldest-batch allocation. For Roll-only variants, zero-Roll Meter normalization happens after the variant's rows have allocated; sale void reverses all deduction/normalization movements.
- Historical manual-amount SaleLines retain their existing totals with null unit price; never infer historical prices. Discount, received/paid/due/change, customer relations and invoice numbering retain their existing rules.

## Customer payments and due allocation

- Receive Payment settles old due without creating a Sale. One `CustomerPaymentReceipt` represents one payment and has one or more `CustomerPaymentAllocation` records linked to eligible completed invoices and/or the customer’s Opening Due.
- All relationships use `Customer.id`, with `Sale.id` or `CustomerOpeningBalance.id` identifying the due being paid. Phone numbers remain lookup/uniqueness only; changing a phone never reassigns financial history.
- The default allocation is oldest due first across completed Sales and Opening Due, ordered by the source date (`soldAt` / `balanceAsOf`), then `createdAt`, `id`, and kind. The UI calls this “Pay Old Due First.” Manual allocation is called “Choose Invoices”; each Pay Now value is nonnegative, cannot exceed that source’s remaining due, and all Pay Now values must sum to the receipt total.
- Payments must be positive and cannot exceed authoritative Total Due. Customer credit/advance balance is unsupported. New Sale over-received money continues to be returned as change under the existing rule.
- Invoice Total never changes when due is paid. `Sale.paidAmount` is the authoritative applied paid total, updated atomically with receipt allocations. Total Due remains derived from completed invoice totals less paid amounts plus Opening Due less its receipt allocations. `accountSourcesSql` is the shared calculation path for accounts, payment validation, global due queries, dashboard due and new-sale snapshots; no editable or duplicated customer balance exists.
- Confirmation re-reads and validates account and invoice balances under a shared customer-account transaction lock. Stale previews are rejected for review. Backend idempotency keys protect retries and simultaneous duplicate submissions.
- Receipt numbers use a PostgreSQL sequence with a database unique constraint (`PAY-YYYYMMDD-NNNNNN`, issue date in Asia/Dhaka). Sequence gaps after rollback are valid.
- New Sales snapshot nullable `previousOutstandingBeforeSale` and `outstandingAfterSale` at creation. Previous debt never changes Sale Total; outstanding after sale equals prior outstanding plus current invoice due. Initial sale paid/due remains derivable from original received, change and total fields. Later payments never rewrite these snapshots.
- Legacy Sales retain null account snapshots. Legacy payment rows are preserved ungrouped, without invented receipt numbers or inferred group identities. Payments recorded at Sale creation retain their existing single-invoice representation.
- Receipt and allocation balances are posting-time snapshots. Payment Date is editable and defaults to the current Asia/Dhaka business date; a backdated date does not reconstruct or rewrite historical invoice balances.
- Receipt writes include `CUSTOMER_PAYMENT_RECEIVED` in AuditLog with actor, customer, receipt, amount, affected Sales, Opening Due IDs and payment time. Creation time is preserved by AuditLog itself.
- Sales with any receipt allocation history cannot be voided. Existing legacy-only Sale void still reverses its payments and stock. Receipt deletion/reversal is unsupported; a dedicated safe payment reversal feature is future work.
- Printable invoice redesign, printable receipts and customer credit are outside this feature.

## Opening Due and global Payments

- `CustomerOpeningBalance` is immutable historical debt owed to Afia, not a Sale, invoice, credit, or revenue. Staff see “Opening Due” / “Old Due.” It never changes Total Sales, item sales, stock, today/monthly sales or Sales ledger revenue.
- One initial Opening Due is allowed per Customer, including after it is fully paid. Amount must be positive with at most two decimal places; Balance Date is required and Note optional. Customer identity/normalized-phone uniqueness is unchanged.
- No Opening Due edit/delete/correction endpoint exists in this stage. Incorrect records need a future explicitly audited correction/reversal workflow; do not silently rewrite history or create a second opening entry.
- New customer plus Opening Due is one atomic, audited, idempotent event. Staff then continue to the existing Receive Payment form, where the payment is a separate atomic event. Existing customers can use “Add Old Due.”
- Opening Due remaining is originalAmount minus receipt allocations; there is no separately editable paid amount or customer balance. Account summary shows original Opening Due, Sales, Payments Received and Total Due. The opening history remains visible after full payment.
- Exactly one of saleId/openingBalanceId is required on each receipt allocation; source ownership must match the receipt customer. A database check and ownership/overpayment trigger protect writes. One receipt may pay both sources; Sale Detail includes only its own applied amount.
- Opening creation records `CUSTOMER_OPENING_BALANCE_CREATED` with actor, customer, opening ID, amount, Balance Date and creation timestamp. Receipt audit metadata identifies opening IDs and sale IDs. Opening Due events appear in the owner-only Activity history.
- All account writers use the customer lock. Opening creation also serializes exact submission keys before new identity creation. Payment balances are reread inside the transaction; stale previews, duplicate keys with changed payloads and overpayment are rejected. Exact retries return the existing event.
- Opening Due remaining is included in new Sale previousOutstandingBeforeSale, before inserting the new Sale. Legacy snapshots remain untouched. Receiving old due is Money In but is not a new Sale; future Financial Ledger/Cashbook must retain this distinction.
- `/payments/outstanding-customers` and `/payments/receipts` require the existing session guard, validate bounded server pagination/search, use stable ordering and avoid per-row database reads. Due customers include opening-only, sale-only and mixed customers. Receipts contain one row per existing customer receipt; legacy/at-sale Payments stay in Customer History without fabricated receipt identities.
- Added/changed staff UI uses simple English: Total Due, Previous Due, Opening Due, Balance Date, Pay Now, Due After Payment, Receive Payment, Payment History, Pay Against, Paid Against, Pay Old Due First, Choose Invoices. Internal accounting terms belong in developer documentation.
- No Cashbook, printable invoice/receipt redesign, advance/credit, dependency upgrade or broad refactor is included.

## Cashbook / Financial Summary foundation

- Sales, Money In and Money Out are independent measures. Sales is the sum of completed Sale totals by `soldAt`; Opening Due, later customer payments and Other Money In never create Sales.
- Money In reads existing active `Payment` rows once, each `CustomerPaymentReceipt.totalAmount` once, and active manual Other Money In once. Never also sum Sale.paidAmount or receipt allocations as additional receipts.
- Checkout creates an explicit `Payment.cashbookType = SALE_PAYMENT`. Historical classification requires matching original posting/audit evidence; for Prisma-assigned timestamps a single original-amount Payment must lie inside the atomic Sale creation-to-audit interval. Proven legacy due fragments retain their original identities; unclassified older payments count in Money In but are visibly separated and never guessed into Old Due Collected.
- Old Due Collected sums eligible Sale/Opening Due receipt allocations once per receipt plus proven legacy due fragments. Immediate checkout money is excluded.
- Manual `FinancialEntry` supports only Other Money In, Supplier Payment, Expense and Other Money Out. Positive Decimal(14,2) amounts; direction follows type. No silent amount edit or hard-delete endpoint. Void preserves actor, reason and original entry; active totals exclude voided records. Voided history remains viewable.
- Purchase receiving does not automatically mean Supplier Payment. Existing stock receiving has no authoritative supplier invoice liability. Supplier Payments may link by Supplier.id to a matching Purchase/Container, but do not update stock, Purchase paidAmount or claim a remaining supplier payable.
- Net Money equals Money In minus Money Out. It is not Profit, Current Cash, Cash Balance or Bank Balance. Cashbook tracks movement, without opening account balances, transfers or reconciliation.
- Cashbook and Financial Summary share one backend calculation. Filters use complete Asia/Dhaka days, Monday-start weeks, whole calendar months and inclusive selected end dates. Cash-only type/method/search/status/direction filters apply to money, while Sales is the independent selected-date metric.
- Server pagination defaults to 25, max 100, with source createdAt descending then prefixed source ID ascending (newest recorded first). Date filters still use occurredAt / payment date. Aggregates cover all matching rows, not the current page, in a RepeatableRead transaction.
- Active staff may view shared business finance records; owner-only manual creation/void is rechecked from the database. No separate tenant/customer ownership model is invented. Financial writes require the existing session plus a verified custom header/origin for cookie requests, bounded DTO validation and payload-bound idempotency.
- Each creation/void writes AuditLog atomically with actor, entry ID, type, amount, supplier ID and occurrence date. One concurrent submission key creates one entry and one audit event. Ambiguous frontend retries preserve the exact submission across navigation/reload in the same browser tab.
- New manual entries and customer due receipts combine the selected business date with the current Asia/Dhaka clock time at submission. Exact timestamps are retained for idempotent retries; historical timestamps are not rewritten. Cashbook displays Bangladesh date and time for every source.
- Staff UI uses short, simple English and ৳. Main Cashbook shows all records; Money In, Expenses, Supplier Payments and Other Money Out have separate lists, entry pages and document detail pages. No financial-entry popup. Mobile shows compact totals and stacked records; detailed filters/breakdowns are expandable.
- Sale Invoice, Customer Payment Receipt, Money In Receipt, Expense Voucher, Supplier Payment and Payment Voucher have distinct document layouts. Only existing invoice/receipt numbers are shown; manual documents show their real Entry ID without fabricated invoice numbering. Printing and browser Save as PDF use the same document. Downloaded/emailed sale PDFs include per-Roll prices, stored due snapshots, sale-time/later payments, Dhaka dates and an embedded OFL font for ৳.
- Full accounting, supplier payable calculation, customer credit and payment reversal remain outside this foundation.


## Owner Activity history

- Activity is available only to a signed-in, active Owner. The API rechecks the current database role for every Activity list, details and filter-options request; a stale session role never grants access. Staff navigation hides Activity.
- Activity reads the existing AuditLog and preserves all historical records. Missing historical actors or change snapshots stay unknown; never create past events from guesses. Names/references may use current records only as a fallback when an old log has no snapshot.
- Track completed sales and voids, purchase receipts and reversals, stock adjustments, customer payments, Opening Due, Cashbook entries and voids, contact/item/container edits and archives, settings and account changes, sign-in/sign-out, password changes, invoice email delivery and invoice import upload/review/confirmation.
- New edits save explicit before/after fields and the actor's display name in the same database transaction as the change. Rolled-back changes do not create successful activity. Existing receipt/entry idempotency remains authoritative; exact retries do not duplicate their posting events.
- Never save passwords, hashes, tokens, cookies, upload content, parser text or image data in activity. Brand images use fingerprints to detect a replacement without retaining the file or URL. Activity details expose only named safe fields, never raw metadata JSON.
- Owner can search and filter by category, action, person and complete Bangladesh date ranges. Stable server pagination and full-filter summaries share one read snapshot. Details show saved changes, note/reason, time, actor and a link to the real record where available.
- Desktop uses a ledger with a details panel; mobile uses stacked events and a details drawer. Auto refresh runs while the page is active and can be turned off. This tracks saved work and account events; it does not record page views or keystrokes.
- Activity has no edit/delete endpoints. The forward migration only adds AuditAction enum values; it never resets, seeds or rewrites historical data. Existing stock, sale, purchase, customer identity, due and payment calculations remain unchanged.

## Staff roles and access

- Owner is the administrator. Only an active Owner can create, update, deactivate, reset passwords or delete Staff accounts, and view Activity or change store settings. Staff cannot grant access, edit an Owner or delete an Owner.
- Admin sets the initial name, unique username and password. Passwords are bcrypt hashes and never returned or recorded in Activity. Staff can change their own password through Account settings.
- Staff access is an explicit permission allowlist, enforced against the current database account on every authenticated API request. Unassigned legacy Staff have only their own Account settings until the Owner grants access. Required viewing permissions accompany enabled actions; presets remain editable.
- Permission, profile, password and activation changes revoke previous staff sessions. Inactive/deleted accounts cannot sign in. Password changes and sign-out revoke previously issued sessions; reactivation never restores revoked tokens. Existing Owner sessions with no version remain valid at version zero.
- Delete Staff removes access and the account from the team directory while retaining its relational user identity, username reservation and business history. Never hard-delete or reassign historical financial records.
- Staff changes record safe before/after name, username, access, status and deletion fields atomically. Admin password resets add a password-change event without storing credentials. Activity remains immutable and Owner-only.
- Delegated finance creation/void replaces the earlier Owner-only manual-write rule: only Staff explicitly granted the corresponding permission may perform that action. Existing custom-header/origin verification, validation, idempotency and financial calculations remain unchanged.
- Sale creation does not grant email permission or independent customer-management permission. Creating an inline customer requires customer-management access; invoice email, including at checkout, requires invoice-email access. Receiving/importing purchases includes supplier-management access for existing inline supplier creation.
- Sale Invoice, Customer Payment Receipt and all manual finance documents show Prepared by from the original posting AuditLog actor-name snapshot, with the original linked actor as historical fallback. Rename/deletion never rewrites saved actor-name snapshots. Missing historical attribution stays Not recorded. Downloaded/emailed sale PDFs include the same attribution.
- Navigation, landing pages and action controls reflect permissions; direct API requests remain authoritative. Browser/visual testing is performed manually by the owner.

### Staff work summary

- Owner-only Staff details include All time / This month saved-work counts by the original AuditLog user ID. Month boundaries use Asia/Dhaka and the event recording date; backdated business transactions do not rewrite when staff performed work.
- Show enabled work actions and previously recorded actions after permissions are removed, marked Past access. Counts distinguish Sales created, Customers added, Customer payments received, manual Money In/Out, Purchases received, Suppliers added and Stock adjustments. Staff management remains Owner-only; Customers added does not mean new staff accounts.
- Count distinct successful posting records, without double-counting retries, checkout receipts, receipt allocations or void/reversal events. Stock adjustment counts represent individual adjustment events. Creation counts retain later voided/reversed records; these are work counts, not revenue or active financial totals. Missing historical actors are excluded.
- Anonymous/expired session checks resolve to Login without removing the active auth query; network checks have a ten-second timeout. Owners opening the root URL land on Dashboard, and Staff land on their first permitted page.

## Supplier payment visibility

- Supplier directory and details display Paid to Supplier from active Cashbook SUPPLIER_PAYMENT entries, linked strictly by Supplier.id. Totals are all-time, exclude voided entries, and are distinct from stock receiving or supplier payable. Similar supplier names never merge balances.
- Finance-view access is required for supplier payment totals and recent payment receipts; the supplier API omits these fields for other staff.
- Purchase history shows zero-valued stock receipts as Not recorded rather than implying a recorded zero-price purchase. Payment creation and voiding refresh supplier summaries.

## Invoice PDF consistency

- Screen, downloaded PDF and emailed invoice attachment share the same summary rows and creation-time due calculations, including Received at Sale, Paid at Sale, later payments and Change Returned. Received cash is distinct from the amount allocated to the invoice.
- The downloaded/emailed PDF follows the invoice sheet layout: labelled identity and Prepared by, customer contact lines, matching item columns, Customer Due panel, Current Sale summary, payment method/reference, notes and signatures. Payment history stays outside the invoice sheet. PDF fonts are bundled for stable rendering; long invoices retain repeated headings and page numbers.
