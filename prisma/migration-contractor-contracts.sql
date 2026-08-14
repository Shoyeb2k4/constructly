-- Constructly — Contractor commercial agreements, milestones & reconciliation.
--
-- ┌─ EXECUTION (production) ─────────────────────────────────────────────────┐
-- │ STANDALONE hand-authored SQL migration — same mechanism as the other      │
-- │ prisma/migration-*.sql files. This project does NOT use Prisma Migrate.   │
-- │ Apply EXACTLY ONCE, directly, in lockstep with the code deploy that reads │
-- │ the new tables:                                                           │
-- │                                                                           │
-- │     psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -1 \                            │
-- │       -f prisma/migration-contractor-contracts.sql                        │
-- │                                                                           │
-- │ ($DIRECT_URL = Supabase session pooler, port 5432 — see DEPLOYMENT.md.)   │
-- │ RLS helpers current_company_id() / can_access_project() come from rls.sql,│
-- │ already applied in the baseline. AFTER this migration, run                │
-- │   npx tsx prisma/reconcile-rbac.ts                                        │
-- │ so existing companies' SYSTEM roles gain the new contracts.* permissions  │
-- │ (Owner is implicit-all and unaffected; custom roles are never touched).   │
-- │ WITHOUT that step the entire commercial centre 403s for every non-Owner,  │
-- │ with no error that points at RBAC as the cause.                           │
-- └──────────────────────────────────────────────────────────────────────────┘
--
-- NOT additive-only: step 8 SWAPS the labour_attendance unique index from 4 to 5
-- columns (adding contract_id to the row identity, so one contractor holding two
-- agreements on a project can record the same labour type on the same date under
-- each). Create-before-drop, and the `-1` wrapper makes the swap atomic.
--
-- Otherwise additive: 5 NEW enums, 6 NEW tables, 3 NEW nullable columns on
-- labour_attendance, tenant/project RLS. NO row rewrites, NO deletes, NO
-- backfill: every existing attendance row keeps contract_id / settlement_id NULL
-- and behaves byte-for-byte as before, resolving through the unchanged
-- attendance-only rate path.
--
-- DELIBERATELY ABSENT: project_contractors.payment_model and the "PaymentModel"
-- enum. A contractor↔project relationship cannot have one billing method — it may
-- carry attendance-only labour, one or several commercial agreements, or both at
-- once. Step 3 drops both if a developer box created them via `npm run db:push`
-- against an earlier schema; in production they never existed.
--
-- RE-RUN TOLERANT: enums guarded by pg_type, tables by IF NOT EXISTS, columns by
-- IF NOT EXISTS, FKs by pg_constraint, policies by pg_policies, indexes by
-- IF NOT EXISTS. The POSTFLIGHT block asserts the final shape and RAISEs on any
-- mismatch.

