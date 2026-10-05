CREATE TYPE "StockMovementType" AS ENUM ('PURCHASE', 'SALE', 'PAYMENT_REVERSAL', 'ADJUSTMENT');

ALTER TABLE "ProductVariant" ADD COLUMN "colorCode" TEXT NOT NULL DEFAULT '#8B5A2B';
ALTER TABLE "InventoryBatch"
  ADD COLUMN "originalRolls" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "originalMeter" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "availableRolls" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "availableMeter" DECIMAL(12,2) NOT NULL DEFAULT 0;

UPDATE "InventoryBatch" b SET
  "originalRolls" = r.roll_count,
  "originalMeter" = r.original_meter,
  "availableRolls" = r.available_rolls,
  "availableMeter" = r.available_meter
FROM (
  SELECT "batchId", COUNT(*)::INTEGER AS roll_count,
    COALESCE(SUM("originalMeter"), 0) AS original_meter,
    COUNT(*) FILTER (WHERE "remainingMeter" > 0)::INTEGER AS available_rolls,
    COALESCE(SUM("remainingMeter"), 0) AS available_meter
  FROM "Roll" GROUP BY "batchId"
) r WHERE b.id = r."batchId";

ALTER TABLE "SaleLine"
  ADD COLUMN "rollsSold" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "discount" DECIMAL(14,2) NOT NULL DEFAULT 0;

CREATE TABLE "SaleBatchAllocation" (
  "id" TEXT NOT NULL,
  "saleLineId" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "rollsSold" INTEGER NOT NULL DEFAULT 0,
  "meterSold" DECIMAL(12,2) NOT NULL,
  "rollsBefore" INTEGER NOT NULL,
  "rollsAfter" INTEGER NOT NULL,
  "meterBefore" DECIMAL(12,2) NOT NULL,
  "meterAfter" DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SaleBatchAllocation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SaleBatchAllocation_saleLineId_batchId_key" ON "SaleBatchAllocation"("saleLineId", "batchId");
CREATE INDEX "SaleBatchAllocation_batchId_idx" ON "SaleBatchAllocation"("batchId");

CREATE TABLE "StockMovement" (
  "id" TEXT NOT NULL,
  "type" "StockMovementType" NOT NULL,
  "variantId" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "rollsChange" INTEGER NOT NULL DEFAULT 0,
  "meterChange" DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StockMovement_variantId_createdAt_idx" ON "StockMovement"("variantId", "createdAt");
CREATE INDEX "StockMovement_batchId_createdAt_idx" ON "StockMovement"("batchId", "createdAt");

CREATE TABLE "StoreSettings" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "storeName" TEXT NOT NULL DEFAULT 'Afia Leather',
  "logoUrl" TEXT,
  "faviconUrl" TEXT,
  "storePhone" TEXT,
  "storeEmail" TEXT,
  "storeAddress" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'BDT',
  "currencySymbol" TEXT NOT NULL DEFAULT '৳',
  "invoicePrefix" TEXT NOT NULL DEFAULT 'AF-',
  "defaultPaymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH',
  "lowStockRollThreshold" INTEGER NOT NULL DEFAULT 3,
  "lowStockMeterThreshold" DECIMAL(12,2) NOT NULL DEFAULT 500,
  "brandAccent" TEXT NOT NULL DEFAULT '#9A5B35',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StoreSettings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SaleBatchAllocation" ADD CONSTRAINT "SaleBatchAllocation_saleLineId_fkey" FOREIGN KEY ("saleLineId") REFERENCES "SaleLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SaleBatchAllocation" ADD CONSTRAINT "SaleBatchAllocation_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InventoryBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InventoryBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "StoreSettings" ("id", "updatedAt") VALUES ('default', CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;
