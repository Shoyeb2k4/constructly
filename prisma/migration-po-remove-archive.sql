-- DropIndex
DROP INDEX "purchase_orders_company_id_archived_at_idx";

-- AlterTable
ALTER TABLE "purchase_orders" DROP COLUMN "archived_at";


-- Deleting a PO that others were "revised from" must null the link, not block.
ALTER TABLE "purchase_orders" DROP CONSTRAINT IF EXISTS "purchase_orders_revised_from_id_fkey";
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_revised_from_id_fkey"
  FOREIGN KEY ("revised_from_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
