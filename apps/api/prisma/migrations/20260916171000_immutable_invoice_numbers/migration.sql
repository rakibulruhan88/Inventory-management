CREATE OR REPLACE FUNCTION "prevent_sale_invoice_number_change"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."invoiceNumber" IS DISTINCT FROM OLD."invoiceNumber" THEN
    RAISE EXCEPTION 'Invoice numbers are immutable after sale creation'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Sale_invoiceNumber_immutable"
BEFORE UPDATE OF "invoiceNumber" ON "Sale"
FOR EACH ROW
EXECUTE FUNCTION "prevent_sale_invoice_number_change"();
