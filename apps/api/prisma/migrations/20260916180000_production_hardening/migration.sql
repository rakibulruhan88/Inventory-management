ALTER TYPE "SaleStatus" ADD VALUE IF NOT EXISTS 'VOIDED';
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'SALE_VOID';
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'PURCHASE_REVERSAL';
CREATE TYPE "EmailDeliveryStatus" AS ENUM ('SENT', 'FAILED');
CREATE TYPE "AuditAction" AS ENUM ('SALE_CREATED','SALE_VOIDED','PURCHASE_RECEIVED','PURCHASE_REVERSED','STOCK_ADJUSTED','PAYMENT_RECEIVED');

ALTER TABLE "User" ADD COLUMN "username" TEXT, ADD COLUMN "email" TEXT;
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

ALTER TABLE "Customer" ADD COLUMN "email" TEXT;
CREATE INDEX "Customer_email_idx" ON "Customer"("email");

ALTER TABLE "Purchase" ADD COLUMN "correctedAt" TIMESTAMP(3), ADD COLUMN "correctionReason" TEXT;
ALTER TABLE "Payment" ADD COLUMN "voidedAt" TIMESTAMP(3);
ALTER TABLE "StockMovement" ADD COLUMN "reason" TEXT, ADD COLUMN "actorId" TEXT;

ALTER TABLE "Sale"
  ADD COLUMN "voidedAt" TIMESTAMP(3), ADD COLUMN "voidReason" TEXT,
  ADD COLUMN "customerNameSnapshot" TEXT, ADD COLUMN "customerPhoneSnapshot" TEXT,
  ADD COLUMN "customerEmailSnapshot" TEXT, ADD COLUMN "customerAddressSnapshot" TEXT,
  ADD COLUMN "storeNameSnapshot" TEXT, ADD COLUMN "storePhoneSnapshot" TEXT,
  ADD COLUMN "storeEmailSnapshot" TEXT, ADD COLUMN "storeAddressSnapshot" TEXT,
  ADD COLUMN "storeLogoSnapshot" TEXT, ADD COLUMN "currencySymbolSnapshot" TEXT;

ALTER TABLE "SaleLine"
  ADD COLUMN "itemCodeSnapshot" TEXT, ADD COLUMN "itemNameSnapshot" TEXT,
  ADD COLUMN "colorNameSnapshot" TEXT, ADD COLUMN "colorCodeSnapshot" TEXT;

UPDATE "Sale" s SET
  "customerNameSnapshot" = c.name, "customerPhoneSnapshot" = c.phone,
  "customerEmailSnapshot" = c.email, "customerAddressSnapshot" = c.address,
  "storeNameSnapshot" = st."storeName", "storePhoneSnapshot" = st."storePhone",
  "storeEmailSnapshot" = st."storeEmail", "storeAddressSnapshot" = st."storeAddress",
  "storeLogoSnapshot" = st."logoUrl", "currencySymbolSnapshot" = st."currencySymbol"
FROM "Customer" c, "StoreSettings" st WHERE s."customerId" = c.id AND st.id = 'default';

UPDATE "SaleLine" sl SET
  "itemCodeSnapshot" = p."itemCode", "itemNameSnapshot" = p.name,
  "colorNameSnapshot" = v.color, "colorCodeSnapshot" = v."colorCode"
FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId" WHERE sl."variantId" = v.id;

CREATE TABLE "InvoiceEmailLog" (
  "id" TEXT PRIMARY KEY, "saleId" TEXT NOT NULL, "recipientEmail" TEXT NOT NULL,
  "status" "EmailDeliveryStatus" NOT NULL, "failureReason" TEXT, "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoiceEmailLog_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "InvoiceEmailLog_saleId_sentAt_idx" ON "InvoiceEmailLog"("saleId", "sentAt");

CREATE TABLE "AuditLog" (
  "id" TEXT PRIMARY KEY, "action" "AuditAction" NOT NULL, "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL, "reason" TEXT, "userId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
