-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'FINANCIAL_ENTRY_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'FINANCIAL_ENTRY_VOIDED';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "cashbookType" TEXT;

-- CreateTable
CREATE TABLE "FinancialEntry" (
    "id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "expenseType" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "supplierId" TEXT,
    "purchaseId" TEXT,
    "containerId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidedBy" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "FinancialEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FinancialEntry_idempotencyKey_key" ON "FinancialEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "FinancialEntry_occurredAt_id_idx" ON "FinancialEntry"("occurredAt", "id");

-- CreateIndex
CREATE INDEX "FinancialEntry_supplierId_idx" ON "FinancialEntry"("supplierId");

-- CreateIndex
CREATE INDEX "FinancialEntry_purchaseId_idx" ON "FinancialEntry"("purchaseId");

-- CreateIndex
CREATE INDEX "FinancialEntry_containerId_idx" ON "FinancialEntry"("containerId");

-- AddForeignKey
ALTER TABLE "FinancialEntry" ADD CONSTRAINT "FinancialEntry_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialEntry" ADD CONSTRAINT "FinancialEntry_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialEntry" ADD CONSTRAINT "FinancialEntry_containerId_fkey" FOREIGN KEY ("containerId") REFERENCES "Container"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialEntry" ADD CONSTRAINT "FinancialEntry_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialEntry" ADD CONSTRAINT "FinancialEntry_voidedBy_fkey" FOREIGN KEY ("voidedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Historical classification requires posting evidence, never a date proximity guess.
-- PostgreSQL now() is constant within the original Sale transaction.
UPDATE "Payment" p SET "cashbookType" = 'SALE_PAYMENT'
FROM "Sale" s WHERE p."saleId" = s.id AND p."customerId" = s."customerId"
AND p."createdAt" = s."createdAt" AND p.amount = s."receivedAmount" - s."changeAmount"
AND EXISTS (SELECT 1 FROM "AuditLog" a WHERE a.action = 'SALE_CREATED' AND a."entityId" = s.id AND a."createdAt" = p."createdAt")
AND NOT EXISTS (SELECT 1 FROM "AuditLog" a WHERE a.action = 'PAYMENT_RECEIVED' AND a."entityId" = p."customerId" AND a."createdAt" = p."createdAt");
UPDATE "Payment" p SET "cashbookType" = 'DUE_PAYMENT'
WHERE p."cashbookType" IS NULL
AND EXISTS (SELECT 1 FROM "AuditLog" a WHERE a.action = 'PAYMENT_RECEIVED' AND a."entityType" = 'Customer' AND a."entityId" = p."customerId" AND a."createdAt" = p."createdAt")
AND NOT EXISTS (SELECT 1 FROM "Sale" s WHERE s.id = p."saleId" AND s."createdAt" = p."createdAt");
ALTER TABLE "Payment" ADD CONSTRAINT "payment_cashbook_type" CHECK ("cashbookType" IS NULL OR "cashbookType" IN ('SALE_PAYMENT','DUE_PAYMENT'));
ALTER TABLE "FinancialEntry" ADD CONSTRAINT "finance_positive" CHECK (amount > 0);
ALTER TABLE "FinancialEntry" ADD CONSTRAINT "finance_category" CHECK (
(type = 'OTHER_IN' AND direction = 'IN') OR (type IN ('SUPPLIER_PAYMENT','EXPENSE','OTHER_OUT') AND direction = 'OUT'));
ALTER TABLE "FinancialEntry" ADD CONSTRAINT "finance_supplier" CHECK ((type = 'SUPPLIER_PAYMENT' AND "supplierId" IS NOT NULL) OR (type <> 'SUPPLIER_PAYMENT' AND "supplierId" IS NULL AND "purchaseId" IS NULL AND "containerId" IS NULL));
ALTER TABLE "FinancialEntry" ADD CONSTRAINT "finance_expense" CHECK ((type = 'EXPENSE' AND "expenseType" IN ('Transport','Loading','Rent','Electricity','Salary','Food','Delivery','Office','Repair','Other') AND "expenseType" IS NOT NULL) OR (type <> 'EXPENSE' AND "expenseType" IS NULL));
ALTER TABLE "FinancialEntry" ADD CONSTRAINT "finance_void" CHECK (("voidedAt" IS NULL AND "voidedBy" IS NULL AND "voidReason" IS NULL) OR ("voidedAt" IS NOT NULL AND "voidedBy" IS NOT NULL AND length(trim("voidReason")) > 0 AND "voidReason" IS NOT NULL));
