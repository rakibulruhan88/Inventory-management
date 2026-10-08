BEGIN;
-- Prevent customer writes between the duplicate check, backfill, and uniqueness.
LOCK TABLE "Customer" IN SHARE ROW EXCLUSIVE MODE;
-- Migration-only equivalent of the shared normalizeCustomerPhone function.
-- Parity is verified against the shared implementation in migration tests.
CREATE TEMP TABLE "_CustomerPhoneBackfill" ON COMMIT DROP AS
WITH cleaned AS (
  SELECT id, btrim(phone, E' \t\r\n\f' || chr(11)) AS clean FROM "Customer"
), grouped AS (
  SELECT id, clean, regexp_replace(clean, '\(([0-9]+)\)', '\1', 'g') AS grouped FROM cleaned
), compacted AS (
  SELECT id, clean, grouped, regexp_replace(grouped, '[ -]', '', 'g') AS compact FROM grouped
)
SELECT id, CASE
  WHEN length(clean) <= 50 AND clean ~ '^[+]?[0-9 ()-]+$'
    AND grouped ~ '^[+]?[0-9]+(( +| *- *)[0-9]+)*$'
  THEN CASE
    WHEN compact ~ '^01[3-9][0-9]{8}$' THEN '88' || compact
    WHEN compact ~ '^[+]?8801[3-9][0-9]{8}$' THEN replace(compact, '+', '')
    ELSE NULL END
  ELSE NULL END AS normalized
FROM compacted;
DO $$
BEGIN
  IF EXISTS (SELECT normalized FROM "_CustomerPhoneBackfill" WHERE normalized IS NOT NULL GROUP BY normalized HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Customer phone identity migration blocked: duplicate normalized phones. Run customer-phone:audit and obtain owner decisions. No customers were merged.';
  END IF;
END $$;
ALTER TABLE "Customer" ADD COLUMN "normalizedPhone" TEXT;
UPDATE "Customer" c SET "normalizedPhone" = b.normalized FROM "_CustomerPhoneBackfill" b WHERE c.id = b.id;
CREATE UNIQUE INDEX "Customer_normalizedPhone_key" ON "Customer"("normalizedPhone");
COMMIT;
