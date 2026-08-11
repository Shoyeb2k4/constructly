-- Constructly — Contractor-first labour: ProjectContractor + labour rates.
--
-- ┌─ EXECUTION (production) ─────────────────────────────────────────────────┐
-- │ STANDALONE hand-authored SQL migration — same mechanism as the other      │
-- │ prisma/migration-*.sql files. This project does NOT use Prisma Migrate.    │
-- │ Apply EXACTLY ONCE, directly, in lockstep with the code deploy that reads  │
-- │ the new tables:                                                            │
-- │                                                                            │
-- │     psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -1 \                             │
-- │       -f prisma/migration-project-contractors.sql                          │
-- │                                                                            │
-- │ ($DIRECT_URL = Supabase session pooler, port 5432 — see DEPLOYMENT.md.)    │
-- │ Apply migration-attendance-contractor-identity.sql AFTER this one.         │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- ADDITIVE + backward-compatible: two NEW tables + tenant/project RLS + a
-- backfill of project_contractors from the DISTINCT (project, contractor) pairs
-- already present in project_contractor_assignments (the category-level table it
-- supersedes). No column drops, no row rewrites, no deletes. The old
-- project_contractor_assignments table is LEFT IN PLACE (dropped only in a later
-- migration after the new path is verified in production). Labour rates start
-- empty — attendance falls back to the subcategory's global rate until rates are
-- configured, so there is no behaviour regression.
--
-- RE-RUN TOLERANT: every statement is guarded (IF NOT EXISTS / pg_constraint /
-- pg_policies) and the backfill uses ON CONFLICT DO NOTHING, so re-running skips
-- objects/rows that already exist. The POSTFLIGHT block ASSERTS the final shape
-- and RAISEs on any mismatch. Mirrors prisma/migration-project-contractor-assignment.sql.

-- ── CreateTable: project_contractors ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS "project_contractors" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "contractor_id" UUID NOT NULL,
    "contract_rate_paise" INTEGER,
    "contract_rate_unit" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_contractors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "project_contractors_project_id_contractor_id_key"
    ON "project_contractors"("project_id", "contractor_id");
CREATE INDEX IF NOT EXISTS "project_contractors_company_id_project_id_idx"
    ON "project_contractors"("company_id", "project_id");
CREATE INDEX IF NOT EXISTS "project_contractors_company_id_contractor_id_idx"
    ON "project_contractors"("company_id", "contractor_id");

-- ── CreateTable: project_contractor_labour_rates ──────────────────────────
CREATE TABLE IF NOT EXISTS "project_contractor_labour_rates" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_contractor_id" UUID NOT NULL,
    "labour_subcategory_id" UUID NOT NULL,
    "rate_paise" INTEGER NOT NULL,
    "rate_unit" TEXT NOT NULL DEFAULT 'day',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_contractor_labour_rates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "pclr_project_contractor_id_labour_subcategory_id_key"
    ON "project_contractor_labour_rates"("project_contractor_id", "labour_subcategory_id");
CREATE INDEX IF NOT EXISTS "pclr_company_id_project_contractor_id_idx"
    ON "project_contractor_labour_rates"("company_id", "project_contractor_id");
CREATE INDEX IF NOT EXISTS "pclr_company_id_labour_subcategory_id_idx"
    ON "project_contractor_labour_rates"("company_id", "labour_subcategory_id");

-- ── AddForeignKey (guarded — ADD CONSTRAINT has no IF NOT EXISTS) ──────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_contractors_company_id_fkey') THEN
    ALTER TABLE "project_contractors" ADD CONSTRAINT "project_contractors_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_contractors_project_id_fkey') THEN
    ALTER TABLE "project_contractors" ADD CONSTRAINT "project_contractors_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_contractors_contractor_id_fkey') THEN
    ALTER TABLE "project_contractors" ADD CONSTRAINT "project_contractors_contractor_id_fkey"
      FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pclr_company_id_fkey') THEN
    ALTER TABLE "project_contractor_labour_rates" ADD CONSTRAINT "pclr_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pclr_project_contractor_id_fkey') THEN
    ALTER TABLE "project_contractor_labour_rates" ADD CONSTRAINT "pclr_project_contractor_id_fkey"
      FOREIGN KEY ("project_contractor_id") REFERENCES "project_contractors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pclr_labour_subcategory_id_fkey') THEN
    ALTER TABLE "project_contractor_labour_rates" ADD CONSTRAINT "pclr_labour_subcategory_id_fkey"
      FOREIGN KEY ("labour_subcategory_id") REFERENCES "labour_subcategories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ── Row-Level Security (mirrors prisma/rls.sql) ───────────────────────────
