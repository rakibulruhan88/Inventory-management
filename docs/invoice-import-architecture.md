# Commercial Invoice Import foundation

This stage stops at **Upload → Read document → Edit and save review**. The imported review is not sent into Receive Purchase. There is no confirm-import endpoint, permanent archive, document download, product/supplier creation, or stock receipt.

## Business boundary

`InvoiceImportsService` writes only `InvoiceImportDraft` records and temporary filesystem files. Matching reads Supplier, Product, ProductVariant, and Container. It does not call PurchasesService, InventoryService, supplier resolution that writes masters, or any receipt/sale logic.

Uploads and parsing cannot create or modify Purchase, Container, Product, ProductVariant, InventoryBatch, Roll, StockMovement, or Sale. Description belongs to the item; each nested color retains its complete textual supplier identifier. Contract No. is returned as Container Number. Existing descriptions and colors are never overwritten.

Existing AuditLog actions concern completed business transactions. This stage does not emit a stock audit event; the draft records its uploader, status, timestamps, parsing method, warnings, and errors. A future confirmed receipt can add a dedicated import/receipt audit event.

## Dependencies and runtime

Added to the API, pinned in the lockfile:

- `pdfjs-dist` 6.4.299: maintained PDF extraction and rendering.
- `@napi-rs/canvas` 1.0.10: server-side rendering with platform binaries.
- `tesseract.js` 7.0.0: local OCR in a bounded worker.
- `@tesseract.js-data/eng` 1.0.0: packaged English trained data, so reading documents does not download a model or send content externally.
- `invoice-multipart` → `multer` 2.4.0: a pinned npm alias for patched multipart handling, isolated from Nest's existing version.
- `@types/multer` 2.3.0: development types.

The project runs locally on Node 24.8.0. PDF.js requires Node >=22.13.0 or >=24. Use a compatible Node runtime on the VPS. Canvas supplies macOS and common Linux x64/arm64 binaries. Install dependencies on the target platform with `npm ci`; do not copy Mac node_modules to Linux or omit optional platform binaries. No system Tesseract, Poppler, ImageMagick, or paid service is required. Linux deployment was not executed here and must be verified on the target VPS.

Current Docker Compose runs PostgreSQL only; the API remains a local Node process. No Docker services were changed. For a future API container, use a compatible Node image, install target-platform dependencies, and mount a private writable storage volume. Set the reverse proxy multipart limit slightly above the configured file limit and its request timeout above the document timeout. Bound container/OS memory and CPU as well: Node's heap limit does not bound every native/WASM allocation.

The existing Nest platform dependency still contains older transitive Multer. The new import interceptor deliberately uses the separately pinned patched alias, rather than Nest's FileInterceptor. The alias also avoids npm workspace deduplication selecting the older transitive release. Existing unrelated audit advisories have not been addressed through framework upgrades.

