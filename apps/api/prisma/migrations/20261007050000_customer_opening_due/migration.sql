-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'CUSTOMER_OPENING_BALANCE_CREATED';

-- AlterTable
ALTER TABLE "CustomerPaymentAllocation" ADD COLUMN     "openingBalanceId" TEXT,
ALTER COLUMN "saleId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "CustomerOpeningBalance" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "originalAmount" DECIMAL(14,2) NOT NULL,
    "balanceAsOf" DATE NOT NULL,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,

    CONSTRAINT "CustomerOpeningBalance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOpeningBalance_customerId_key" ON "CustomerOpeningBalance"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOpeningBalance_idempotencyKey_key" ON "CustomerOpeningBalance"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CustomerPaymentAllocation_openingBalanceId_idx" ON "CustomerPaymentAllocation"("openingBalanceId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPaymentAllocation_receiptId_openingBalanceId_key" ON "CustomerPaymentAllocation"("receiptId", "openingBalanceId");

-- AddForeignKey
ALTER TABLE "CustomerPaymentAllocation" ADD CONSTRAINT "CustomerPaymentAllocation_openingBalanceId_fkey" FOREIGN KEY ("openingBalanceId") REFERENCES "CustomerOpeningBalance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOpeningBalance" ADD CONSTRAINT "CustomerOpeningBalance_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOpeningBalance" ADD CONSTRAINT "CustomerOpeningBalance_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing sale allocations remain valid. Every new row identifies exactly one source.
ALTER TABLE "CustomerPaymentAllocation" ADD CONSTRAINT "CustomerPaymentAllocation_one_source_check"
 CHECK (("saleId" IS NOT NULL)::int + ("openingBalanceId" IS NOT NULL)::int = 1);
ALTER TABLE "CustomerOpeningBalance" ADD CONSTRAINT "CustomerOpeningBalance_positive_check"
 CHECK ("originalAmount" > 0);
-- Enforce ownership and opening-payment limits even for direct database writers.
CREATE FUNCTION check_customer_payment_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_customer text; receipt_customer text; original numeric; already_paid numeric;
BEGIN
 SELECT "customerId" INTO receipt_customer FROM "CustomerPaymentReceipt" WHERE id = NEW."receiptId";
 IF NEW."openingBalanceId" IS NOT NULL THEN
  SELECT "customerId", "originalAmount" INTO source_customer, original FROM "CustomerOpeningBalance"
   WHERE id = NEW."openingBalanceId" FOR UPDATE;
  SELECT COALESCE(SUM(amount), 0) INTO already_paid FROM "CustomerPaymentAllocation"
   WHERE "openingBalanceId" = NEW."openingBalanceId" AND id <> NEW.id;
  IF already_paid + NEW.amount > original THEN RAISE EXCEPTION 'Opening due overpayment' USING ERRCODE = '23514'; END IF;
 ELSE
  SELECT "customerId" INTO source_customer FROM "Sale" WHERE id = NEW."saleId";
 END IF;
 IF source_customer IS DISTINCT FROM receipt_customer THEN
  RAISE EXCEPTION 'Payment customer mismatch' USING ERRCODE = '23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER customer_payment_source_check BEFORE INSERT OR UPDATE ON "CustomerPaymentAllocation"
 FOR EACH ROW EXECUTE FUNCTION check_customer_payment_source();
