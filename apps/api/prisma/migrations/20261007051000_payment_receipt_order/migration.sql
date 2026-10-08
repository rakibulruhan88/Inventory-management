-- Support the stable global receipt ledger order without changing financial rows.
CREATE INDEX "CustomerPaymentReceipt_paidAt_createdAt_id_idx" ON "CustomerPaymentReceipt"("paidAt", "createdAt", "id");