-- project_contractors: tenant + project-scoped (like project_contractor_assignments).
ALTER TABLE public.project_contractors ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='project_contractors' AND policyname='project_contractors_all') THEN
    CREATE POLICY project_contractors_all ON public.project_contractors
      FOR ALL
      USING (company_id = public.current_company_id() AND public.can_access_project(project_id))
      WITH CHECK (company_id = public.current_company_id() AND public.can_access_project(project_id));
  END IF;
END $$;

-- project_contractor_labour_rates: child of project_contractors (like po_line_items).
ALTER TABLE public.project_contractor_labour_rates ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
      AND tablename='project_contractor_labour_rates' AND policyname='project_contractor_labour_rates_all') THEN
    CREATE POLICY project_contractor_labour_rates_all ON public.project_contractor_labour_rates
      FOR ALL
      USING (EXISTS (
        SELECT 1 FROM public.project_contractors pc
        WHERE pc.id = project_contractor_id
          AND pc.company_id = public.current_company_id()
          AND public.can_access_project(pc.project_id)
      ));
  END IF;
END $$;

-- ── BACKFILL (compatibility from the superseded category-level table) ──────
-- Step 1: one project_contractors row per DISTINCT (project, contractor).
INSERT INTO "project_contractors" ("id", "company_id", "project_id", "contractor_id", "created_at", "updated_at")
SELECT gen_random_uuid(), s.company_id, s.project_id, s.contractor_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT company_id, project_id, contractor_id
  FROM "project_contractor_assignments"
) s
ON CONFLICT ("project_id", "contractor_id") DO NOTHING;

-- Step 2: EXPAND each old (project, contractor, category) assignment into one
-- project_contractor_labour_rate per subcategory CURRENTLY under that category,
-- seeded at the subcategory's global daily rate (COALESCE 0 if a rate is unset).
-- This is what makes the contractor-first system usable at cutover — a
-- contractor with no labour types would show an empty attendance group.
-- (project_contractor, subcategory) is unique — a subcategory belongs to exactly
-- one category — so no duplicate rows; ON CONFLICT keeps re-runs idempotent.
-- NOTE: a placeholder category with zero subcategories (e.g. "Spare") yields no
-- rows here — that contractor keeps a project_contractors row with no labour
-- types, exactly as it was non-functional before. Real contractors are unaffected.
INSERT INTO "project_contractor_labour_rates"
  ("id", "company_id", "project_contractor_id", "labour_subcategory_id", "rate_paise", "rate_unit", "created_at", "updated_at")
SELECT gen_random_uuid(), pc."company_id", pc."id", x.subcategory_id, x.rate_paise, 'day', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT
    pca.company_id, pca.project_id, pca.contractor_id,
    sub.id AS subcategory_id,
    COALESCE(sub.daily_rate_paise, 0) AS rate_paise
  FROM "project_contractor_assignments" pca
  JOIN "labour_subcategories" sub ON sub.category_id = pca.labour_category_id
) x
JOIN "project_contractors" pc
  ON pc.project_id = x.project_id AND pc.contractor_id = x.contractor_id AND pc.company_id = x.company_id
ON CONFLICT ("project_contractor_id", "labour_subcategory_id") DO NOTHING;

-- ── POSTFLIGHT ASSERTIONS ─────────────────────────────────────────────────
DO $$
DECLARE
  pc  regclass := to_regclass('public.project_contractors');
  pclr regclass := to_regclass('public.project_contractor_labour_rates');
  expected_backfill bigint;
  actual_backfill bigint;
  missing_rates bigint;
