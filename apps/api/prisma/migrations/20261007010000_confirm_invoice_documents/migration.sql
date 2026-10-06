-- CreateEnum
CREATE TYPE "PurchaseDocumentType" AS ENUM ('COMMERCIAL_INVOICE');

-- AlterTable
ALTER TABLE "InvoiceImportDraft" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedPurchaseId" TEXT;

-- CreateTable
CREATE TABLE "PurchaseDocument" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "documentType" "PurchaseDocumentType" NOT NULL DEFAULT 'COMMERCIAL_INVOICE',
    "originalFileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "sha256Hash" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseDocument_purchaseId_key" ON "PurchaseDocument"("purchaseId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseDocument_storageKey_key" ON "PurchaseDocument"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseDocument_sha256Hash_key" ON "PurchaseDocument"("sha256Hash");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceImportDraft_confirmedPurchaseId_key" ON "InvoiceImportDraft"("confirmedPurchaseId");

-- AddForeignKey
ALTER TABLE "InvoiceImportDraft" ADD CONSTRAINT "InvoiceImportDraft_confirmedPurchaseId_fkey" FOREIGN KEY ("confirmedPurchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseDocument" ADD CONSTRAINT "PurchaseDocument_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseDocument" ADD CONSTRAINT "PurchaseDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
