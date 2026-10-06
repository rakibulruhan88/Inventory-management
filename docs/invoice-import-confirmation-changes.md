# Confirmation-stage changed files

Compared against the clean working-tree snapshot taken before this task. 36 files added or modified, including this inventory. Backend, Prisma and shared contract changes were explicitly authorized. No Sales, Inventory service, sales-invoice implementation, dependency manifests or previous migration changed.

- `apps/api/prisma/migrations/20261007010000_confirm_invoice_documents/migration.sql`
- `apps/api/prisma/schema.prisma`
- `apps/api/src/containers/containers.service.ts`
- `apps/api/src/invoice-imports/commercial-invoice-parser.ts`
- `apps/api/src/invoice-imports/fixtures/confirmation-database.ts`
- `apps/api/src/invoice-imports/invoice-confirmation.service.ts`
- `apps/api/src/invoice-imports/invoice-confirmation.spec.ts`
- `apps/api/src/invoice-imports/invoice-date.spec.ts`
- `apps/api/src/invoice-imports/invoice-date.ts`
- `apps/api/src/invoice-imports/invoice-imports.controller.ts`
- `apps/api/src/invoice-imports/invoice-imports.module.ts`
- `apps/api/src/invoice-imports/invoice-imports.service.ts`
- `apps/api/src/invoice-imports/invoice-imports.spec.ts`
- `apps/api/src/invoice-imports/invoice-review.ts`
- `apps/api/src/invoice-imports/invoice-storage.ts`
- `apps/api/src/invoice-imports/purchase-documents.controller.ts`
- `apps/api/src/invoice-imports/purchase-documents.service.ts`
- `apps/api/src/invoice-imports/purchase-documents.ts`
- `apps/api/src/purchases/purchases.controller.ts`
- `apps/api/src/purchases/purchases.module.ts`
- `apps/api/src/purchases/purchases.service.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/features/purchases/invoice-confirmation.tsx`
- `apps/web/src/features/purchases/invoice-import-panel.tsx`
- `apps/web/src/features/purchases/invoice-review-editor.tsx`
- `apps/web/src/features/purchases/invoice-review-form.spec.ts`
- `apps/web/src/features/purchases/invoice-review-form.ts`
- `apps/web/src/features/purchases/purchase-details-page.tsx`
- `apps/web/src/features/purchases/purchase-receive-page.tsx`
- `apps/web/src/features/purchases/source-document.tsx`
- `apps/web/src/features/records/records-pages.tsx`
- `apps/web/src/lib/api.ts`
- `docs/invoice-import-architecture.md`
- `docs/invoice-import-confirmation-changes.md`
- `docs/invoice-import-security-review.md`
- `packages/contracts/src/index.ts`

## Browser verification

- Import the supplier PDF; verify Purchase Date 2026-09-30, an editable manual-style Purchase Reference, Container B0312614, 7 items / 23 colors / 964 Rolls / 35,050 Meter. Resolve any existing-container/master blockers before confirming.
- Correct an OCR review, save and confirm only when blockers clear. Check the explicit summary sheet, immediate busy state, success totals and failure/retry without losing edits.
- Double-click and refresh/retry the same draft; verify only one purchase and one stock increase. Re-upload identical bytes under a different filename/account and verify receipt is blocked.
- Open Purchase and Container source controls; view PDF/JPG/PNG and download the original. Verify filenames, mobile layout and logged-out access rejection.
- Receive/reverse a disposable manual purchase, then reverse a disposable imported purchase while stock is untouched. Verify existing stock rules and source retention. Never use a live receipt for a destructive test.

## Verification

Typecheck, all 389 tests, clean production build, Prisma validate/migration status/DB-schema diff and Git whitespace/file checks passed. No source/temp upload files are tracked. No browser automation, commit or push was performed. The global Activity page was not implemented.
