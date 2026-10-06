-- CreateEnum
CREATE TYPE "InvoiceImportStatus" AS ENUM ('UPLOADED', 'PARSING', 'REVIEW', 'FAILED', 'CONFIRMED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "InvoiceParsingMethod" AS ENUM ('PDF_TEXT', 'OCR', 'HYBRID');

-- CreateTable
CREATE TABLE "InvoiceImportDraft" (
    "id" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "sha256Hash" TEXT NOT NULL,
    "temporaryStorageKey" TEXT NOT NULL,
    "status" "InvoiceImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "parsingMethod" "InvoiceParsingMethod",
    "parsedData" JSONB,
    "parseWarnings" JSONB,
    "parseErrors" JSONB,
    "detectedSupplierName" TEXT,
    "detectedContainerNumber" TEXT,
    "detectedInvoiceTotalRolls" INTEGER,
    "detectedInvoiceTotalMeter" DECIMAL(12,2),
    "parsedTotalRolls" INTEGER,
    "parsedTotalMeter" DECIMAL(12,2),
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceImportDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceImportDraft_sha256Hash_idx" ON "InvoiceImportDraft"("sha256Hash");

-- CreateIndex
CREATE INDEX "InvoiceImportDraft_uploadedById_status_idx" ON "InvoiceImportDraft"("uploadedById", "status");

-- CreateIndex
CREATE INDEX "InvoiceImportDraft_expiresAt_status_idx" ON "InvoiceImportDraft"("expiresAt", "status");

-- AddForeignKey
ALTER TABLE "InvoiceImportDraft" ADD CONSTRAINT "InvoiceImportDraft_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
