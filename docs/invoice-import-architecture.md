# Commercial Invoice Import architecture

The production pipeline is **Upload → PDF_TEXT / OCR / HYBRID → deterministic parsing → read-only matching → editable review → final validation → explicit Confirm Receive Stock → permanent original archive**. Parsing and review never write business records. The global Activity page is outside this stage.

## Shared business operation

Manual `PurchasesService.receive()` wraps `receiveInTransaction()` in a transaction. Import confirmation converts reviewedData to that same operation's input inside its own outer transaction. There is one implementation of Supplier resolution, Product/variant reuse, Container, Purchase, PurchaseLine, InventoryBatch, StockMovement and PURCHASE_RECEIVED audit creation.

Rolls remain positive integers. Meter remains optional, finite, nonnegative and limited to two decimals; absent Meter reaches the receiver as zero, consistently with manual receiving. Imported source totals must match when declared. Inventory is batch-based; neither manual nor imported receiving creates individual Roll rows. Batch numbering, movement references, totals and reversal calculations are unchanged.

Contract No. is the unique Container Number, never the Purchase Number. The editable Purchase Reference uses the same shared `PUR-YYYYMMDD-HHmm` default as the existing manual form; the API normalizes and enforces its existing uniqueness. There is no new numbering sequence.

Supplier matching uses an exact normalized clean name. One active match is reused by ID; ambiguity blocks. New suppliers are created only inside the shared receiver with intentionally supported name/phone/address fields. A contact-only match to another supplier blocks rather than choosing that company. Fax/contact person remain in original/reviewed JSON. Imported reuse does not silently enrich supplier masters.

Products are reused by normalized Item Code. New products receive item-level Description / Size. An existing differing description, including an empty existing description with a supplied description, blocks; an explicit Inventory edit is required. Complete textual supplier colors are reused per product, or created through the shared receiver. Archived masters and ambiguous legacy colors block import confirmation. There are no hex colors or color-level sizes.

## Extraction and review

PDF.js reads native positioned text; insufficient pages use bounded local Tesseract OCR. HYBRID combines the two. Relative semantic headers and physical table cells establish row ownership. Structural label normalization never repairs business identifiers or quantities. Uncertain values remain literal/null with source warnings or unassigned rows. OCR preprocessing and rendered pages remain in memory; the uploaded bytes are unchanged.

The existing bounded child reader, packaged English OCR model, page/pixel/text/row limits and timeouts remain. PDF_TEXT/OCR/HYBRID and parserVersion 3 are retained. Actual private invoice files are never committed. The previously verified native supplier document yielded 7 items, 23 colors, 964 Rolls and 35,050 Meter; image uncertainties require explicit correction.

`parsedData` is the immutable original extraction, returned as `originalExtractedData`. `reviewedData` is separate. Save/reset allowlist fields, preserve original warnings/source totals, recalculate totals and rerun read-only matching. Server-owned IDs, totals, readiness and match metadata cannot be assigned by clients. A conditional status/timestamp/expiry update prevents stale review saves; confirmation's draft row lock serializes concurrent saves and cleanup.

Purchase Date is editable reviewedData. Deterministic extraction recognizes Date, Invoice Date, CI Date and Document Date, compact YYYYMMDD and supported year-first separated dates. Dates must round-trip as real calendar dates. Malformed, conflicting or low-confidence values remain missing for manual entry; confirmation never substitutes today. Existing parserVersion-3 reviews are preserved and must supply date/reference if absent.

## Final confirmation and idempotency

`POST /api/invoice-imports/:id/confirm` accepts an empty body only. Authentication, active-account guard, draft ownership and the existing non-simple header/cookie Origin checks apply. There is no force flag.

Inside one PostgreSQL transaction, confirmation takes a draft advisory lock and owned draft row `FOR UPDATE`, reloads the draft, and locks the active actor row `FOR SHARE`. It checks expiry/status/current original extraction/saved review. It then takes the SHA-256 advisory lock used by uploads, the shared supplier-resolution lock, and sorted item-code locks used by both receive paths.

