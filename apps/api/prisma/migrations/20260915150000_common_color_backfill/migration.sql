UPDATE "ProductVariant" SET "colorCode" = CASE LOWER("color")
  WHEN 'black' THEN '#000000'
  WHEN 'white' THEN '#FFFFFF'
  WHEN 'red' THEN '#C0392B'
  WHEN 'brown' THEN '#8B5A2B'
  WHEN 'green' THEN '#2E7D32'
  WHEN 'blue' THEN '#1565C0'
  WHEN 'grey' THEN '#808080'
  WHEN 'gray' THEN '#808080'
  WHEN 'beige' THEN '#F5F5DC'
  WHEN 'tan' THEN '#D2B48C'
  WHEN 'navy' THEN '#000080'
  ELSE "colorCode"
END;