-- ── 1. CreateEnum (guarded — CREATE TYPE has no IF NOT EXISTS) ─────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ContractStatus') THEN
    CREATE TYPE "ContractStatus" AS ENUM
      ('NOT_STARTED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'SETTLED', 'CANCELLED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MilestoneStatus') THEN
    CREATE TYPE "MilestoneStatus" AS ENUM
      ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ContractPaymentType') THEN
    CREATE TYPE "ContractPaymentType" AS ENUM
      ('ADVANCE', 'INTERIM', 'MILESTONE', 'WEEKLY', 'DAILY', 'FINAL', 'OTHER');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AmendmentType') THEN
    CREATE TYPE "AmendmentType" AS ENUM
      ('VARIATION', 'SCOPE_CHANGE', 'RATE_CHANGE', 'TIME_EXTENSION', 'OTHER');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AmendmentStatus') THEN
    CREATE TYPE "AmendmentStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED');
  END IF;
END $$;

-- ── 2. PREFLIGHT: the identity swap must not violate the wider unique key ──
-- All existing rows get contract_id = NULL, so the 5-col key is a strict
-- superset of the already-satisfied 4-col key and cannot introduce a conflict.
-- Asserted anyway, mirroring migration-attendance-contractor-identity.sql.
DO $$
DECLARE dup_groups int;
BEGIN
  SELECT count(*) INTO dup_groups FROM (
    SELECT project_id, date, labour_subcategory_id,
           COALESCE(contractor_id, '00000000-0000-0000-0000-000000000000'::uuid) AS cc
    FROM public.labour_attendance
    GROUP BY 1,2,3,4
    HAVING count(*) > 1
  ) d;
  IF dup_groups > 0 THEN
    RAISE EXCEPTION 'preflight: % duplicate attendance identity group(s) — resolve before migrating', dup_groups;
  END IF;
END $$;

-- ── 3. Developer-box repair (no-op in production) ──────────────────────────
-- A dev DB that ran `npm run db:push` against the earlier fixed-contract schema
-- has payment_model + the PaymentModel type. Production never did. Without this
-- those boxes diverge from schema.prisma permanently.
ALTER TABLE "project_contractors" DROP COLUMN IF EXISTS "payment_model";
DROP TYPE IF EXISTS "PaymentModel";

-- ── 4. CreateTable: contractor_contracts ───────────────────────────────────
-- original_amount_paise is immutable after creation; current_amount_paise is the
-- AUTHORISED value (original + Σ approved amendment deltas) and is written only
-- inside approveAmendment's transaction. Both ceilings — earned value and total
-- credit — are measured against current_amount_paise.
CREATE TABLE IF NOT EXISTS "contractor_contracts" (
    "id"                       UUID             NOT NULL,
    "company_id"               UUID             NOT NULL,
    "contractor_id"            UUID             NOT NULL,
    "project_id"               UUID             NOT NULL,
    "title"                    TEXT             NOT NULL,
    "reference"                TEXT,
    "scope"                    TEXT,
    "quantity"                 NUMERIC(12,3),
    "unit"                     TEXT,
    "original_amount_paise"    BIGINT           NOT NULL,
    "current_amount_paise"     BIGINT           NOT NULL,
    "start_date"               DATE,
    "expected_completion_date" DATE,
    "status"                   "ContractStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "notes"                    TEXT,
    "completed_at"             TIMESTAMP(3),
    "settled_at"               TIMESTAMP(3),
    "cancelled_at"             TIMESTAMP(3),
    "cancelled_by_id"          UUID,
    "cancelled_reason"         TEXT,
    "created_by_id"            UUID             NOT NULL,
    "deleted_at"               TIMESTAMP(3),
    "deleted_by_id"            UUID,
    "created_at"               TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"               TIMESTAMP(3)     NOT NULL,
    CONSTRAINT "contractor_contracts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "cc_company_contractor_idx"
    ON "contractor_contracts"("company_id", "contractor_id");
CREATE INDEX IF NOT EXISTS "cc_company_project_idx"
    ON "contractor_contracts"("company_id", "project_id");
CREATE INDEX IF NOT EXISTS "cc_company_status_idx"
    ON "contractor_contracts"("company_id", "status");
-- The attendance agreement auto-selection hot path.
CREATE INDEX IF NOT EXISTS "cc_company_contractor_project_idx"
    ON "contractor_contracts"("company_id", "contractor_id", "project_id");

-- ── 5. CreateTable: contract_scope_items ───────────────────────────────────
-- TIER-1 rate carrier. project_id is DENORMALIZED from the parent contract so
-- RLS uses the same flat project policy as every other project-scoped table.
CREATE TABLE IF NOT EXISTS "contract_scope_items" (
    "id"                    UUID         NOT NULL,
    "company_id"            UUID         NOT NULL,
    "project_id"            UUID         NOT NULL,
    "contract_id"           UUID         NOT NULL,
    "labour_subcategory_id" UUID         NOT NULL,
    "current_rate_paise"    INTEGER      NOT NULL,
    "rate_unit"             TEXT         NOT NULL DEFAULT 'day',
    "notes"                 TEXT,
    "created_by_id"         UUID         NOT NULL,
    "deleted_at"            TIMESTAMP(3),
    "deleted_by_id"         UUID,
    "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMP(3) NOT NULL,
    CONSTRAINT "contract_scope_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "csi_company_contract_idx"
    ON "contract_scope_items"("company_id", "contract_id");
CREATE INDEX IF NOT EXISTS "csi_company_subcategory_idx"
    ON "contract_scope_items"("company_id", "labour_subcategory_id");
-- PARTIAL unique: one live scope row per (agreement, labour type). Soft-deleted
-- rows are excluded so a removed-then-re-added labour type is allowed. Prisma
-- cannot express partial unique, hence SQL-only (precedent: labour_categories).
CREATE UNIQUE INDEX IF NOT EXISTS "csi_contract_subcategory_live_key"
    ON "contract_scope_items"("contract_id", "labour_subcategory_id")
    WHERE "deleted_at" IS NULL;

-- ── 6. CreateTable: contract_scope_rate_revisions ──────────────────────────
-- APPEND-ONLY. No deleted_at by design: erasable rate history is exactly what
-- this table exists to prevent. A correction is a new row, never an edit.
CREATE TABLE IF NOT EXISTS "contract_scope_rate_revisions" (
    "id"             UUID         NOT NULL,
    "company_id"     UUID         NOT NULL,
    "project_id"     UUID         NOT NULL,
    "contract_id"    UUID         NOT NULL,
    "scope_item_id"  UUID         NOT NULL,
    "rate_paise"     INTEGER      NOT NULL,
    "rate_unit"      TEXT         NOT NULL DEFAULT 'day',
    "effective_from" DATE         NOT NULL,
    "reason"         TEXT,
    "created_by_id"  UUID         NOT NULL,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contract_scope_rate_revisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "csrr_company_scope_effective_idx"
    ON "contract_scope_rate_revisions"("company_id", "scope_item_id", "effective_from");
CREATE INDEX IF NOT EXISTS "csrr_company_contract_idx"
    ON "contract_scope_rate_revisions"("company_id", "contract_id");

-- ── 7. CreateTable: contract_milestones ────────────────────────────────────
-- Status is PHYSICAL progress only. The financial state (due / settled / ahead)
-- is DERIVED from cumulative reconciliation at the checkpoint — never stamped
-- here, because payments are cumulative at agreement level and a milestone is
-- not a payment bucket.
CREATE TABLE IF NOT EXISTS "contract_milestones" (
    "id"               UUID              NOT NULL,
    "company_id"       UUID              NOT NULL,
    "project_id"       UUID              NOT NULL,
    "contract_id"      UUID              NOT NULL,
    "sequence"         INTEGER           NOT NULL DEFAULT 0,
    "title"            TEXT              NOT NULL,
    "description"      TEXT,
    "value_paise"      BIGINT            NOT NULL,
    "planned_date"     DATE,
    "status"           "MilestoneStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "completed_at"     TIMESTAMP(3),
    "completed_by_id"  UUID,
    "cancelled_at"     TIMESTAMP(3),
    "cancelled_reason" TEXT,
    "notes"            TEXT,
    "created_by_id"    UUID              NOT NULL,
    "deleted_at"       TIMESTAMP(3),
    "deleted_by_id"    UUID,
    "created_at"       TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3)      NOT NULL,
    CONSTRAINT "contract_milestones_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "cm_company_contract_sequence_idx"
    ON "contract_milestones"("company_id", "contract_id", "sequence");
CREATE INDEX IF NOT EXISTS "cm_company_project_idx"
    ON "contract_milestones"("company_id", "project_id");
CREATE INDEX IF NOT EXISTS "cm_company_status_idx"
    ON "contract_milestones"("company_id", "status");

-- ── 8. CreateTable: contract_amendments ────────────────────────────────────
-- The ONLY path that changes an agreement's authorised value. delta_paise is
-- SIGNED (a variation may reduce scope). Only APPROVED rows move
-- contractor_contracts.current_amount_paise.
CREATE TABLE IF NOT EXISTS "contract_amendments" (
    "id"                    UUID              NOT NULL,
    "company_id"            UUID              NOT NULL,
    "project_id"            UUID              NOT NULL,
    "contract_id"           UUID              NOT NULL,
    "sequence"              INTEGER           NOT NULL DEFAULT 0,
    "type"                  "AmendmentType"   NOT NULL DEFAULT 'VARIATION',
    "previous_amount_paise" BIGINT            NOT NULL,
    "revised_amount_paise"  BIGINT            NOT NULL,
    "delta_paise"           BIGINT            NOT NULL,
    "reason"                TEXT              NOT NULL,
    "effective_date"        DATE              NOT NULL,
    "status"                "AmendmentStatus" NOT NULL DEFAULT 'PROPOSED',
    "requested_by_id"       UUID              NOT NULL,
    "approved_by_id"        UUID,
    "approved_at"           TIMESTAMP(3),
    "rejected_reason"       TEXT,
    "deleted_at"            TIMESTAMP(3),
    "deleted_by_id"         UUID,
    "created_at"            TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMP(3)      NOT NULL,
    CONSTRAINT "contract_amendments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ca_company_contract_effective_idx"
    ON "contract_amendments"("company_id", "contract_id", "effective_date");
CREATE INDEX IF NOT EXISTS "ca_company_status_idx"
    ON "contract_amendments"("company_id", "status");

-- ── 9. CreateTable: contractor_contract_payments ───────────────────────────
-- deleted_at IS the reversal: a reversed payment stops contributing to every
-- total while the row and its ActivityLog entry survive forever. milestone_id is
-- context for reporting only and never enters the cumulative math.
CREATE TABLE IF NOT EXISTS "contractor_contract_payments" (
    "id"               UUID                  NOT NULL,
    "company_id"       UUID                  NOT NULL,
    "contract_id"      UUID                  NOT NULL,
    "contractor_id"    UUID                  NOT NULL,
    "project_id"       UUID                  NOT NULL,
    "amount_paise"     BIGINT                NOT NULL,
    "type"             "ContractPaymentType" NOT NULL DEFAULT 'OTHER',
    "payment_mode"     "PaymentMode"         NOT NULL DEFAULT 'BANK_TRANSFER',
    "reference_number" TEXT,
    "date"             DATE                  NOT NULL,
    "notes"            TEXT,
    "milestone_id"     UUID,
    "client_uuid"      TEXT,
    "created_by_id"    UUID                  NOT NULL,
    "deleted_at"       TIMESTAMP(3),
    "deleted_by_id"    UUID,
    "reversal_reason"  TEXT,
    "created_at"       TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3)          NOT NULL,
    CONSTRAINT "contractor_contract_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ccp_company_contract_idx"
    ON "contractor_contract_payments"("company_id", "contract_id");
CREATE INDEX IF NOT EXISTS "ccp_company_project_idx"
    ON "contractor_contract_payments"("company_id", "project_id");
CREATE INDEX IF NOT EXISTS "ccp_company_contractor_idx"
    ON "contractor_contract_payments"("company_id", "contractor_id");
CREATE INDEX IF NOT EXISTS "ccp_company_date_idx"
    ON "contractor_contract_payments"("company_id", "date");
CREATE INDEX IF NOT EXISTS "ccp_company_milestone_idx"
    ON "contractor_contract_payments"("company_id", "milestone_id");
-- Idempotency: a repeated submit with the same client key is a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS "ccp_contract_id_client_uuid_key"
    ON "contractor_contract_payments"("contract_id", "client_uuid")
    WHERE "client_uuid" IS NOT NULL;

-- ── 10. CreateTable: project_contractor_labour_rate_revisions ──────────────
-- TIER-2 audit trail. APPEND-ONLY, and deliberately NOT used for resolution:
-- attendance-only rows still snapshot the CURRENT rate (ADR-0022), which already
-- makes historical cost immutable. This answers "what was the rate in March?"
-- for contractors working without an agreement.
CREATE TABLE IF NOT EXISTS "project_contractor_labour_rate_revisions" (
    "id"                                UUID         NOT NULL,
    "company_id"                        UUID         NOT NULL,
    "project_id"                        UUID         NOT NULL,
    "project_contractor_labour_rate_id" UUID         NOT NULL,
    "labour_subcategory_id"             UUID         NOT NULL,
    "rate_paise"                        INTEGER      NOT NULL,
    "rate_unit"                         TEXT         NOT NULL DEFAULT 'day',
    "effective_from"                    DATE         NOT NULL,
    "changed_by_id"                     UUID         NOT NULL,
    "created_at"                        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_contractor_labour_rate_revisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "pclrr_company_rate_effective_idx"
    ON "project_contractor_labour_rate_revisions"
       ("company_id", "project_contractor_labour_rate_id", "effective_from");

-- ── 11. AlterTable: labour_attendance gains agreement + settlement columns ──
ALTER TABLE "labour_attendance"
  ADD COLUMN IF NOT EXISTS "contract_id" UUID;
ALTER TABLE "labour_attendance"
  ADD COLUMN IF NOT EXISTS "contract_scope_rate_revision_id" UUID;
ALTER TABLE "labour_attendance"
  ADD COLUMN IF NOT EXISTS "settlement_id" UUID;

CREATE INDEX IF NOT EXISTS "la_company_contract_date_idx"
    ON "labour_attendance"("company_id", "contract_id", "date");
CREATE INDEX IF NOT EXISTS "la_company_settlement_idx"
    ON "labour_attendance"("company_id", "settlement_id");

-- ── 12. Identity index swap: 4 columns → 5 (CREATE BEFORE DROP) ────────────
-- contract_id joins the row identity so a contractor holding two agreements on
-- one project can record the same labour type on the same date under each.
-- NULLS NOT DISTINCT keeps one-row-per-(project,date,subcategory) for the
-- attendance-only rows where both contractor_id and contract_id are NULL.
CREATE UNIQUE INDEX IF NOT EXISTS "labour_attendance_proj_date_subcat_contractor_contract_key"
  ON "labour_attendance"
     ("project_id", "date", "labour_subcategory_id", "contractor_id", "contract_id")
  NULLS NOT DISTINCT;

DROP INDEX IF EXISTS "labour_attendance_proj_date_subcat_contractor_key";

-- ── 13. Foreign keys (guarded by name via pg_constraint) ───────────────────
DO $$ BEGIN
  -- contractor_contracts
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contractor_contracts_company_id_fkey') THEN
    ALTER TABLE "contractor_contracts" ADD CONSTRAINT "contractor_contracts_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contractor_contracts_contractor_id_fkey') THEN
    ALTER TABLE "contractor_contracts" ADD CONSTRAINT "contractor_contracts_contractor_id_fkey"
      FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contractor_contracts_project_id_fkey') THEN
    ALTER TABLE "contractor_contracts" ADD CONSTRAINT "contractor_contracts_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contractor_contracts_created_by_id_fkey') THEN
    ALTER TABLE "contractor_contracts" ADD CONSTRAINT "contractor_contracts_created_by_id_fkey"
      FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contractor_contracts_deleted_by_id_fkey') THEN
    ALTER TABLE "contractor_contracts" ADD CONSTRAINT "contractor_contracts_deleted_by_id_fkey"
      FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contractor_contracts_cancelled_by_id_fkey') THEN
    ALTER TABLE "contractor_contracts" ADD CONSTRAINT "contractor_contracts_cancelled_by_id_fkey"
      FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  -- contract_scope_items
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_scope_items_company_id_fkey') THEN
    ALTER TABLE "contract_scope_items" ADD CONSTRAINT "contract_scope_items_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_scope_items_project_id_fkey') THEN
    ALTER TABLE "contract_scope_items" ADD CONSTRAINT "contract_scope_items_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_scope_items_contract_id_fkey') THEN
    ALTER TABLE "contract_scope_items" ADD CONSTRAINT "contract_scope_items_contract_id_fkey"
      FOREIGN KEY ("contract_id") REFERENCES "contractor_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_scope_items_labour_subcategory_id_fkey') THEN
    ALTER TABLE "contract_scope_items" ADD CONSTRAINT "contract_scope_items_labour_subcategory_id_fkey"
      FOREIGN KEY ("labour_subcategory_id") REFERENCES "labour_subcategories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_scope_items_created_by_id_fkey') THEN
    ALTER TABLE "contract_scope_items" ADD CONSTRAINT "contract_scope_items_created_by_id_fkey"
      FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_scope_items_deleted_by_id_fkey') THEN
    ALTER TABLE "contract_scope_items" ADD CONSTRAINT "contract_scope_items_deleted_by_id_fkey"
      FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  -- contract_scope_rate_revisions
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'csrr_company_id_fkey') THEN
    ALTER TABLE "contract_scope_rate_revisions" ADD CONSTRAINT "csrr_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'csrr_project_id_fkey') THEN
    ALTER TABLE "contract_scope_rate_revisions" ADD CONSTRAINT "csrr_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'csrr_contract_id_fkey') THEN
    ALTER TABLE "contract_scope_rate_revisions" ADD CONSTRAINT "csrr_contract_id_fkey"
      FOREIGN KEY ("contract_id") REFERENCES "contractor_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'csrr_scope_item_id_fkey') THEN
    ALTER TABLE "contract_scope_rate_revisions" ADD CONSTRAINT "csrr_scope_item_id_fkey"
      FOREIGN KEY ("scope_item_id") REFERENCES "contract_scope_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'csrr_created_by_id_fkey') THEN
    ALTER TABLE "contract_scope_rate_revisions" ADD CONSTRAINT "csrr_created_by_id_fkey"
      FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  -- contract_milestones
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_milestones_company_id_fkey') THEN
    ALTER TABLE "contract_milestones" ADD CONSTRAINT "contract_milestones_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_milestones_project_id_fkey') THEN
    ALTER TABLE "contract_milestones" ADD CONSTRAINT "contract_milestones_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_milestones_contract_id_fkey') THEN
    ALTER TABLE "contract_milestones" ADD CONSTRAINT "contract_milestones_contract_id_fkey"
      FOREIGN KEY ("contract_id") REFERENCES "contractor_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_milestones_created_by_id_fkey') THEN
    ALTER TABLE "contract_milestones" ADD CONSTRAINT "contract_milestones_created_by_id_fkey"
      FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_milestones_completed_by_id_fkey') THEN
    ALTER TABLE "contract_milestones" ADD CONSTRAINT "contract_milestones_completed_by_id_fkey"
      FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_milestones_deleted_by_id_fkey') THEN
    ALTER TABLE "contract_milestones" ADD CONSTRAINT "contract_milestones_deleted_by_id_fkey"
      FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  -- contract_amendments
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_amendments_company_id_fkey') THEN
    ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_amendments_project_id_fkey') THEN
    ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_amendments_contract_id_fkey') THEN
    ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_contract_id_fkey"
      FOREIGN KEY ("contract_id") REFERENCES "contractor_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_amendments_requested_by_id_fkey') THEN
    ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_requested_by_id_fkey"
      FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_amendments_approved_by_id_fkey') THEN
    ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_approved_by_id_fkey"
      FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contract_amendments_deleted_by_id_fkey') THEN
    ALTER TABLE "contract_amendments" ADD CONSTRAINT "contract_amendments_deleted_by_id_fkey"
      FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  -- contractor_contract_payments
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ccp_company_id_fkey') THEN
    ALTER TABLE "contractor_contract_payments" ADD CONSTRAINT "ccp_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ccp_contract_id_fkey') THEN
    ALTER TABLE "contractor_contract_payments" ADD CONSTRAINT "ccp_contract_id_fkey"
      FOREIGN KEY ("contract_id") REFERENCES "contractor_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ccp_contractor_id_fkey') THEN
    ALTER TABLE "contractor_contract_payments" ADD CONSTRAINT "ccp_contractor_id_fkey"
      FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ccp_project_id_fkey') THEN
    ALTER TABLE "contractor_contract_payments" ADD CONSTRAINT "ccp_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ccp_milestone_id_fkey') THEN
    ALTER TABLE "contractor_contract_payments" ADD CONSTRAINT "ccp_milestone_id_fkey"
      FOREIGN KEY ("milestone_id") REFERENCES "contract_milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ccp_created_by_id_fkey') THEN
    ALTER TABLE "contractor_contract_payments" ADD CONSTRAINT "ccp_created_by_id_fkey"
      FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ccp_deleted_by_id_fkey') THEN
    ALTER TABLE "contractor_contract_payments" ADD CONSTRAINT "ccp_deleted_by_id_fkey"
      FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  -- project_contractor_labour_rate_revisions
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pclrr_company_id_fkey') THEN
    ALTER TABLE "project_contractor_labour_rate_revisions" ADD CONSTRAINT "pclrr_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pclrr_project_id_fkey') THEN
    ALTER TABLE "project_contractor_labour_rate_revisions" ADD CONSTRAINT "pclrr_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pclrr_rate_id_fkey') THEN
    ALTER TABLE "project_contractor_labour_rate_revisions" ADD CONSTRAINT "pclrr_rate_id_fkey"
      FOREIGN KEY ("project_contractor_labour_rate_id")
      REFERENCES "project_contractor_labour_rates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pclrr_changed_by_id_fkey') THEN
    ALTER TABLE "project_contractor_labour_rate_revisions" ADD CONSTRAINT "pclrr_changed_by_id_fkey"
      FOREIGN KEY ("changed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  -- labour_attendance: the three new nullable FKs. ALL SET NULL — deleting an
  -- agreement, a rate revision, or a settlement must never delete attendance.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'labour_attendance_contract_id_fkey') THEN
    ALTER TABLE "labour_attendance" ADD CONSTRAINT "labour_attendance_contract_id_fkey"
      FOREIGN KEY ("contract_id") REFERENCES "contractor_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'labour_attendance_scope_rate_revision_id_fkey') THEN
    ALTER TABLE "labour_attendance" ADD CONSTRAINT "labour_attendance_scope_rate_revision_id_fkey"
      FOREIGN KEY ("contract_scope_rate_revision_id")
      REFERENCES "contract_scope_rate_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'labour_attendance_settlement_id_fkey') THEN
    ALTER TABLE "labour_attendance" ADD CONSTRAINT "labour_attendance_settlement_id_fkey"
      FOREIGN KEY ("settlement_id") REFERENCES "contractor_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── 13b. Agreement-scoped labour advances + governed settlement reversal ───
-- Money the contractor was given for specific work keeps that attribution. A
-- LABOUR ADVANCE is never agreement credit: it pre-pays labour and is netted off
-- a settlement, and the agreement is credited by the attendance that settlement
-- recognises. Direct commercial payment against an agreement is a
-- contractor_contract_payments row instead.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ContractorLedgerType' AND e.enumlabel = 'SETTLEMENT_REVERSAL'
  ) THEN
    ALTER TYPE "ContractorLedgerType" ADD VALUE 'SETTLEMENT_REVERSAL';
  END IF;
END $$;

-- Money totals that realistically grow past the Int32 ceiling (₹2,14,74,836).
-- Rates stay INTEGER on purpose (a day rate cannot approach it), as does
-- labour_attendance.estimated_cost_paise (one subcategory × one day).
ALTER TABLE "contractors"            ALTER COLUMN "opening_advance_paise"       TYPE BIGINT;
ALTER TABLE "contractor_ledger_entries" ALTER COLUMN "amount_paise"             TYPE BIGINT;
ALTER TABLE "contractor_ledger_entries" ALTER COLUMN "advance_balance_after_paise" TYPE BIGINT;
ALTER TABLE "contractor_settlements" ALTER COLUMN "labour_bill_paise"           TYPE BIGINT;
ALTER TABLE "contractor_settlements" ALTER COLUMN "advance_adjustment_paise"    TYPE BIGINT;
ALTER TABLE "contractor_settlements" ALTER COLUMN "net_payment_paise"           TYPE BIGINT;
ALTER TABLE "contractor_settlements" ALTER COLUMN "advance_balance_after_paise" TYPE BIGINT;

-- Ledger scope + explicit provenance. One meaning per column, never polymorphic.
ALTER TABLE "contractor_ledger_entries" ADD COLUMN IF NOT EXISTS "project_id"          UUID;
ALTER TABLE "contractor_ledger_entries" ADD COLUMN IF NOT EXISTS "contract_id"         UUID;
ALTER TABLE "contractor_ledger_entries" ADD COLUMN IF NOT EXISTS "draws_from_entry_id" UUID;
ALTER TABLE "contractor_ledger_entries" ADD COLUMN IF NOT EXISTS "reverses_entry_id"   UUID;
ALTER TABLE "contractor_ledger_entries" ADD COLUMN IF NOT EXISTS "funds_contract_id"   UUID;

CREATE INDEX IF NOT EXISTS "cle_company_contractor_contract_idx"
    ON "contractor_ledger_entries"("company_id", "contractor_id", "contract_id");

-- An agreement-scoped entry always carries its project.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cle_contract_requires_project') THEN
    ALTER TABLE "contractor_ledger_entries" ADD CONSTRAINT "cle_contract_requires_project"
      CHECK ("contract_id" IS NULL OR "project_id" IS NOT NULL);
  END IF;
END $$;

-- Settlement reversal. The settlement is never deleted; it stops being live.
ALTER TABLE "contractor_settlements" ADD COLUMN IF NOT EXISTS "reversed_at"     TIMESTAMP(3);
ALTER TABLE "contractor_settlements" ADD COLUMN IF NOT EXISTS "reversed_by_id"  UUID;
ALTER TABLE "contractor_settlements" ADD COLUMN IF NOT EXISTS "reversal_reason" TEXT;

-- Backs the composite FKs below (id is already the PK; the extra columns make
-- cross-contractor / cross-project / cross-company attribution unrepresentable).
CREATE UNIQUE INDEX IF NOT EXISTS "cc_id_company_contractor_project_key"
    ON "contractor_contracts"("id", "company_id", "contractor_id", "project_id");

-- ── 13c. What a settlement knew about its own composition, when it ran ─────
-- Reversal reads THIS, never today's labour_attendance.contract_id: historical
-- attribution can legitimately change those values later, and a settlement
-- attributed afterwards would otherwise reverse against a composition it never
-- used, mis-attributing the cash.
CREATE TABLE IF NOT EXISTS "contractor_settlement_breakdowns" (
    "id"                       UUID         NOT NULL,
    "company_id"               UUID         NOT NULL,
    "project_id"               UUID         NOT NULL,
    "settlement_id"            UUID         NOT NULL,
    "contract_id"              UUID,
    "labour_bill_paise"        BIGINT       NOT NULL,
    "advance_adjustment_paise" BIGINT       NOT NULL,
    "net_payment_paise"        BIGINT       NOT NULL,
    "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contractor_settlement_breakdowns_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "csb_company_settlement_idx"
    ON "contractor_settlement_breakdowns"("company_id", "settlement_id");
-- One row per bucket. NULLS NOT DISTINCT so the unattributed bucket is unique too.
CREATE UNIQUE INDEX IF NOT EXISTS "csb_settlement_contract_key"
    ON "contractor_settlement_breakdowns"("settlement_id", "contract_id")
    NULLS NOT DISTINCT;

DO $$ BEGIN
  -- Ledger: scope FKs. RESTRICT throughout — financial provenance must never be
  -- silently erased by deleting something it points at.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cle_project_id_fkey') THEN
    ALTER TABLE "contractor_ledger_entries" ADD CONSTRAINT "cle_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cle_contract_id_fkey') THEN
    ALTER TABLE "contractor_ledger_entries" ADD CONSTRAINT "cle_contract_id_fkey"
      FOREIGN KEY ("contract_id") REFERENCES "contractor_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cle_funds_contract_id_fkey') THEN
    ALTER TABLE "contractor_ledger_entries" ADD CONSTRAINT "cle_funds_contract_id_fkey"
      FOREIGN KEY ("funds_contract_id") REFERENCES "contractor_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  -- COMPOSITE FKs: an agreement referenced by a ledger entry must belong to the
  -- SAME company + contractor + project as that entry. This makes attributing an
  -- advance to another contractor's or another project's agreement impossible,
  -- rather than merely validated in application code.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cle_contract_scope_fkey') THEN
    ALTER TABLE "contractor_ledger_entries" ADD CONSTRAINT "cle_contract_scope_fkey"
      FOREIGN KEY ("contract_id", "company_id", "contractor_id", "project_id")
      REFERENCES "contractor_contracts"("id", "company_id", "contractor_id", "project_id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cle_funds_contract_scope_fkey') THEN
    ALTER TABLE "contractor_ledger_entries" ADD CONSTRAINT "cle_funds_contract_scope_fkey"
      FOREIGN KEY ("funds_contract_id", "company_id", "contractor_id", "project_id")
      REFERENCES "contractor_contracts"("id", "company_id", "contractor_id", "project_id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  -- Self-references: a provenance chain can never point at a missing row.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cle_draws_from_entry_id_fkey') THEN
    ALTER TABLE "contractor_ledger_entries" ADD CONSTRAINT "cle_draws_from_entry_id_fkey"
      FOREIGN KEY ("draws_from_entry_id") REFERENCES "contractor_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cle_reverses_entry_id_fkey') THEN
    ALTER TABLE "contractor_ledger_entries" ADD CONSTRAINT "cle_reverses_entry_id_fkey"
      FOREIGN KEY ("reverses_entry_id") REFERENCES "contractor_ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  -- G3: ledger history must not vanish because a settlement row is deleted.
  IF EXISTS (SELECT 1 FROM pg_constraint
      WHERE conname = 'contractor_ledger_entries_settlement_id_fkey' AND confdeltype = 'c') THEN
    ALTER TABLE "contractor_ledger_entries" DROP CONSTRAINT "contractor_ledger_entries_settlement_id_fkey";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contractor_ledger_entries_settlement_id_fkey') THEN
    ALTER TABLE "contractor_ledger_entries" ADD CONSTRAINT "contractor_ledger_entries_settlement_id_fkey"
      FOREIGN KEY ("settlement_id") REFERENCES "contractor_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cs_reversed_by_id_fkey') THEN
    ALTER TABLE "contractor_settlements" ADD CONSTRAINT "cs_reversed_by_id_fkey"
      FOREIGN KEY ("reversed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  -- Breakdown FKs.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'csb_company_id_fkey') THEN
    ALTER TABLE "contractor_settlement_breakdowns" ADD CONSTRAINT "csb_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'csb_project_id_fkey') THEN
    ALTER TABLE "contractor_settlement_breakdowns" ADD CONSTRAINT "csb_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'csb_settlement_id_fkey') THEN
    ALTER TABLE "contractor_settlement_breakdowns" ADD CONSTRAINT "csb_settlement_id_fkey"
      FOREIGN KEY ("settlement_id") REFERENCES "contractor_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'csb_contract_id_fkey') THEN
    ALTER TABLE "contractor_settlement_breakdowns" ADD CONSTRAINT "csb_contract_id_fkey"
      FOREIGN KEY ("contract_id") REFERENCES "contractor_contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ── 14. Row Level Security ─────────────────────────────────────────────────
-- Every new table carries a denormalized project_id, so all six policies use the
-- identical flat shape already used by deadlines / project_contractors. These
-- definitions are DUPLICATED in prisma/rls.sql (which is canonical) so a
-- single-file deploy is self-sufficient — keep the two textually identical.
ALTER TABLE "contractor_contracts"                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contract_scope_items"                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contract_scope_rate_revisions"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contract_milestones"                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contract_amendments"                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contractor_contract_payments"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "project_contractor_labour_rate_revisions"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contractor_settlement_breakdowns"          ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'contractor_contracts',
    'contract_scope_items',
    'contract_scope_rate_revisions',
    'contract_milestones',
    'contract_amendments',
    'contractor_contract_payments',
    'project_contractor_labour_rate_revisions',
    'contractor_settlement_breakdowns'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND policyname = t || '_all'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL '
        'USING (company_id = public.current_company_id() AND public.can_access_project(project_id)) '
        'WITH CHECK (company_id = public.current_company_id() AND public.can_access_project(project_id))',
        t || '_all', t
      );
    END IF;
  END LOOP;
END $$;

-- ── 14b. Tighten contractor financial RLS to project scope ────────────────
-- The app reads these only through server actions on Prisma/DIRECT_URL, which
-- BYPASSES RLS — so this changes nothing for the application. It closes the
-- direct-access path: the publishable key ships to the browser, and today's
-- company-wide policies would let a project-scoped user hand-craft a Supabase
-- call and read every contractor ledger entry and settlement in the company.
--
-- RLS cannot see the `contractors.view_all` application permission, so it
-- approximates with the existing is_owner() helper and is deliberately STRICTER
-- than the app for a non-Owner Admin. Harmless, because no client code reads
-- these tables.
DROP POLICY IF EXISTS contractor_settlements_tenant ON public.contractor_settlements;
CREATE POLICY contractor_settlements_tenant ON public.contractor_settlements
  FOR ALL USING (company_id = public.current_company_id() AND public.can_access_project(project_id))
  WITH CHECK (company_id = public.current_company_id() AND public.can_access_project(project_id));

DROP POLICY IF EXISTS contractor_ledger_entries_tenant ON public.contractor_ledger_entries;
CREATE POLICY contractor_ledger_entries_tenant ON public.contractor_ledger_entries
  FOR ALL USING (
    company_id = public.current_company_id()
    AND (public.can_access_project(project_id) OR (project_id IS NULL AND public.is_owner()))
  )
  WITH CHECK (
    company_id = public.current_company_id()
    AND (public.can_access_project(project_id) OR (project_id IS NULL AND public.is_owner()))
  );

-- ── POSTFLIGHT ASSERTIONS ──────────────────────────────────────────────────
-- RULE: assert EXISTENCE and SHAPE, BY NAME. Never assert a column COUNT — a
-- count fires on any future additive change and rolls back an otherwise-correct
-- migration. (The previous revision of this file asserted 17 columns on a table
-- it created with 18, which is why it could never be applied.)
DO $$
DECLARE
  la regclass := to_regclass('public.labour_attendance');
  r  record;
  expected_cols text[][] := ARRAY[
    ['contractor_contracts',         'original_amount_paise', 'bigint'],
    ['contractor_contracts',         'current_amount_paise',  'bigint'],
    ['contractor_contracts',         'quantity',              'numeric'],
    ['contractor_contracts',         'reference',             'text'],
    ['contractor_contracts',         'cancelled_reason',      'text'],
    ['contract_scope_items',         'current_rate_paise',    'integer'],
    ['contract_scope_rate_revisions','effective_from',        'date'],
    ['contract_scope_rate_revisions','rate_paise',            'integer'],
    ['contract_milestones',          'value_paise',           'bigint'],
    ['contract_amendments',          'delta_paise',           'bigint'],
    ['contract_amendments',          'reason',                'text'],
    ['contractor_contract_payments', 'amount_paise',          'bigint'],
    ['contractor_contract_payments', 'milestone_id',          'uuid'],
    ['contractor_contract_payments', 'reversal_reason',       'text'],
    ['labour_attendance',            'contract_id',           'uuid'],
    ['labour_attendance',            'settlement_id',         'uuid'],
    ['labour_attendance',            'contract_scope_rate_revision_id', 'uuid'],
    -- Agreement-scoped advances, explicit provenance, and the money widening.
    ['contractor_ledger_entries',    'project_id',            'uuid'],
    ['contractor_ledger_entries',    'contract_id',           'uuid'],
    ['contractor_ledger_entries',    'draws_from_entry_id',   'uuid'],
    ['contractor_ledger_entries',    'reverses_entry_id',     'uuid'],
    ['contractor_ledger_entries',    'funds_contract_id',     'uuid'],
    ['contractor_ledger_entries',    'amount_paise',          'bigint'],
    ['contractor_ledger_entries',    'advance_balance_after_paise', 'bigint'],
    ['contractors',                  'opening_advance_paise', 'bigint'],
    ['contractor_settlements',       'labour_bill_paise',     'bigint'],
    ['contractor_settlements',       'advance_adjustment_paise', 'bigint'],
    ['contractor_settlements',       'net_payment_paise',     'bigint'],
    ['contractor_settlements',       'advance_balance_after_paise', 'bigint'],
    ['contractor_settlements',       'reversed_at',           'timestamp without time zone'],
    ['contractor_settlements',       'reversal_reason',       'text'],
    ['contractor_settlement_breakdowns', 'labour_bill_paise', 'bigint'],
    ['contractor_settlement_breakdowns', 'net_payment_paise', 'bigint']
  ];
  expected_fks text[] := ARRAY[
    'contractor_contracts_company_id_fkey',
    'contractor_contracts_contractor_id_fkey',
    'contractor_contracts_project_id_fkey',
    'contract_scope_items_contract_id_fkey',
    'contract_scope_items_labour_subcategory_id_fkey',
    'csrr_scope_item_id_fkey',
    'contract_milestones_contract_id_fkey',
    'contract_amendments_contract_id_fkey',
    'ccp_contract_id_fkey',
    'ccp_milestone_id_fkey',
    'pclrr_rate_id_fkey',
    'labour_attendance_contract_id_fkey',
    'labour_attendance_settlement_id_fkey',
    'labour_attendance_scope_rate_revision_id_fkey',
    'cle_contract_scope_fkey',
    'cle_funds_contract_scope_fkey',
    'cle_draws_from_entry_id_fkey',
    'cle_reverses_entry_id_fkey',
    'csb_settlement_id_fkey'
  ];
  expected_tables text[] := ARRAY[
    'contractor_contracts', 'contract_scope_items', 'contract_scope_rate_revisions',
    'contract_milestones', 'contract_amendments', 'contractor_contract_payments',
    'project_contractor_labour_rate_revisions', 'contractor_settlement_breakdowns'
  ];
  t text;
  i int;
BEGIN
  -- Tables.
  FOREACH t IN ARRAY expected_tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'postflight: table % missing', t;
    END IF;
  END LOOP;

  -- Enums.
  FOREACH t IN ARRAY ARRAY['ContractStatus','MilestoneStatus','ContractPaymentType',
                           'AmendmentType','AmendmentStatus'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = t) THEN
      RAISE EXCEPTION 'postflight: enum % missing', t;
    END IF;
  END LOOP;

  -- Columns, by name AND type.
  FOR i IN 1 .. array_length(expected_cols, 1) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = expected_cols[i][1]
        AND column_name = expected_cols[i][2]
        AND data_type = expected_cols[i][3]
    ) THEN
      RAISE EXCEPTION 'postflight: %.% missing or not %',
        expected_cols[i][1], expected_cols[i][2], expected_cols[i][3];
    END IF;
  END LOOP;

  -- The three new attendance columns must be NULLABLE — existing rows keep NULL
  -- and must continue resolving through the unchanged attendance-only path.
  FOR r IN
    SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'labour_attendance'
      AND column_name IN ('contract_id', 'settlement_id', 'contract_scope_rate_revision_id')
  LOOP
    IF r.is_nullable <> 'YES' THEN
      RAISE EXCEPTION 'postflight: labour_attendance.% must be nullable', r.column_name;
    END IF;
  END LOOP;

  -- Foreign keys, by exact name.
  FOREACH t IN ARRAY expected_fks LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t AND contype = 'f') THEN
      RAISE EXCEPTION 'postflight: FK % missing', t;
    END IF;
  END LOOP;

  -- The attendance FKs must be ON DELETE SET NULL (confdeltype='n'), never
  -- CASCADE: deleting an agreement or settlement must not delete attendance.
  FOREACH t IN ARRAY ARRAY['labour_attendance_contract_id_fkey',
                           'labour_attendance_settlement_id_fkey',
                           'labour_attendance_scope_rate_revision_id_fkey'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
        WHERE conname = t AND contype = 'f' AND conrelid = la AND confdeltype = 'n') THEN
      RAISE EXCEPTION 'postflight: % is not ON DELETE SET NULL', t;
    END IF;
  END LOOP;

  -- Identity index swap: the NEW 5-column NULLS NOT DISTINCT unique exists …
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'labour_attendance_proj_date_subcat_contractor_contract_key'
      AND i.indisunique AND i.indnatts = 5 AND i.indnullsnotdistinct
  ) THEN
    RAISE EXCEPTION 'postflight: 5-col NULLS NOT DISTINCT attendance unique index missing/wrong';
  END IF;
  -- … and the OLD 4-column one is gone. If it survived, a contractor's SECOND
  -- agreement silently cannot record the same labour type on a shared date.
  IF EXISTS (SELECT 1 FROM pg_indexes
      WHERE indexname = 'labour_attendance_proj_date_subcat_contractor_key') THEN
    RAISE EXCEPTION 'postflight: old 4-col attendance unique index still present';
  END IF;

  -- Payment idempotency + live scope-item uniqueness.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
      WHERE schemaname='public' AND indexname='ccp_contract_id_client_uuid_key') THEN
    RAISE EXCEPTION 'postflight: payment idempotency index missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
      WHERE schemaname='public' AND indexname='csi_contract_subcategory_live_key') THEN
    RAISE EXCEPTION 'postflight: scope-item partial unique index missing';
  END IF;

  -- NEGATIVE assertions: the wrong abstraction must not exist.
  IF EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='project_contractors'
        AND column_name='payment_model') THEN
    RAISE EXCEPTION 'postflight: project_contractors.payment_model still present';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentModel') THEN
    RAISE EXCEPTION 'postflight: PaymentModel enum still present';
  END IF;

  -- RLS enabled + named policy present on every new table.
  FOREACH t IN ARRAY expected_tables LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass('public.' || t) AND relrowsecurity) THEN
      RAISE EXCEPTION 'postflight: RLS not enabled on %', t;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies
        WHERE schemaname='public' AND tablename = t AND policyname = t || '_all') THEN
      RAISE EXCEPTION 'postflight: RLS policy missing on %', t;
    END IF;
  END LOOP;

  -- G3: the ledger's settlement FK must be RESTRICT, never CASCADE.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conname = 'contractor_ledger_entries_settlement_id_fkey'
        AND contype = 'f' AND confdeltype = 'r') THEN
    RAISE EXCEPTION 'postflight: ledger settlement FK is not ON DELETE RESTRICT';
  END IF;

  -- Scope integrity: an agreement-scoped ledger entry always carries its project.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cle_contract_requires_project') THEN
    RAISE EXCEPTION 'postflight: ledger contract-requires-project CHECK missing';
  END IF;

  -- One breakdown row per bucket, including the NULL (unattributed) bucket.
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'csb_settlement_contract_key'
      AND i.indisunique AND i.indnullsnotdistinct
  ) THEN
    RAISE EXCEPTION 'postflight: breakdown unique index missing or not NULLS NOT DISTINCT';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'ContractorLedgerType' AND e.enumlabel = 'SETTLEMENT_REVERSAL'
  ) THEN
    RAISE EXCEPTION 'postflight: SETTLEMENT_REVERSAL ledger type missing';
  END IF;

  RAISE NOTICE 'postflight: contractor agreements schema ready';
END $$;