Final validation discards cached match IDs, totals, readiness and warnings; restores immutable declared totals/source rows; strictly validates the editable structure; recalculates totals; and queries current Supplier, Product, textual variants and Container. Duplicate item/color codes, invalid stock fields, missing date/reference/identity, source-total mismatches, unresolved source quantity/identity uncertainty, ambiguous/archived masters, description conflicts and existing containers block. Container and Purchase uniqueness are enforced again by database constraints during shared receipt creation.

A second confirmed source hash is rejected across owners without exposing private draft details. A unique PurchaseDocument SHA-256 constraint is the final race safeguard. `confirmedPurchaseId` is unique and written with CONFIRMED/confirmedAt inside the receipt transaction. Concurrent requests for one draft wait and return the same Purchase; confirmed retries do not receive again, even after expiry or reversal. A reversed source cannot be used to receive a second purchase.

Supplier/product/variant creation, Container, Purchase, lines, batches, movements, audit, permanent document metadata and confirmed linkage all commit together. Any failure rolls back all business changes. Transaction timeout is 60 seconds with a 10-second connection wait; failures preserve the review/source for safe retry.

## Permanent archive and filesystem compensation

`PurchaseDocument` stores a UUID, unique Purchase relation, COMMERCIAL_INVOICE type, display filename, private storageKey, validated MIME, byte size, unique SHA-256, uploader and creation time. The Container is reached through Purchase, so both contexts reference one document/file. PostgreSQL contains no PDF/image binary. Restrict foreign keys preserve historical linkage.

Temporary keys are `tmp/invoice-imports/<draft-uuid>/<random-uuid>.<ext>`. Permanent keys are `invoices/<purchase-year>/<safe-container-slug>/<random-uuid>.<ext>`. The environment-configured private root and `InvoiceStorage` abstraction are reused. Original names never determine a path.

1. Preserve and read the temporary original; revalidate MIME/signature, byte size and upload SHA-256.
2. Exclusively copy to a generated permanent key, flush the file and archive directory entries, then reread/verify equality before business writes.
3. Run shared receipt and insert document/confirmed linkage in the same database transaction.
4. On transaction failure, reacquire the draft lock to wait for the original transaction to settle, then check whether the permanent key is referenced by a committed document before compensation. Remove only an unreferenced generated copy. If commit outcome or compensation is uncertain, retain the file and log recovery context; never delete a potentially committed source.
5. After commit, verify the permanent file's size/hash, remove the temporary source and clear its key. Cleanup failures leave recoverable temporary files and history, without reversing received stock. Confirmed retries also retain recovery temp bytes if the permanent file is unavailable.

A hard process crash can leave an unreferenced generated copy. Recovery must reconcile files against document keys before deleting anything; no blind archive sweeper was added. Back up the private storage alongside PostgreSQL. External disk loss is reported by document access as source unavailable and does not permit another receipt.

## Document access and UI

| Route | Behavior |
| --- | --- |
| GET /api/invoice-imports/limits | Configured file limit/MIME allowlist |
| POST /api/invoice-imports | Private bounded multipart upload/hash/draft reuse |
| POST /api/invoice-imports/:id/parse | Native/OCR extraction and read-only matching |
| GET /api/invoice-imports/:id | Owner-only extraction/review/history and safe metadata |
| PUT /api/invoice-imports/:id/review | Strict editable fields and fresh matching |
| POST /api/invoice-imports/:id/review/reset | Reset from immutable extraction |
| POST /api/invoice-imports/:id/confirm | Atomic shared receipt and source archive |
| GET /api/purchases/:id | Purchase details and safe document summaries |
| GET /api/documents/:id | Safe document metadata |
| GET /api/documents/:id/content | Authenticated inline PDF/JPEG/PNG |
| GET /api/documents/:id/content?download=true | Authenticated attachment |

UUID parameters are validated. Confirmed documents follow current shared business-record access for active staff/owners; unconfirmed drafts remain uploader-only. Metadata never exposes storage roots/keys. Content lookup uses only the DB document relation, never a caller-supplied path. Strict key allowlists, canonical directory checks and no-follow file reads reject traversal and symlinks. Every content read validates stored MIME against source signature/extension and checks size/hash. Headers use sanitized ASCII plus encoded Unicode filenames, validated MIME, nosniff, private no-store and sandbox CSP. Missing/corrupt sources produce safe errors. No upload/archive directory is served statically.

