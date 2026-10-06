-- Forward-only: no rows, balances, allocations, or invoice snapshots are deleted.
ALTER TABLE "ProductVariant" RENAME COLUMN "size" TO "legacySize";
ALTER INDEX "ProductVariant_size_idx" RENAME TO "ProductVariant_legacySize_idx";
ALTER TABLE "ProductVariant" RENAME COLUMN "colorCode" TO "legacyColorCode";
ALTER TABLE "ProductVariant" ALTER COLUMN "legacyColorCode" DROP DEFAULT;
ALTER TABLE "ProductVariant" ALTER COLUMN "legacyColorCode" DROP NOT NULL;
ALTER TABLE "SaleLine" ADD COLUMN "descriptionSnapshot" TEXT;

-- Immutable archive and durable conflict report, intentionally outside active app models.
CREATE TABLE "SupplierInvoiceMigrationArchive" AS
SELECT v.*, p."itemCode", p.description AS "originalProductDescription"
FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId";
CREATE TABLE "SupplierInvoiceMigrationConflict" (
  "productId" TEXT NOT NULL,
  "itemCode" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "values" JSONB NOT NULL
);
INSERT INTO "SupplierInvoiceMigrationConflict"
SELECT p.id, p."itemCode", 'Conflicting item descriptions/sizes',
       jsonb_build_object('description', p.description, 'sizes', jsonb_agg(DISTINCT btrim(v."legacySize")))
FROM "Product" p JOIN "ProductVariant" v ON v."productId" = p.id
WHERE nullif(btrim(v."legacySize"), '') IS NOT NULL
GROUP BY p.id
HAVING count(DISTINCT btrim(v."legacySize")) > 1
 OR (nullif(btrim(p.description), '') IS NOT NULL AND bool_or(btrim(v."legacySize") <> btrim(p.description)));

WITH sizes AS (
 SELECT "productId", min(btrim("legacySize")) AS value
 FROM "ProductVariant" WHERE nullif(btrim("legacySize"), '') IS NOT NULL
 GROUP BY "productId" HAVING count(DISTINCT btrim("legacySize")) = 1
)
UPDATE "Product" p SET description = sizes.value
FROM sizes WHERE p.id = sizes."productId" AND nullif(btrim(p.description), '') IS NULL;

-- A complete supplier identifier can be recovered; fabricated hex codes cannot.
UPDATE "ProductVariant" SET color = btrim("legacyColorCode")
WHERE btrim("legacyColorCode") ~ '^[^#]+#.+$';
INSERT INTO "SupplierInvoiceMigrationConflict"
SELECT p.id, p."itemCode", 'Supplier color identifier requires verification',
 jsonb_build_object('variantId', v.id, 'color', v.color, 'legacyColorCode', v."legacyColorCode")
FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId"
WHERE v.color !~ '^[^#]+#.+$';
INSERT INTO "SupplierInvoiceMigrationConflict"
SELECT p.id, p."itemCode", 'Multiple legacy variants share one color',
 jsonb_build_object('color', upper(regexp_replace(btrim(v.color), '\s+', '', 'g')), 'variantIds', jsonb_agg(v.id))
FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId"
GROUP BY p.id, upper(regexp_replace(btrim(v.color), '\s+', '', 'g')) HAVING count(*) > 1;
-- Prefix old keys temporarily to prevent unique-key collisions during conversion.
UPDATE "ProductVariant" SET "variantKey" = 'LEGACY:' || id;
UPDATE "ProductVariant" v SET "variantKey" = upper(regexp_replace(btrim(v.color), '\s+', '', 'g'))
WHERE NOT EXISTS (SELECT 1 FROM "ProductVariant" other WHERE other."productId" = v."productId"
 AND other.id <> v.id AND upper(regexp_replace(btrim(other.color), '\s+', '', 'g')) = upper(regexp_replace(btrim(v.color), '\s+', '', 'g')));
UPDATE "Product" SET "searchText" = concat_ws(' ', "itemCode", name, description);
UPDATE "ProductVariant" v SET "searchText" = concat_ws(' ', p."itemCode", v.color)
FROM "Product" p WHERE p.id = v."productId";
-- Historical invoice fields remain untouched; descriptions were not previously snapshotted.
