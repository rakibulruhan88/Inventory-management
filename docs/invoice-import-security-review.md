# Invoice confirmation and document-access security review

## Result and scope

The dedicated second pass reviewed TypeScript/NestJS on Express, Prisma/PostgreSQL, local source storage and React UI against the security-best-practices Express/React guidance. No unresolved critical/high issue was found in the changed confirmation/archive/access path. Findings below were fixed and regression-tested during this task; this is a scoped code review, not a deployment penetration test.

Review covered multipart/source trust, document serving, traversal and symlinks, disposition/header injection, authentication/active users/ownership/IDOR, concurrency and duplicate races, transaction boundaries, mass assignment, filesystem compensation and safe errors. No unrelated dependency upgrade or authentication rewrite was performed.

## High-severity findings corrected

### 1. Compensation must wait for an uncertain commit outcome

Deleting a generated archive immediately after a transaction error could remove evidence while a disconnected COMMIT was still settling. Compensation now reacquires the same database draft lock before checking the committed document key; it removes only an unreferenced copy. Database unavailability/cleanup uncertainty retains the copy for recovery. Both fully committed lost-response and still-settling commit cases are tested.

Evidence: `apps/api/src/invoice-imports/invoice-confirmation.service.ts:263–290`; regression tests at `invoice-confirmation.spec.ts:702` and `:731`.

### 2. Cleanup must never confuse permanent and temporary references

The reused removal abstraction originally needed separate permanent semantics: recursively removing a container directory would risk other archived evidence. Permanent removal now deletes only the exact generated file and optionally an empty directory. Confirmation retries/expiry cleanup require a strict temporary key. They verify the permanent archive before deleting recoverable temporary bytes. Tests cover a corrupted temp reference pointing at a permanent invoice, missing archive recovery and multiple files in one archive directory.

Evidence: `invoice-storage.ts:131–151`, `invoice-confirmation.service.ts:83–87` and `:306–335`, `invoice-imports.service.ts:478–529`; tests `invoice-confirmation.spec.ts:834`, `:1069` and `:1112`.

### 3. Symlink aliases must not provide an arbitrary-read/delete path

A key-format check alone is insufficient when directories/files can be symlinked. The adapter checks canonical parent equality inside the private root, verifies the canonical file and opens with O_NOFOLLOW. Permanent creation is exclusive, mode 0600, and flushes bytes/directory entries before commit. No API accepts a filesystem path or storage key.

Evidence: `invoice-storage.ts:53–126`; symlink and targeted-removal regression at `invoice-confirmation.spec.ts:1069`.

## Medium-severity findings corrected

### 4. Uploaded/stored metadata must not become response headers unchecked

Document content revalidates stored MIME against original signature/extension, size and SHA-256 before serving. Content-Disposition strips controls/path components, uses a restricted ASCII fallback and encoded Unicode filename. Forged MIME, CRLF filenames, traversal/manipulated keys, missing files and changed hashes return safe errors. The view/download responses have nosniff, private no-store and sandbox CSP.

Evidence: `purchase-documents.service.ts:30–57`, `purchase-documents.ts:20–33`, `purchase-documents.controller.ts:29–48`; security tests `invoice-confirmation.spec.ts:918` and `:957`.

### 5. Cached readiness and frontend click protection are insufficient

The empty confirmation DTO rejects force/other client fields. The backend reloads owned draft/active actor, restores immutable source totals/warnings, recalculates and rematches inside the transaction. Draft/hash/supplier/sorted-item advisory locks plus unique source/Purchase/Container constraints prevent duplicate receipt. Confirmed retries return the original purchase, including reversed purchases. No partial stock/master/document records survive tested failures.

Evidence: `invoice-confirmation.service.ts:53–142`, `:209–260`; `invoice-imports.service.ts:325–356`; migration `20261007010000_confirm_invoice_documents/migration.sql`. Tests cover two simultaneous requests, another owner's same hash, separate container races, stale blockers, forced flags, concurrent review saving and halfway/document-insert rollback.

## Access and trust-boundary checks

- Global JWT authentication and active-user guard protect new routes. Only the uploader can confirm/read/edit private drafts; another owner receives a safe 404. Active staff/owners may access confirmed purchase documents under existing shared business-record policy. This is deliberate application access, not draft ownership leakage.
- Mutating import routes retain custom-header/preflight and cookie Origin checks. No GET performs stock changes. User activity is checked again under a database row lock before receipt.
- Multipart byte limits, signature/MIME/extension checks, bounded local PDF/OCR processing and private generated filenames are retained. Confirmation archives the original bytes, never OCR/preprocessing output, and rechecks hash. No whole storage directory is statically served.
- Safe response mappers omit roots/keys. SQL values use parameterized raw queries. Editable review is allowlisted; supplier input maps only intentionally supported master fields. Frontend filenames/messages use escaped JSX; document URLs derive from the fixed API endpoint and encoded document ID.
- Server-side failures expose actionable messages without SQL, filesystem paths or stack traces. Recovery logs identify the import without dumping document bytes or private paths.

## Business-rule diff review

A read-only comparison against the snapshot taken before this task verified that the receipt extraction retains the same supplier rules, product description conflict rule, textual variant handling, batch/line/movement calculations and PURCHASE_RECEIVED audit. The additional sorted locks coordinate all receipt paths; stock arithmetic is unchanged. Purchase reversal is byte-identical to the pre-task implementation. Sales, Inventory service/calculations and existing sales invoice-number implementation are unchanged by this task. Imported purchases use existing reversal restrictions and keep their source documents/history.

Tests explicitly receive and reverse a manual purchase, reject conflict/invalid receipt cases, and receive/reverse an imported purchase while verifying archive retention and idempotent retry. Item Description / Size remains optional and at Product level; Meter remains optional, never fabricated from Rolls.

## Operational limits

Filesystem and database cannot form one distributed atomic transaction. A hard crash may leave an unreferenced generated archive copy; reconcile against DB document keys before removal. When commit outcome cannot be checked, retention takes priority over deletion. PostgreSQL and the private storage need coordinated backups. External disk loss produces an unavailable-source response and retains any recorded recovery temp. Upload validation is not malware scanning or invoice authenticity verification. These limits are documented without adding a global activity/orphan-sweeper architecture.

## Verification

This stage adds 59 tests; the complete suite passed with 370 API plus 19 frontend tests (389). Confirmation/security tests use generated fixtures and an isolated PostgreSQL schema. Full typecheck, all 389 tests, clean production build, Prisma validation, migration status and database/schema diff passed. Git whitespace/file checks passed and no temporary/upload files are tracked. Browser automation was not used; user browser checks remain necessary for native PDF/image display and responsive interaction.
