-- Historical line totals remain unchanged; unit prices are unknown.
ALTER TABLE "SaleLine" ADD COLUMN "unitPricePerRoll" DECIMAL(14,2);
