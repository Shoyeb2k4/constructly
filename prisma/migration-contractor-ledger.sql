-- CreateEnum
CREATE TYPE "ContractorLedgerType" AS ENUM ('OPENING_ADVANCE', 'ADVANCE', 'LABOUR_BILL', 'ADJUSTMENT', 'PAYMENT');

-- AlterTable
ALTER TABLE "contractors" ADD COLUMN     "opening_advance_paise" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "labour_attendance" ADD COLUMN     "contractor_id" UUID;

-- CreateTable
CREATE TABLE "contractor_ledger_entries" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "contractor_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "type" "ContractorLedgerType" NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "advance_balance_after_paise" INTEGER NOT NULL,
    "notes" TEXT,
    "settlement_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contractor_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contractor_settlements" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "contractor_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "labour_bill_paise" INTEGER NOT NULL,
    "advance_adjustment_paise" INTEGER NOT NULL DEFAULT 0,
    "net_payment_paise" INTEGER NOT NULL,
    "advance_balance_after_paise" INTEGER NOT NULL,
    "notes" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contractor_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contractor_ledger_entries_company_id_contractor_id_created__idx" ON "contractor_ledger_entries"("company_id", "contractor_id", "created_at");

-- CreateIndex
CREATE INDEX "contractor_ledger_entries_company_id_settlement_id_idx" ON "contractor_ledger_entries"("company_id", "settlement_id");

-- CreateIndex
CREATE INDEX "contractor_settlements_company_id_contractor_id_created_at_idx" ON "contractor_settlements"("company_id", "contractor_id", "created_at");

-- CreateIndex
CREATE INDEX "contractor_settlements_company_id_project_id_idx" ON "contractor_settlements"("company_id", "project_id");

-- CreateIndex
CREATE INDEX "labour_attendance_company_id_contractor_id_date_idx" ON "labour_attendance"("company_id", "contractor_id", "date");

-- AddForeignKey
ALTER TABLE "contractor_ledger_entries" ADD CONSTRAINT "contractor_ledger_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_ledger_entries" ADD CONSTRAINT "contractor_ledger_entries_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_ledger_entries" ADD CONSTRAINT "contractor_ledger_entries_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "contractor_settlements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_settlements" ADD CONSTRAINT "contractor_settlements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_settlements" ADD CONSTRAINT "contractor_settlements_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contractor_settlements" ADD CONSTRAINT "contractor_settlements_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labour_attendance" ADD CONSTRAINT "labour_attendance_contractor_id_fkey" FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Row-Level Security (tenant-scoped, mirrors prisma/rls.sql) ──────────
ALTER TABLE public.contractor_ledger_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY contractor_ledger_entries_tenant ON public.contractor_ledger_entries
  FOR ALL USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());

ALTER TABLE public.contractor_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY contractor_settlements_tenant ON public.contractor_settlements
  FOR ALL USING (company_id = public.current_company_id())
  WITH CHECK (company_id = public.current_company_id());
