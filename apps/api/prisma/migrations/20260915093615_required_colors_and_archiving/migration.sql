/*
  Warnings:

  - Made the column `color` on table `ProductVariant` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ALTER COLUMN "color" SET NOT NULL;
