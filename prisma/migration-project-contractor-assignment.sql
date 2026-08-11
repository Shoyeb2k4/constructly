-- Constructly — Project ↔ Contractor assignment (by work category).
--
-- ┌─ EXECUTION (production) ─────────────────────────────────────────────────┐
-- │ This is a STANDALONE, HAND-AUTHORED SQL migration — the same mechanism as │
-- │ the other prisma/migration-*.sql files. Apply it EXACTLY ONCE, directly:  │
-- │                                                                           │
-- │     psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -1 \                            │
-- │       -f prisma/migration-project-contractor-assignment.sql               │
-- │                                                                           │
-- │ ($DIRECT_URL = Supabase session pooler, port 5432 — see DEPLOYMENT.md.)   │
-- │                                                                           │
-- │ Do NOT run `prisma migrate` or `prisma db push` against production — this │
-- │ project does not use Prisma Migrate; `prisma generate` only builds the    │
-- │ client from schema.prisma and never touches the database. So the table is │
-- │ created ONCE, here, and nowhere else (no double-creation).                │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- ADDITIVE + backward-compatible: one new table + tenant/project RLS. No column
-- drops, no rewrites of existing rows, no data deletion. Existing
-- labour_attendance (including rows with contractor_id NULL and legacy
-- project+contractor rows) remains valid and readable. No assignments are
-- fabricated.
--
-- RE-RUN TOLERANT (not a blind no-op): every statement is guarded (IF NOT
-- EXISTS / pg_constraint / pg_policies checks), so re-running SKIPS objects that
-- already exist by name. This ASSUMES any same-named pre-existing object already
-- has the expected shape — the guards do not repair a mis-shaped table, index,
-- constraint or policy. The POSTFLIGHT block at the end ASSERTS the final shape
-- (columns, PK, indexes, 4 FKs, RLS, policy expression) and RAISES if anything
-- is missing or wrong, so a bad/partial pre-existing state fails loudly rather
-- than passing silently. Mirrors the tenant-scoped pattern in prisma/rls.sql and
-- the shape of prisma/migration-contractor-ledger.sql.

-- CreateTable
CREATE TABLE IF NOT EXISTS "project_contractor_assignments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "contractor_id" UUID NOT NULL,
    "labour_category_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_contractor_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (one assignment per contractor+category per project)
CREATE UNIQUE INDEX IF NOT EXISTS "project_contractor_assignments_project_id_contractor_id_lab_key"
    ON "project_contractor_assignments"("project_id", "contractor_id", "labour_category_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "project_contractor_assignments_company_id_project_id_idx"
    ON "project_contractor_assignments"("company_id", "project_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "project_contractor_assignments_company_id_contractor_id_idx"
    ON "project_contractor_assignments"("company_id", "contractor_id");

-- AddForeignKey (guarded — ADD CONSTRAINT has no IF NOT EXISTS)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_contractor_assignments_company_id_fkey') THEN
    ALTER TABLE "project_contractor_assignments"
      ADD CONSTRAINT "project_contractor_assignments_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_contractor_assignments_project_id_fkey') THEN
    ALTER TABLE "project_contractor_assignments"
      ADD CONSTRAINT "project_contractor_assignments_project_id_fkey"
      FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_contractor_assignments_contractor_id_fkey') THEN
    ALTER TABLE "project_contractor_assignments"
      ADD CONSTRAINT "project_contractor_assignments_contractor_id_fkey"
      FOREIGN KEY ("contractor_id") REFERENCES "contractors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_contractor_assignments_labour_category_id_fkey') THEN
    ALTER TABLE "project_contractor_assignments"
      ADD CONSTRAINT "project_contractor_assignments_labour_category_id_fkey"
      FOREIGN KEY ("labour_category_id") REFERENCES "labour_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ── Row-Level Security (tenant + PROJECT-scoped, mirrors prisma/rls.sql) ──
-- A PM can only read/mutate assignments for projects they can access; Owner
-- sees all. RLS is a backstop — the server enforces projects.edit + ownership.
ALTER TABLE public.project_contractor_assignments ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'project_contractor_assignments'
      AND policyname = 'project_contractor_assignments_all'
  ) THEN
    CREATE POLICY project_contractor_assignments_all ON public.project_contractor_assignments
      FOR ALL
      USING (company_id = public.current_company_id() AND public.can_access_project(project_id))
      WITH CHECK (company_id = public.current_company_id() AND public.can_access_project(project_id));
  END IF;
END $$;

-- ── POSTFLIGHT ASSERTIONS ─────────────────────────────────────────────────
-- Fail loudly if the final shape isn't exactly as intended (covers a mis-shaped
-- pre-existing object as well as a partial/failed apply). Read-only — RAISEs on
-- mismatch, changes nothing.
DO $$
DECLARE
  rel regclass := to_regclass('public.project_contractor_assignments');
BEGIN
  IF rel IS NULL THEN
    RAISE EXCEPTION 'postflight: table project_contractor_assignments does not exist';
  END IF;

  -- Exactly the 7 expected columns are present.
  IF (SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'project_contractor_assignments'
          AND column_name IN
            ('id','company_id','project_id','contractor_id','labour_category_id','created_at','updated_at')) <> 7 THEN
    RAISE EXCEPTION 'postflight: project_contractor_assignments is missing expected columns';
  END IF;

  -- Primary key.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'project_contractor_assignments_pkey' AND contype = 'p' AND conrelid = rel) THEN
    RAISE EXCEPTION 'postflight: missing primary key';
  END IF;

  -- Unique index (project, contractor, category).
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                 WHERE indexname = 'project_contractor_assignments_project_id_contractor_id_lab_key') THEN
    RAISE EXCEPTION 'postflight: missing unique index';
  END IF;

  -- Both supporting indexes.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                 WHERE indexname = 'project_contractor_assignments_company_id_project_id_idx') THEN
    RAISE EXCEPTION 'postflight: missing (company_id, project_id) index';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                 WHERE indexname = 'project_contractor_assignments_company_id_contractor_id_idx') THEN
    RAISE EXCEPTION 'postflight: missing (company_id, contractor_id) index';
  END IF;

  -- Exactly 4 foreign keys, all ON DELETE CASCADE (confdeltype = 'c').
  IF (SELECT count(*) FROM pg_constraint
        WHERE contype = 'f' AND conrelid = rel AND confdeltype = 'c') <> 4 THEN
    RAISE EXCEPTION 'postflight: expected 4 ON DELETE CASCADE foreign keys';
  END IF;

  -- RLS enabled.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = rel) THEN
    RAISE EXCEPTION 'postflight: row level security not enabled';
  END IF;

  -- Policy exists and its expression references BOTH tenant + project helpers.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'project_contractor_assignments'
      AND policyname = 'project_contractor_assignments_all'
      AND qual LIKE '%current_company_id()%'
      AND qual LIKE '%can_access_project(%'
      AND with_check LIKE '%current_company_id()%'
      AND with_check LIKE '%can_access_project(%'
  ) THEN
    RAISE EXCEPTION 'postflight: RLS policy missing or not tenant+project-scoped';
  END IF;
END $$;
