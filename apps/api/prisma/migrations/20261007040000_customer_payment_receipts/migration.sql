-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'CUSTOMER_PAYMENT_RECEIVED';

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "metadata" JSONB;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "outstandingAfterSale" DECIMAL(14,2),
ADD COLUMN     "previousOutstandingBeforeSale" DECIMAL(14,2);

-- CreateTable
CREATE TABLE "CustomerPaymentReceipt" (
    "id" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "outstandingBefore" DECIMAL(14,2) NOT NULL,
    "outstandingAfter" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "CustomerPaymentReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPaymentAllocation" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "previousDue" DECIMAL(14,2) NOT NULL,
    "remainingDue" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerPaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPaymentReceipt_receiptNumber_key" ON "CustomerPaymentReceipt"("receiptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPaymentReceipt_idempotencyKey_key" ON "CustomerPaymentReceipt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CustomerPaymentReceipt_customerId_paidAt_idx" ON "CustomerPaymentReceipt"("customerId", "paidAt");

-- CreateIndex
CREATE INDEX "CustomerPaymentAllocation_saleId_idx" ON "CustomerPaymentAllocation"("saleId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPaymentAllocation_receiptId_saleId_key" ON "CustomerPaymentAllocation"("receiptId", "saleId");

-- AddForeignKey
ALTER TABLE "CustomerPaymentReceipt" ADD CONSTRAINT "CustomerPaymentReceipt_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPaymentReceipt" ADD CONSTRAINT "CustomerPaymentReceipt_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPaymentAllocation" ADD CONSTRAINT "CustomerPaymentAllocation_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "CustomerPaymentReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPaymentAllocation" ADD CONSTRAINT "CustomerPaymentAllocation_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Database sequence is concurrency safe. Gaps after rollback are intentional.
CREATE SEQUENCE "customer_payment_receipt_sequence";
ALTER TABLE "CustomerPaymentReceipt" ADD CONSTRAINT "receipt_positive_amount" CHECK ("totalAmount" > 0 AND "outstandingBefore" >= "totalAmount" AND "outstandingAfter" = "outstandingBefore" - "totalAmount");
ALTER TABLE "CustomerPaymentAllocation" ADD CONSTRAINT "allocation_valid_amount" CHECK ("amount" > 0 AND "previousDue" >= "amount" AND "remainingDue" = "previousDue" - "amount");
