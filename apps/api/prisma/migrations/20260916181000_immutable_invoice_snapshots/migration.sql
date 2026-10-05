CREATE OR REPLACE FUNCTION "prevent_sale_snapshot_change"()
RETURNS TRIGGER AS $$
BEGIN
  IF ROW(
    NEW."customerNameSnapshot", NEW."customerPhoneSnapshot", NEW."customerEmailSnapshot", NEW."customerAddressSnapshot",
    NEW."storeNameSnapshot", NEW."storePhoneSnapshot", NEW."storeEmailSnapshot", NEW."storeAddressSnapshot",
    NEW."storeLogoSnapshot", NEW."currencySymbolSnapshot"
  ) IS DISTINCT FROM ROW(
    OLD."customerNameSnapshot", OLD."customerPhoneSnapshot", OLD."customerEmailSnapshot", OLD."customerAddressSnapshot",
    OLD."storeNameSnapshot", OLD."storePhoneSnapshot", OLD."storeEmailSnapshot", OLD."storeAddressSnapshot",
    OLD."storeLogoSnapshot", OLD."currencySymbolSnapshot"
  ) THEN
    RAISE EXCEPTION 'Invoice snapshots are immutable after sale creation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Sale_snapshot_immutable"
BEFORE UPDATE ON "Sale"
FOR EACH ROW EXECUTE FUNCTION "prevent_sale_snapshot_change"();

CREATE OR REPLACE FUNCTION "prevent_sale_line_snapshot_change"()
RETURNS TRIGGER AS $$
BEGIN
  IF ROW(NEW."itemCodeSnapshot", NEW."itemNameSnapshot", NEW."colorNameSnapshot", NEW."colorCodeSnapshot")
     IS DISTINCT FROM
     ROW(OLD."itemCodeSnapshot", OLD."itemNameSnapshot", OLD."colorNameSnapshot", OLD."colorCodeSnapshot") THEN
    RAISE EXCEPTION 'Invoice line snapshots are immutable after sale creation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "SaleLine_snapshot_immutable"
BEFORE UPDATE ON "SaleLine"
FOR EACH ROW EXECUTE FUNCTION "prevent_sale_line_snapshot_change"();
