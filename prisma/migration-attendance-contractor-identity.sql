-- Constructly — Attendance identity becomes contractor-aware.
--
-- ┌─ EXECUTION (production) ─────────────────────────────────────────────────┐
-- │ STANDALONE hand-authored SQL migration. Apply EXACTLY ONCE, AFTER          │
-- │ migration-project-contractors.sql, in lockstep with the code deploy:       │
-- │                                                                            │
-- │     psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -1 \                             │
-- │       -f prisma/migration-attendance-contractor-identity.sql               │
-- │                                                                            │
-- │ The -1 flag wraps it in ONE transaction: the index swap is atomic.         │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- WHAT CHANGES
-- 1. Adds nullable labour_attendance.project_contractor_labour_rate_id (rate
--    provenance; FK → project_contractor_labour_rates, ON DELETE SET NULL so
--    editing/removing a rate never destroys attendance history).
-- 2. Replaces the attendance identity so two contractors can supply the SAME
--    subcategory on the same project/date:
--      OLD  UNIQUE (project_id, date, labour_subcategory_id)
--      NEW  UNIQUE (project_id, date, labour_subcategory_id, contractor_id)
--           NULLS NOT DISTINCT
--    NULLS NOT DISTINCT (Postgres 15+) treats the 28 legacy contractor_id=NULL
--    rows as one-row-per-triple (unchanged), while real contractors each get
--    their own row. Prisma's compound-unique accessor matches these columns.
--
-- SAFETY
-- • ADDITIVE first: the new unique index is created and validated BEFORE the old
--   one is dropped. If any duplicate exists under the new key the CREATE fails
--   and the whole transaction rolls back — nothing is lost.
-- • A PRE-FLIGHT guard RAISEs if duplicates exist under the new key (read-only
--   inspection on 2026-08-12 showed 0 across 76 rows; this re-checks at apply
--   time in case data drifted).
-- • Legacy rows (contractor_id NULL, existing rate snapshots, estimated cost)
--   are never rewritten. Idempotent/re-run tolerant via IF [NOT] EXISTS guards.

-- ── 1. Rate-provenance column + FK (guarded) ──────────────────────────────
ALTER TABLE "labour_attendance"
  ADD COLUMN IF NOT EXISTS "project_contractor_labour_rate_id" UUID;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'labour_attendance_project_contractor_labour_rate_id_fkey') THEN
    ALTER TABLE "labour_attendance"
      ADD CONSTRAINT "labour_attendance_project_contractor_labour_rate_id_fkey"
      FOREIGN KEY ("project_contractor_labour_rate_id")
      REFERENCES "project_contractor_labour_rates"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── 2. PRE-FLIGHT: refuse to proceed if duplicates exist under the new key ──
-- (NULLS NOT DISTINCT semantics: NULL contractor_id folded to a fixed sentinel.)
DO $$
DECLARE
  dup_groups bigint;
BEGIN
  SELECT count(*) INTO dup_groups FROM (
    SELECT project_id, date, labour_subcategory_id,
           COALESCE(contractor_id, '00000000-0000-0000-0000-000000000000'::uuid) AS cc,
           count(*) c
    FROM public.labour_attendance
    GROUP BY 1,2,3,4
    HAVING count(*) > 1
  ) d;
  IF dup_groups > 0 THEN
    RAISE EXCEPTION 'preflight: % duplicate (project,date,subcategory,contractor) group(s) — resolve before migrating', dup_groups;
  END IF;
END $$;

-- ── 3. Create the NEW contractor-aware unique index (NULLS NOT DISTINCT) ────
CREATE UNIQUE INDEX IF NOT EXISTS "labour_attendance_proj_date_subcat_contractor_key"
  ON "labour_attendance" ("project_id", "date", "labour_subcategory_id", "contractor_id")
  NULLS NOT DISTINCT;

-- ── 4. Drop the OLD 3-column unique index (only after the new one exists) ────
DROP INDEX IF EXISTS "labour_attendance_project_id_date_labour_subcategory_id_key";

-- ── POSTFLIGHT ASSERTIONS ─────────────────────────────────────────────────
DO $$
DECLARE
  rel regclass := to_regclass('public.labour_attendance');
BEGIN
  -- New column present.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='labour_attendance'
        AND column_name='project_contractor_labour_rate_id') THEN
    RAISE EXCEPTION 'postflight: project_contractor_labour_rate_id column missing';
  END IF;

  -- Provenance FK present and ON DELETE SET NULL (confdeltype='n').
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
      WHERE conname='labour_attendance_project_contractor_labour_rate_id_fkey'
        AND contype='f' AND conrelid=rel AND confdeltype='n') THEN
    RAISE EXCEPTION 'postflight: provenance FK missing or not SET NULL';
  END IF;

  -- New unique index exists, is UNIQUE, spans 4 columns, and is NULLS NOT DISTINCT.
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname='labour_attendance_proj_date_subcat_contractor_key'
      AND i.indisunique AND i.indnatts = 4 AND i.indnullsnotdistinct
  ) THEN
    RAISE EXCEPTION 'postflight: new 4-col NULLS NOT DISTINCT unique index missing/wrong';
  END IF;

  -- Old 3-col unique index is gone.
  IF EXISTS (SELECT 1 FROM pg_indexes
      WHERE indexname='labour_attendance_project_id_date_labour_subcategory_id_key') THEN
    RAISE EXCEPTION 'postflight: old 3-col unique index still present';
  END IF;
END $$;