Primary library references: [PDF.js](https://github.com/mozilla/pdf.js), [Tesseract local installation](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md), [Canvas](https://github.com/Brooooooklyn/canvas).

## Configuration

| Variable | Default | Bound |
| --- | --- | --- |
| INVOICE_IMPORT_STORAGE_ROOT | `.invoice-import-storage` relative to API working directory | Operator-controlled private directory |
| INVOICE_IMPORT_MAX_FILE_MB | 15 | Integer 1–50; MB here is 1024² bytes |
| INVOICE_IMPORT_MAX_PDF_PAGES | 20 | Integer 1–50 |
| INVOICE_IMPORT_TIMEOUT_MS | 120000 | Integer 1–300000 |
| INVOICE_IMPORT_TTL_HOURS | 24 | Integer 1–168 |

Images and rendered PDF pages are limited to 16 million pixels. Extracted text is limited to 2 million characters and color rows to 5,000. At most two multipart uploads and one document-reading process run concurrently per API instance. Busy processing returns a retryable 503; there is no unbounded queue. Each user may have at most 20 unexpired temporary imports, including failed drafts, to bound disk use.

## Storage and validation

Supported files:

- application/pdf with `.pdf`
- image/jpeg with `.jpg` or `.jpeg`
- image/png with `.png`

The multipart limit applies while bytes arrive. MIME and extension must agree with a PDF/JPEG/PNG signature. PDF uploads must contain a PDF header and trailing EOF marker. PNG/JPEG dimensions are checked before OCR decoding; malformed, encrypted, or unreadable documents fail during parsing. This is signature/decoder validation, not malware scanning or proof that an invoice is authentic. Files are kept private and never served or executed by the application.

Storage keys look like `tmp/invoice-imports/<draft-uuid>/<random-uuid>.pdf`. PostgreSQL stores only this relative key, file metadata, SHA-256, and parsed JSON. The original filename is display-only, stripped of path components/control characters and capped at 200 characters. Files use mode 0600 and directories 0700. The local adapter validates keys and resolved directories, rejects traversal/symlink escapes, and uses exclusive file creation.

The API omits storage keys, absolute paths, and internal exceptions. The default `.invoice-import-storage/` directory is gitignored at any repository depth. A custom storage root should be outside the checkout and every public/static directory. If intentionally placed inside the checkout, add that custom directory to gitignore.

`InvoiceStorage` defines createKey, put, read, and remove. A future S3/R2 implementation can supply this interface without changing parser/receipt rules. The extractor receives bytes, so it does not depend on local file paths.

## Draft model and migration

Forward migration: `20261005010000_invoice_import_drafts`. It adds only the draft table, indexes, enums, and uploader foreign key. It does not reset the database or alter existing stock tables.

`InvoiceImportDraft` records filename, MIME, byte size, SHA-256, relative storage key, status, parsing method, optional parsed JSON/warnings/errors, detected supplier/container, invoice/parsed totals, uploader, created/updated timestamps, and expiry.

Statuses: UPLOADED, PARSING, REVIEW, FAILED, CONFIRMED, EXPIRED.
Methods: PDF_TEXT, OCR, HYBRID.

CONFIRMED is reserved for the future stage. No current route transitions a draft to it. Drafts have no Purchase or inventory relations.

## Authentication and access

All routes use the existing global JWT authentication. A feature-specific guard additionally checks that the current user is active. A draft is visible/parsable only to its uploader, including for an owner account; another user's draft returns 404.

POST requests require `X-Afia-Invoice-Import: 1`. Cookie-authenticated POSTs also require an Origin matching configured WEB_ORIGIN (or the existing development localhost origins). The custom header forces browser preflight. This protects the new multipart route from simple cross-origin form submissions without changing the existing login flow. Bearer clients supply the header but do not need a browser Origin. GET routes have no business effects.

## API

| Route | Behavior |
| --- | --- |
| GET /api/invoice-imports/limits | Authenticated configured upload limit and MIME allowlist |
| POST /api/invoice-imports | One multipart field `file`; validates, stores, hashes, creates/reuses draft |
| POST /api/invoice-imports/:id/parse | Claims draft atomically, reads native text/OCR, parses, matches, persists REVIEW or FAILED |
| GET /api/invoice-imports/:id | Returns safe draft metadata, structured review, warnings/errors |

Draft IDs must be UUIDs. Repeated parsing of a REVIEW draft returns its existing review only when its parserVersion is current. Older reviews return requiresReparse with review withheld; parsing atomically claims the draft and re-reads its private upload. PARSING is atomically claimed, so another request cannot process that same draft concurrently. Failed drafts may be retried. Expired drafts return an expired state on GET and a 410 on parse; upload again to continue.

## SHA-256 duplicate strategy

Hashes come from uploaded bytes, not filenames. PostgreSQL transaction advisory locks serialize uploads by owner and file hash across API instances.

An unexpired UPLOADED/PARSING/REVIEW draft belonging to the current user is returned instead of creating a second draft: `duplicateFile: true`, `previousDraftId: <existing-id>`.

If only another account has that file, the uploader gets their own private draft and `duplicateFile: true`, `previousDraftId: null`. The other account's ID, filename, and review are not exposed. Failed/expired drafts do not permanently block a new upload. A future CONFIRMED record with the same hash already triggers a blocking conflict without exposing the other draft.

## Hybrid PDF text and OCR

For every PDF, PDF.js opens bytes locally and validates page count before page processing. Text positions are grouped into relative baselines and ordered left-to-right. PDF text spans and OCR word boxes are retained. Header positions establish relative column boundaries; the parser uses no fixed invoice pixel coordinates. Adjacent OCR words are retained as cell runs as well as original words so overflowing Description text is not split into guessed character positions.

Native text has priority when it contains useful color/numeric rows, explicit meter/rolls totals, or sufficient non-table invoice context. A table heading without readable rows is insufficient and falls back to OCR. Short native continuation rows or totals do not require OCR simply because they are short.

Each insufficient page is rendered at 2× scale with Canvas and processed sequentially by one Tesseract worker. A failure of native text extraction can still render/OCR the page and records a page-specific warning. Text-only PDFs return PDF_TEXT; OCR-only documents return OCR; PDFs with both page sources return HYBRID. JPG/PNG go directly to OCR.

Rendering uses in-memory buffers. No temporary rendered page images are written. Pages, PDF tasks, and OCR workers are cleaned in finally blocks. The parent runs document reading in a separate child process with a 384 MB JavaScript heap ceiling, suppresses raw library output, and kills the process on timeout/failure/shutdown. This prevents CPU-heavy reading from blocking the API event loop. There is no paid OCR endpoint, document network upload, or model download during processing.

## Parser rules and validation

The deterministic parser uses case-insensitive labels, Order List/item-table headings, supplier color identifiers, numeric patterns, and continuation state.

- Contract/Container No. becomes containerNumber.
- Exporter, Exporter / Beneficiary, Beneficiary, or Supplier labels identify the supplier name. ADD/ADDRESS, TEL/PHONE, FAX, and CONTACT PERSON delimit separate review fields. Exact normalized clean-name matching is read-only; contacts never select a different supplier. Ambiguity is a warning.
- Item No. comes from its actual table column, preserving complete names such as T902 PVC, New Lamb, F032 PVC, and Strap. No digit requirement or whitespace-token item regex is used. Column boundaries derive from recognized headers, including repeated shifted page layouts.
- A nonblank Item No. starts a separate item group exactly as read. A safely established blank item cell continues the current group. Duplicate groups warn rather than being silently merged.
- Missing layout, ambiguous boundaries, or questionable item ownership produce unassignedRows and review warnings, reset the continuation owner, and exclude those rows from parsed totals. A full explicitly pipe-delimited row with enough exact structural anchors is a safe layout-free fallback; ordinary whitespace cannot establish blank cells or item names. If strong invoice identity remains but columns are unreadable, the document stays in REVIEW with unassigned rows.
- Size: extracts the shared item Description / Size, including on a continuation line. Missing/inconsistent descriptions warn rather than being invented.
- Colors retain textual values such as 02#Pine green, 904#Off white, and F07111#Green. No hex or swatch fields exist.
- Header order determines Meter versus Rolls. Numeric values use strict digit/decimal/thousands patterns; Rolls must be positive integers. Malformed OCR is left null with field/page/line warnings, never repaired into a guessed number.
- Freight, loading/export charge, total amount, payment, banking details, and invoice total sections end item parsing.
- Total Amount table cells under Meter/Rolls or explicit Total Meter / Total Rolls labels supply declared totals. Repeated conflicting/malformed/missing totals warn. Parsed totals sum known rows and are rounded to two decimal places; any unknown value prevents a successful comparison for that measure.
- Duplicate/orphan colors, unreadable numeric-looking rows, missing colors/descriptions, existing description conflicts, missing existing descriptions, ambiguous legacy colors, archived masters, and existing container numbers all warn.
- Recognizable partial invoices remain REVIEW. Unsupported documents become FAILED with “Could not recognize this file as a supported Commercial Invoice.” A wrong image cannot become an invoice just because OCR returns text.

Recognition requires contract/container, recognizable invoice/table anchors, item codes, color rows, and Meter/Rolls headings. It is structural recognition, not authenticity verification. Missing/inconsistent totals or any warning make validationPassed false. No confidence percentages are invented.

## Review contract

`InvoiceImportDraftResponse` includes safe draft metadata, status, requiresReparse, parsingMethod, optional review, warnings, errors, createdAt, and expiresAt. Upload adds duplicateFile/previousDraftId.

The review contains:

- parserVersion, draftId and parsingMethod
- supplier: detectedName, phone, address, fax, contactPerson, matchedSupplierId, matchStatus
- containerNumber
- items: itemCode, item-level description, matchedProductId, existingDescription, matchStatus (NEW/MATCHED/DESCRIPTION_CONFLICT), descriptionMissingInExisting
- nested colors: textual color, rolls/meter (nullable for uncertain values), matchedVariantId, NEW/MATCHED/AMBIGUOUS status, source page/line/method
- unassignedRows: raw text, available cells/numbers, ownership reason, source page/line/method
- invoiceTotals, parsedTotals, totalsMatch (true/false/null per measure)
- validationPassed and structured warnings

A passing validation flag describes the parsed draft only. It does not grant permission or implement receiving stock. The future confirmation stage must repeat all matching, duplicate, container, description, and stock validation inside its own transaction.

## Minimal manual-test UI

Receive Stock offers Enter Manually and Import Commercial Invoice. The manual form stays mounted, keeps its entered values, and follows the unchanged receipt flow.

The import panel provides select/drop, server-configured file limits, upload/reading states, retry/refresh, duplicate notices, expiry, safe errors, supplier/container details, item-level descriptions, nested textual colors, declared versus parsed totals, match statuses, and field/page/line warnings. It does not populate the manual form, create masters, or offer a confirmation button. Mobile fields stack and tables scroll horizontally. Existing Afia theme tokens and components supply the styling.

## Cleanup

`InvoiceImportsService.cleanupExpired()` processes up to 100 expired records per call, excludes CONFIRMED, and avoids recently active parsing. It marks expired drafts, deletes only their private temporary upload, clears parsed JSON/warnings/errors, and clears the storage key. Failed deletions retain their key for retry; already-cleaned records are not revisited. A process-restart draft stuck in PARSING becomes cleanable after expiry and a 10-minute inactivity grace (longer than the maximum reader timeout).

Development/operator command from the repository root:

```sh
npm run invoice-imports:cleanup --workspace @afia/api
```

For a production build without dev dependencies, from apps/api use:

```sh
node dist/invoice-imports/cleanup-invoice-imports.js
```

No scheduler was added. Run cleanup periodically through the VPS's existing operational setup, repeating if more than 100 drafts are expired. Keep permanent-document archival in a separate storage prefix/model lifecycle later. A hard crash between file writing and database commit can leave an orphan upload directory; this stage's cleanup targets recorded drafts, so operational orphan sweeping remains a future hardening step.

## Verification and manual limitations

Focused tests cover file MIME/signatures/size, hashes, relative keys, duplicate reuse and concurrency, ownership/active-user/origin/header checks, strict multipart limits, stock-write traps, real PostgreSQL persistence with unchanged business records, native/scanned/mixed PDF extraction, JPG/PNG local OCR, random/corrupt documents, page/pixel/time/concurrency limits, worker cleanup, deterministic grouping/description/colors/numbers/totals, existing matching/conflicts, and expiry cleanup.

Fixtures are generated from invented supplier names and identifiers in source; no private real invoices or binary test artifacts are committed. Database safety tests create and remove a disposable schema, never receipt fixtures in real stock tables.

Manually test actual supplier layouts, blurred/skewed scans, merged table cells, wrapped Color Codes, long descriptions, multi-page headers, punctuation around Size:, alternative total labels, and missing labels. Wrapped color/numeric rows, non-English OCR, and uncommon invoice layouts can require parser extensions; uncertain values are intentionally not corrected. Review warnings carefully even when totals match. Browser automation has not been used.

## Files added/changed for this stage

- apps/api/src/invoice-imports/: module, controller, access/upload guards, service, config, storage abstraction, parser, reader/worker/process wrapper, cleanup command, five focused test suites, a type declaration for the multipart alias, sanitized fixture generators.
- apps/api/src/app.module.ts: registers the new module.
- apps/api/prisma/schema.prisma: adds draft model/enums and User relation.
- apps/api/prisma/migrations/20261005010000_invoice_import_drafts/migration.sql: forward migration.
- apps/api/package.json and package-lock.json: required dependencies and cleanup script.
- packages/contracts/src/index.ts: draft/review/issue/limits contracts.
- apps/web/src/lib/api.ts: multipart support and import requests.
- apps/web/src/features/purchases/purchase-receive-page.tsx: import/manual entry toggle.
- apps/web/src/features/purchases/invoice-import-panel.tsx: upload/review panel.
- .env.example and apps/api/.env.example: documented configuration.
- .gitignore: excludes default private upload storage.
- docs/invoice-import-architecture.md: this document.

Other pre-existing uncommitted supplier-invoice identity changes were preserved. No commit or push was performed.

## Final check results

- `npm run typecheck`: passed for API, web, and contracts.
- Parser-correction verification results are recorded below; the original foundation passed 103 tests across 16 files.
- `npm run build`: API and frontend production builds passed.
- Prisma validation passed; migration status is up to date; database-to-schema diff reported no difference.
- Production JavaScript reader smoke checks passed for native PDF text and PNG OCR, including matching Rolls/Meter totals.
- Cleanup command ran successfully (no expired drafts to remove).
- The invoice upload module resolves the aliased Multer 2.4.0; existing dependency versions in the lockfile were preserved.
- `git diff --check` passed. Nothing is staged; generated build/client files and default upload directories are ignored.
- Backend and shared contract files changed as explicitly authorized for this foundation. Existing unrelated uncommitted edits remain present.

## Parser correction verification

The sanitized seven-group fixture reproduces multi-word and digit-free Item No. cells, separate supplier fields, Description overflow, and table-column totals. Native PDF and relative shifted/scaled layouts must produce exactly seven groups with color counts 4, 5, 5, 5, 2, 1, 1 and totals 964 Rolls / 35050 Meter. Tests also cover missing layout, uncertain boundaries, missing item cells, repeated shifted page headers, stale cached review invalidation, and matching only the clean supplier name.

OCR tests preserve native word boxes and seven-group ownership. OCR text is never automatically corrected to force expected color identifiers. OCR preserves spelling as read. A nonempty uncertain textual color remains literal under an established item with a field warning; missing cells and uncertain ownership remain unassigned. Numeric OCR is never repaired.

The actual local supplier PDF was read privately and confirmed the exact seven names, all expected colors, clean supplier/contact fields, container B0312614, matching 964 Rolls / 35050 Meter, and zero parser warnings. The PDF and its private extracted content are not stored in this repository. No purchase, master, inventory, or confirmation behavior was added or exercised.

Final parser-correction checks: `npm run typecheck`, `npm run test` (121 tests / 17 files), and `npm run build` passed. `git diff --check` passed. Backend parser/service and shared review contracts changed within the explicitly requested scope; pre-existing unrelated edits were preserved. No commits or pushes were made.

## OCR interoperability correction

Both PDF.js and Tesseract feed the same normalized pages/lines/spans/cells and the same business parser. Spans retain page, method, text, coordinates, dimensions, and actual OCR confidence where available. Native PDF regression remains unchanged. Parser version 3 invalidates previous cached reviews so an existing upload is re-read.

Structural labels use a shared semantic vocabulary covering columns, supplier/contact fields, contract/container, Size, table sections, and totals. Matching folds case, punctuation, whitespace, full-width Unicode and limited OCR confusables only within labels. At most one edit is accepted in a sufficiently long known label. Labels from another exact semantic role cannot be reassigned by fuzzy matching. Fuzzy table headings require exact neighbors, layout agreement, and value-type evidence below; alternate column orders map by semantic role. Sparse item starts and dense color/numeric columns further support layout. A missing Meter header can be interpreted in a physical grid only when exactly one unknown column has repeated decimal values and an independently identified Rolls column. Weak evidence creates REVIEW warnings and unassigned rows.

No normalization/fuzzy repair is applied to item codes, colors, supplier names, container numbers, phone/fax, descriptions, monetary amounts, or numeric business values. Those values are sliced from original text and retained with whitespace cleanup only. Invalid numeric text or low-confidence numeric OCR is null with a warning containing raw text and page/line. Low-confidence identifiers/descriptions remain literal and warn. This stage has no editable review or confirmation route.

Preprocessing uses a white alpha/background, grayscale, mild contrast, bounded upscaling (maximum 3x, maximum 16 million pixels), and conservative projection-based deskew within 3 degrees. Detected long straight table rules are recorded before removing them from the OCR raster. Physical ruled cells supply merged Item/Description intervals and independent color/numeric rows; vertically centered names own only rows inside their physical cell interval. Original upload bytes are unchanged. No aggressive binarization or sharpening is enabled.

Segmentation was evaluated with AUTO, SPARSE_TEXT, and SINGLE_BLOCK against the local layout. Ruled pages use AUTO for full-page context, then SINGLE_BLOCK on bounded individual cell crops to preserve multiline cell text. Unruled pages explicitly use SINGLE_BLOCK to preserve row alignment, with shared geometric column recognition. If structural evidence is weak, at most three additional quarter-turn orientation passes are scored by structural labels, never expected business values. All page/pixel/text/concurrency/memory/time limits and worker cleanup remain in place. Physical cell OCR is capped at 250 cells per page; larger/weak grids use positioned full-page output.

Regression coverage includes clean/resized/blurred/mildly rotated/sideways/compressed images, scanned and mixed PDFs, all structural alias groups, typo variants, alternate semantic column order, untouched business identifiers, unresolved OCR numbers, weak-column review, ambiguous ownership, random images, misleading tables, stale review invalidation, and traps against stock/master mutations. Fixtures contain invented supplier/contact data and row values; private source files are never committed.

Private verification: the native PDF still yields 7 items / 23 colors / 964 Rolls / 35050 Meter with both totals matching and no warnings. The actual uploaded image reaches REVIEW with the same item/color counts and 964 Rolls. Its literal rows sum to 35063 Meter against declared 35050; visible source content differs from the PDF, so this is reported as a mismatch instead of repaired. Uncertain image descriptions/color text remain flagged for human review.

Final OCR verification: `npm run typecheck`, `npm run test` (267 tests / 19 files), `npm run build`, and `git diff --check` passed. A clean build was checked after clearing the ignored incremental build cache; the compiled JavaScript reader was also verified on both actual private files. Changes in this correction are confined to backend document/OCR/parser code, tests and documentation. Shared contract/frontend/schema/dependency edits from previous work were preserved without further changes. No stock/master writes, editable review, confirmation, commit, push or browser automation occurred.

## Editable review (no receipt)

`InvoiceImportDraft.parsedData` is the immutable original extraction, returned as `originalExtractedData`. Original warnings, method, declared totals, parsed totals, source locations and SHA-256 remain untouched by review saving. The forward migration `20261007000000_invoice_import_review` adds only nullable JSONB `reviewedData`. Existing drafts initialize the editor from extraction; saved drafts reopen from reviewed data.

- `PUT /api/invoice-imports/:id/review` accepts only supplier name/contact fields, Container Number, item code/optional description, and color code/Rolls/optional Meter. Optional original-row index references retain field provenance; added rows have no fabricated source. Server-owned totals, IDs, statuses and match metadata are rejected at every nesting level.
- `POST /api/invoice-imports/:id/review/reset` accepts an empty body and replaces reviewed data with a fresh copy of stored extraction, then recalculates and reruns matching. It never reads the upload or starts PDF/OCR. Original extraction remains unchanged.
- Both endpoints require authentication, an active account, draft ownership, unexpired REVIEW status and a current parser version. The existing non-simple request header/origin guard applies to PUT as well as POST. A conditional timestamp/status/expiry update prevents overwriting a concurrently changed or expired draft.
- Field validation returns `fieldErrors` with indexed paths. Required strings cannot be blank; normalized duplicate items/colors are rejected. Rolls are positive integer JSON numbers; optional Meter is a finite nonnegative JSON number with at most two decimals, consistent with Receive Purchase. No string-to-number coercion occurs in the API. Size remains optional. Payload and row/string bounds prevent unbounded review input.
- Server totals are authoritative, calculated using integer cents for Meter. The UI shows declared invoice totals, original parsed totals and reviewed totals separately, with live editing totals. Totals mismatch can be saved as REVIEW but blocks readiness. Original declared totals cannot be edited.
- Every save/reset reads supplier, container, product and textual color matching anew. Existing container, description conflict/missing existing description, archived/ambiguous matches, invalid rows, unresolved extraction ownership and uncertain source totals prevent readiness. No fuzzy match creates or updates masters.
- `hasReviewedChanges`, `validationPassed`, `readyForConfirmation` and `blockingIssues` describe the current review. Original extraction warnings remain in a separate expandable history; explicit manual review does not carry corrected OCR row warnings forward as permanent blockers. Unchanged uncertain source fields remain blocking until corrected or removed; unresolved ownership/source-total uncertainty remains blocking. Readiness does not expose a confirmation action or transition status to CONFIRMED.
- Default UI is read-only. Editing uses compact labeled supplier fields, flat item sections and desktop color columns that stack on mobile. Save returns to read-only; Cancel drops unsaved edits only. Reset prompts before discarding corrections. Switching to manual entry prompts for dirty edits and keeps saved review mounted. No global beforeunload hook or bottom-navigation change is introduced.

Review and reset write only `InvoiceImportDraft.reviewedData` (and its update timestamp). They cannot create/update Purchase, Container, Supplier, Product, ProductVariant, InventoryBatch, Roll or StockMovement. Expiry cleanup removes both original and reviewed sensitive JSON under the existing retention policy. There is still no stock confirmation endpoint, permanent document or inventory mutation.

### Files touched for editable review

These are the files changed by the editable-review step; other existing workspace changes were preserved.

- Database: `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/20261007000000_invoice_import_review/migration.sql`.
- API: `apps/api/src/invoice-imports/import-access.guard.ts`, `invoice-imports.controller.ts`, `invoice-imports.service.ts`, `invoice-review.ts`, `invoice-imports.spec.ts`, `invoice-imports.database.spec.ts` (all latter filenames in that same directory).
- Contract: `packages/contracts/src/index.ts`.
- Web: `apps/web/package.json`, `apps/web/vitest.config.ts`, `apps/web/src/lib/api.ts`, and `apps/web/src/features/purchases/{purchase-receive-page.tsx,invoice-import-panel.tsx,invoice-review-editor.tsx,invoice-review-form.ts,invoice-review-form.spec.ts}`.
- Documentation: `docs/invoice-import-architecture.md`.
