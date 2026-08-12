-- Constructly — Owner Force Delete for Labour Group / Labour Type.
--
-- ┌─ EXECUTION (production) ─────────────────────────────────────────────────┐
-- │ STANDALONE hand-authored SQL migration. Apply EXACTLY ONCE, in lockstep    │
-- │ with the code deploy:                                                      │
-- │                                                                            │
-- │     psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -1 \                             │
-- │       -f prisma/migration-labour-force-delete.sql                          │
-- │                                                                            │
-- │ The -1 flag wraps it in ONE transaction: additive + index swap are atomic. │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- WHAT CHANGES
-- Owner Force Delete DEACTIVATES (soft-deletes) a labour group / labour type
-- rather than physically deleting it, so historical attendance keeps resolving
-- the labour-type / group name via its surviving row (attendance already
-- snapshots rate + cost). Config rows (project_contractor_labour_rates,
-- project_contractor_assignments) are the only things truly deleted — by the
-- application, not by cascade. Nothing here changes FK ON DELETE behaviour.
--
-- 1. Adds nullable `deleted_at` + `deleted_by_id` (FK → users, ON DELETE SET
--    NULL) to labour_categories and labour_subcategories.
-- 2. Replaces the plain name-uniqueness constraints with PARTIAL unique indexes
--    scoped to WHERE deleted_at IS NULL, so a name freed by a soft-delete can be
--    reused while active duplicates are still rejected:
--      OLD  UNIQUE (company_id, name)          on labour_categories
--      NEW  UNIQUE (company_id, name)   WHERE deleted_at IS NULL
--      OLD  UNIQUE (category_id, name)         on labour_subcategories
--      NEW  UNIQUE (category_id, name)  WHERE deleted_at IS NULL
-- 3. Adds (company_id, deleted_at) indexes for the active-row list queries.
--
-- SAFETY
-- • Purely ADDITIVE columns; existing rows get deleted_at = NULL (active).
-- • The new partial unique indexes are created BEFORE the old constraints are
--   dropped; if any ACTIVE duplicate somehow existed the CREATE fails and the
--   whole transaction rolls back — nothing is lost.
-- • Idempotent / re-run tolerant via IF [NOT] EXISTS guards.

-- ── 1. Soft-delete columns + actor FK (guarded) ───────────────────────────
ALTER TABLE "labour_categories"
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deleted_by_id" UUID;

ALTER TABLE "labour_subcategories"
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deleted_by_id" UUID;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'labour_categories_deleted_by_id_fkey') THEN
    ALTER TABLE "labour_categories"
      ADD CONSTRAINT "labour_categories_deleted_by_id_fkey"
      FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'labour_subcategories_deleted_by_id_fkey') THEN
    ALTER TABLE "labour_subcategories"
      ADD CONSTRAINT "labour_subcategories_deleted_by_id_fkey"
      FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── 2. Partial unique indexes (create NEW before dropping OLD) ─────────────
CREATE UNIQUE INDEX IF NOT EXISTS "labour_categories_company_name_active_key"
  ON "labour_categories" ("company_id", "name")
  WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "labour_subcategories_category_name_active_key"
  ON "labour_subcategories" ("category_id", "name")
  WHERE "deleted_at" IS NULL;

-- Drop the old blanket unique constraints (Prisma named them *_key). Only after
-- the partial replacements exist above.
ALTER TABLE "labour_categories"     DROP CONSTRAINT IF EXISTS "labour_categories_company_id_name_key";
DROP INDEX IF EXISTS "labour_categories_company_id_name_key";
ALTER TABLE "labour_subcategories"  DROP CONSTRAINT IF EXISTS "labour_subcategories_category_id_name_key";
DROP INDEX IF EXISTS "labour_subcategories_category_id_name_key";

-- ── 3. Active-row list indexes ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "labour_categories_company_deleted_at_idx"
  ON "labour_categories" ("company_id", "deleted_at");
CREATE INDEX IF NOT EXISTS "labour_subcategories_company_deleted_at_idx"
  ON "labour_subcategories" ("company_id", "deleted_at");

-- ── POSTFLIGHT ASSERTIONS ─────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='labour_categories' AND column_name='deleted_at') THEN
    RAISE EXCEPTION 'postflight: labour_categories.deleted_at missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='labour_subcategories' AND column_name='deleted_at') THEN
    RAISE EXCEPTION 'postflight: labour_subcategories.deleted_at missing';
  END IF;
  -- Partial unique indexes present.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='labour_categories_company_name_active_key') THEN
    RAISE EXCEPTION 'postflight: labour_categories partial unique index missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='labour_subcategories_category_name_active_key') THEN
    RAISE EXCEPTION 'postflight: labour_subcategories partial unique index missing';
  END IF;
  -- Old blanket uniques gone.
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='labour_categories_company_id_name_key') THEN
    RAISE EXCEPTION 'postflight: old labour_categories unique still present';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='labour_subcategories_category_id_name_key') THEN
    RAISE EXCEPTION 'postflight: old labour_subcategories unique still present';
  END IF;
END $$;

-- ── Down (to reverse this migration) ──────────────────────────────────────
--   DROP INDEX IF EXISTS labour_subcategories_company_deleted_at_idx;
--   DROP INDEX IF EXISTS labour_categories_company_deleted_at_idx;
--   DROP INDEX IF EXISTS labour_subcategories_category_name_active_key;
--   DROP INDEX IF EXISTS labour_categories_company_name_active_key;
--   -- (recreate blanket uniques only if every deleted_at IS NULL)
--   ALTER TABLE labour_subcategories DROP CONSTRAINT IF EXISTS labour_subcategories_deleted_by_id_fkey;
--   ALTER TABLE labour_categories    DROP CONSTRAINT IF EXISTS labour_categories_deleted_by_id_fkey;
--   ALTER TABLE labour_subcategories DROP COLUMN IF EXISTS deleted_by_id, DROP COLUMN IF EXISTS deleted_at;
--   ALTER TABLE labour_categories    DROP COLUMN IF EXISTS deleted_by_id, DROP COLUMN IF EXISTS deleted_at;
