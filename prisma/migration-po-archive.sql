-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "archived_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "purchase_orders_company_id_archived_at_idx" ON "purchase_orders"("company_id", "archived_at");

