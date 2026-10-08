-- Prisma may assign individual creation timestamps rather than PostgreSQL now().
-- Checkout Payment is inserted after Sale and before its SALE_CREATED audit,
-- inside that atomic transaction; another request cannot see the Sale until commit.
-- Require the original applied amount and exactly one candidate in that audited
-- creation interval. This is posting provenance, not a time-proximity guess.
-- No amounts, balances, receipt identities or existing classifications are changed.
UPDATE "Payment" p SET "cashbookType" = 'SALE_PAYMENT'
FROM "Sale" s WHERE p."cashbookType" IS NULL
AND p."saleId" = s.id AND p."customerId" = s."customerId"
AND p.amount = s."receivedAmount" - s."changeAmount"
AND p."createdAt" >= s."createdAt"
AND EXISTS (
  SELECT 1 FROM "AuditLog" a WHERE a.action = 'SALE_CREATED'
  AND a."entityType" = 'Sale' AND a."entityId" = s.id
  AND a."createdAt" >= p."createdAt"
  AND (SELECT COUNT(*) FROM "Payment" candidate
       WHERE candidate."saleId" = s.id AND candidate."customerId" = s."customerId"
       AND candidate.amount = s."receivedAmount" - s."changeAmount"
       AND candidate."createdAt" >= s."createdAt"
       AND candidate."createdAt" <= a."createdAt") = 1
)
AND NOT EXISTS (
  SELECT 1 FROM "AuditLog" a WHERE a.action = 'PAYMENT_RECEIVED'
  AND a."entityId" = p."customerId" AND a."createdAt" = p."createdAt"
);
