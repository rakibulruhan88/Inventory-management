ALTER TABLE "Supplier"
  ADD COLUMN "email" TEXT,
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "Supplier_email_idx" ON "Supplier"("email");

ALTER TABLE "StoreSettings"
  ADD COLUMN "invoiceSequence" INTEGER NOT NULL DEFAULT 0;

-- Continue after any existing invoice with the current prefix. Historical invoice
-- numbers themselves are deliberately left unchanged.
UPDATE "StoreSettings" AS settings
SET "invoiceSequence" = COALESCE((
  SELECT MAX(substring(sale."invoiceNumber" from '([0-9]+)$')::INTEGER)
  FROM "Sale" AS sale
  WHERE left(sale."invoiceNumber", length(settings."invoicePrefix")) = settings."invoicePrefix"
    AND sale."invoiceNumber" ~ '[0-9]+$'
), 0);