BEGIN
  IF pc IS NULL THEN RAISE EXCEPTION 'postflight: table project_contractors missing'; END IF;
  IF pclr IS NULL THEN RAISE EXCEPTION 'postflight: table project_contractor_labour_rates missing'; END IF;

  -- project_contractors columns (8) + PK + unique + 2 indexes.
  IF (SELECT count(*) FROM information_schema.columns
        WHERE table_schema='public' AND table_name='project_contractors'
          AND column_name IN ('id','company_id','project_id','contractor_id',
              'contract_rate_paise','contract_rate_unit','created_at','updated_at')) <> 8 THEN
    RAISE EXCEPTION 'postflight: project_contractors columns wrong';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='project_contractors_pkey' AND contype='p' AND conrelid=pc) THEN
    RAISE EXCEPTION 'postflight: project_contractors PK missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='project_contractors_project_id_contractor_id_key') THEN
    RAISE EXCEPTION 'postflight: project_contractors unique index missing'; END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE contype='f' AND conrelid=pc AND confdeltype='c') <> 3 THEN
    RAISE EXCEPTION 'postflight: project_contractors expected 3 CASCADE FKs'; END IF;

  -- project_contractor_labour_rates columns (8) + PK + unique + 3 FKs.
  IF (SELECT count(*) FROM information_schema.columns
        WHERE table_schema='public' AND table_name='project_contractor_labour_rates'
          AND column_name IN ('id','company_id','project_contractor_id','labour_subcategory_id',
              'rate_paise','rate_unit','created_at','updated_at')) <> 8 THEN
    RAISE EXCEPTION 'postflight: project_contractor_labour_rates columns wrong';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='project_contractor_labour_rates_pkey' AND contype='p' AND conrelid=pclr) THEN
    RAISE EXCEPTION 'postflight: pclr PK missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='pclr_project_contractor_id_labour_subcategory_id_key') THEN
    RAISE EXCEPTION 'postflight: pclr unique index missing'; END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE contype='f' AND conrelid=pclr AND confdeltype='c') <> 3 THEN
    RAISE EXCEPTION 'postflight: pclr expected 3 CASCADE FKs'; END IF;

  -- RLS enabled on both.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=pc) THEN
    RAISE EXCEPTION 'postflight: RLS not enabled on project_contractors'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=pclr) THEN
    RAISE EXCEPTION 'postflight: RLS not enabled on project_contractor_labour_rates'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='project_contractors' AND policyname='project_contractors_all') THEN
    RAISE EXCEPTION 'postflight: project_contractors policy missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='project_contractor_labour_rates' AND policyname='project_contractor_labour_rates_all') THEN
    RAISE EXCEPTION 'postflight: pclr policy missing'; END IF;

  -- Backfill completeness: every DISTINCT (project, contractor) in the old table
  -- has a project_contractors row.
  IF to_regclass('public.project_contractor_assignments') IS NOT NULL THEN
    SELECT count(*) INTO expected_backfill
      FROM (SELECT DISTINCT project_id, contractor_id FROM public.project_contractor_assignments) s;
    SELECT count(*) INTO actual_backfill
      FROM public.project_contractors pcx
      WHERE EXISTS (SELECT 1 FROM public.project_contractor_assignments a
                    WHERE a.project_id = pcx.project_id AND a.contractor_id = pcx.contractor_id);
    IF actual_backfill < expected_backfill THEN
      RAISE EXCEPTION 'postflight: backfill incomplete (% of % pairs)', actual_backfill, expected_backfill;
    END IF;

    -- Labour-rate expansion completeness: EVERY (project_contractor, subcategory)
    -- implied by expanding the old assignments' categories must have a row.
    SELECT count(*) INTO missing_rates
    FROM (
      SELECT DISTINCT pc2.id AS pc_id, sub.id AS sub_id
      FROM public.project_contractor_assignments pca
      JOIN public.project_contractors pc2
        ON pc2.project_id = pca.project_id AND pc2.contractor_id = pca.contractor_id
      JOIN public.labour_subcategories sub ON sub.category_id = pca.labour_category_id
    ) exp
    WHERE NOT EXISTS (
      SELECT 1 FROM public.project_contractor_labour_rates r
      WHERE r.project_contractor_id = exp.pc_id AND r.labour_subcategory_id = exp.sub_id
    );
    IF missing_rates > 0 THEN
      RAISE EXCEPTION 'postflight: % expanded labour-rate row(s) missing from backfill', missing_rates;
    END IF;

    RAISE NOTICE 'postflight: backfilled % project_contractors + % labour rates',
      actual_backfill,
      (SELECT count(*) FROM public.project_contractor_labour_rates);
  END IF;
END $$;
