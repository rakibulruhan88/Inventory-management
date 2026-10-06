# Supplier invoice migration review

The forward migration `20261005000000_supplier_invoice_identity` was applied to the local Afia database on 5 October 2026. No database reset or stock deletion was used. Original variant records and their product descriptions are retained in `SupplierInvoiceMigrationArchive`; the old fields remain available as `legacySize` and `legacyColorCode`.

## Decisions needed for existing inventory

- **AL-101:** legacy variants contain both `10x10` and `12x12`. Its item description remains blank. Confirm the correct shared Description / Size from the Commercial Invoice, then explicitly edit the item in Inventory.
- **Supplier color identifiers:** nine variants have names/legacy hex values that cannot establish a supplier color number. Verify the actual codes for AL-101 (Black, Brown, Navy, white), AL-205 (Tan), QA-SIZE-0916 (Test Brown), T639 (`#2black`), and rt-3423 (black, blue). Update each Color Code explicitly in Inventory; no codes were invented.
- No duplicate normalized supplier colors were found during the local migration. In another database, duplicates remain separate with their original stock, references, and archive records; receiving an ambiguous color is blocked instead of choosing a variant.

## Backfill and compatibility

An item description is backfilled only when all nonblank legacy sizes agree and the current product description is blank. Existing nonblank descriptions are preserved. Size disagreements and description mismatches are recorded in `SupplierInvoiceMigrationConflict`.

A legacy non-hex complete supplier code such as `02#Pine green` is recovered into `color`; otherwise the existing color text is preserved and reported for verification. Variant identity now uses normalized supplier color alone. The archive retains every original identity and field.

Historical sale snapshots remain untouched. New sales snapshot the product description and complete supplier color. Historic invoices with no description snapshot continue to show their recorded item name without inserting today's item description.

Both migration evidence tables are retained in the Prisma schema as ignored, read-only models to prevent future migration generation from treating them as disposable tables. The conflict report is immutable evidence, not a live resolution tracker.

Review all migration findings:

```sql
SELECT "itemCode", reason, "values"
FROM "SupplierInvoiceMigrationConflict"
ORDER BY "itemCode", reason;
```

Receive Purchase now submits grouped `items: [{ itemCode, description, colors: [{ color, rolls, totalMeter }] }]`. Clients must deploy the corrected API and frontend together. Existing authentication, stock calculations, batch history, reversal rules, and invoice numbering remain in place.