The review editor adds Purchase Date and Reference. Saved read-only review enables Confirm Receive Stock only when ready. Its confirmation sheet summarizes supplier/container/date/reference/item-color count/Rolls/Meter and requires an explicit second action. Progress disables duplicate UI actions; backend idempotency is authoritative. Failure preserves the review. Success shows receipt totals and Purchase/source/back actions. Refresh reads the confirmed result and never posts confirmation automatically.

A restrained Purchase details route and the existing Container context expose the same source document View/Download controls. Existing Afia components/theme remain; unrelated screens were not redesigned.

## Confirmed lifecycle, cleanup, audit and reversal

Confirmed drafts retain extraction, parser warnings, reviewedData, method, hash, uploader, timestamps and Purchase linkage after expiry. Cleanup can remove recorded temporary remnants only after verifying the permanent archive; it never treats a permanent key as temporary or clears confirmed review history. Expired unconfirmed drafts follow the existing cleanup policy. Each pass considers up to 100 records in each group.

Operator cleanup remains `npm run invoice-imports:cleanup --workspace @afia/api`, or `node dist/invoice-imports/cleanup-invoice-imports.js` from apps/api for a production build. No scheduler was added. Failed confirmed-temp deletion is logged and retryable.

The shared operation emits one existing PURCHASE_RECEIVED AuditLog with actor, Purchase and timestamp. Purchase relations reach Container, document and import context for a future Activity page; no redundant audit action or parallel activity system was added. Purchase reversal remains the existing operation, with unchanged stock-change restrictions, zeroing/movements/cancellation/audit. Source documents and confirmed history remain archived after reversal.

## Configuration and runtime

| Variable | Default | Bound |
| --- | --- | --- |
| INVOICE_IMPORT_STORAGE_ROOT | `.invoice-import-storage` relative to API working directory | Private operator-controlled directory |
| INVOICE_IMPORT_MAX_FILE_MB | 15 | Integer 1–50 |
| INVOICE_IMPORT_MAX_PDF_PAGES | 20 | Integer 1–50 |
| INVOICE_IMPORT_TIMEOUT_MS | 120000 | Integer 1–300000 |
| INVOICE_IMPORT_TTL_HOURS | 24 | Integer 1–168 |

Supported formats are application/pdf, image/jpeg and image/png. Upload size is checked while bytes arrive. Images/rendered pages have a 16-million-pixel limit, text a 2-million-character limit, and color rows a 5,000 limit. Two uploads and one reader run concurrently per API instance; each user has at most 20 unexpired temporary drafts. Use a Node runtime compatible with the existing PDF.js dependency (Node >=22.13 or >=24), install target-platform optional Canvas binaries with npm ci, and use a private writable storage volume. No dependency upgrade or runtime service was added in confirmation work. Signature validation is not malware scanning or invoice authenticity verification.

## Migrations and verification

Forward migrations: `20261005010000_invoice_import_drafts`, `20261007000000_invoice_import_review`, and this stage's `20261007010000_confirm_invoice_documents`. No prior migration was rewritten and no database reset occurred. The latest migration adds only document metadata/type, confirmed linkage/timestamp, indexes and restrictive relations.

This stage adds 59 tests: 45 confirmation/archive/security/database cases, 13 date/reference cases and one frontend date/reference case. The full suite has 370 API and 19 frontend tests (389 total). It covers simultaneous confirmation, cross-draft SHA/container races, fresh blockers/master reuse, exact original bytes, halfway/document-insert rollback, failed archive/temp cleanup, uncertain commit response, safe content/header/path access, manual receiving/reversal and imported reversal retention. New confirmation tests use a disposable PostgreSQL schema and generated fixtures, not live stock tables/private files.

npm run typecheck, npm run test (389 tests), a clean npm run build, Prisma validate/migrate status/database-schema diff and git diff --check passed. git diff --name-only was reviewed; backend/contracts changed within the authorized scope and no upload/temp files are tracked. Browser testing remains manual. Dedicated second-pass findings and the task-relative changed-file inventory are in [invoice-import-security-review.md](invoice-import-security-review.md) and [invoice-import-confirmation-changes.md](invoice-import-confirmation-changes.md).
