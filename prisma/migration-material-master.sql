-- Constructly — Material Master foundation (Vendor → Material → PO, Pass 1).
--
-- ┌─ EXECUTION (production) ─────────────────────────────────────────────────┐
-- │ STANDALONE, HAND-AUTHORED SQL migration — the same mechanism as the other │
-- │ prisma/migration-*.sql files. Apply EXACTLY ONCE, in lockstep with the    │
-- │ code deploy:                                                              │
-- │                                                                           │
-- │     psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -1 \                            │
-- │       -f prisma/migration-material-master.sql                             │
-- │                                                                           │
-- │ ($DIRECT_URL = Supabase session pooler, port 5432 — see DEPLOYMENT.md.)   │
-- │ The -1 flag wraps everything in ONE transaction: DDL, backfill and RLS    │
-- │ are atomic. A failure anywhere leaves the database exactly as it was.     │
-- │                                                                           │
-- │ Do NOT run `prisma migrate` or `prisma db push` against production — this │
-- │ project does not use Prisma Migrate; `prisma generate` only builds the    │
-- │ client from schema.prisma and never touches the database.                 │
-- └───────────────────────────────────────────────────────────────────────────┘
--
-- ┌─ ORDERING / DEPENDENCIES ────────────────────────────────────────────────┐
-- │ DEPENDS ON (must already exist): companies, users, vendors,              │
-- │   po_line_items, and public.current_company_id() from prisma/rls.sql.    │
-- │   All of these predate this migration — they come from migrations-init.  │
-- │                                                                          │
-- │ INDEPENDENT OF migration-contractor-contracts.sql. This migration reads  │
-- │ and writes NOTHING that migration creates or alters (contractor_         │
-- │ contracts, contract_scope_items, contract_milestones, contract_          │
-- │ amendments, contractor_contract_payments). Either order is safe.         │
-- └──────────────────────────────────────────────────────────────────────────┘
--
-- WHAT CHANGES
-- 1. NEW TABLE `materials` — the company-scoped material master. Soft-deleted
--    (deactivated) rather than destroyed, exactly like labour_categories, so a
--    historical reference always resolves.
-- 2. NEW TABLE `vendor_materials` — "this vendor normally supplies this
--    material". ELIGIBILITY ONLY: no quantities, no amounts, no dates, no
--    history. Composite PK (vendor_id, material_id) makes a duplicate mapping
--    structurally impossible.
-- 3. `po_line_items` gains a NULLABLE `material_id` column. The existing
--    `material` TEXT column is UNCHANGED and remains the frozen PO document
--    snapshot. No existing PO row is rewritten; none is required to resolve to
--    a material.
-- 4. BACKFILL: the master is seeded from the existing vendors.materials_supplied
--    arrays, and vendor_materials mappings are created from them.
--    vendors.materials_supplied itself is READ ONLY here — never written,
--    never cleared, never dropped.
-- 5. RLS: both new tables are tenant-isolated with the standard
--    company_id = public.current_company_id() policy from prisma/rls.sql.
--
-- TENANT INTEGRITY (why a cross-company link is impossible, not just unlikely)
-- vendor_materials carries its own company_id AND references its parents
-- through COMPOSITE foreign keys:
--     (vendor_id,   company_id) -> vendors(id,   company_id)
--     (material_id, company_id) -> materials(id, company_id)
-- A row therefore cannot name a vendor from one company and a material from
-- another: there is no company_id that satisfies both FKs. This holds even if
-- RLS were bypassed (service role, direct psql) and regardless of what the
-- application sends. RLS and server-side validation are additional layers, not
-- the only ones. Prisma cannot model a composite FK whose columns overlap
-- between two relations, so schema.prisma declares single-column relations and
-- documents that the database is authoritative — the same divergence the
-- partial unique indexes on labour_categories already carry.
--
-- SAFETY
-- • Purely ADDITIVE. No column is dropped, no existing row is UPDATEd, no data
--   is deleted. vendors.materials_supplied survives untouched.
-- • po_line_items.material_id is nullable with no default: every existing line
--   keeps material_id = NULL and stays valid forever.
-- • ON DELETE SET NULL on po_line_items.material_id — even a hard delete of a
--   master row only clears the key; the `material` snapshot text is untouched.
-- • RE-RUN TOLERANT (not a blind no-op): every statement is guarded (IF [NOT]
--   EXISTS / pg_constraint / pg_policies checks, ON CONFLICT DO NOTHING on the
--   backfill), so a re-run SKIPS what already exists by name. The guards assume
--   a same-named pre-existing object already has the expected shape; the
--   POSTFLIGHT block at the end ASSERTS the final shape and RAISEs if anything
--   is missing or wrong, so a partial or mis-shaped apply fails loudly.

-- ── 1. materials ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "materials" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "default_unit" TEXT,
    "hsn_code" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMP(3),
    "deleted_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- Active-name uniqueness: CASE-INSENSITIVE, per company, ACTIVE rows only.
-- A partial EXPRESSION unique index — Prisma can express neither half, which is
-- why schema.prisma omits the compile-time @@unique (see LabourCategory for the
-- same convention).
--   • "Cement" and "cement" cannot both be ACTIVE in one company.
--   • Two DIFFERENT companies may each have an active "Cement".
--   • Deactivating (deleted_at IS NOT NULL) frees the name for reuse, and the
--     deactivated row keeps existing so history still resolves.
CREATE UNIQUE INDEX IF NOT EXISTS "materials_company_name_active_key"
    ON "materials" ("company_id", lower("name"))
    WHERE "deleted_at" IS NULL;

-- Active-row list queries.
CREATE INDEX IF NOT EXISTS "materials_company_id_deleted_at_idx"
    ON "materials" ("company_id", "deleted_at");

-- Category grouping / filtering.
CREATE INDEX IF NOT EXISTS "materials_company_id_category_idx"
    ON "materials" ("company_id", "category");

-- Backs the COMPOSITE FK from vendor_materials. `id` is already the primary
-- key, so (id, company_id) is trivially unique — this can never reject a row.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'materials_id_company_id_key') THEN
    ALTER TABLE "materials"
      ADD CONSTRAINT "materials_id_company_id_key" UNIQUE ("id", "company_id");
  END IF;
END $$;

-- AddForeignKey (guarded — ADD CONSTRAINT has no IF NOT EXISTS)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'materials_company_id_fkey') THEN
    ALTER TABLE "materials"
      ADD CONSTRAINT "materials_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  -- The actor who deactivated the row. SET NULL so removing a user never
  -- destroys master data.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'materials_deleted_by_id_fkey') THEN
    ALTER TABLE "materials"
      ADD CONSTRAINT "materials_deleted_by_id_fkey"
      FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── 2. vendors: compound unique backing the composite FK ──────────────────
-- Additive and never rejecting, for the same reason as materials above.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendors_id_company_id_key') THEN
    ALTER TABLE "vendors"
      ADD CONSTRAINT "vendors_id_company_id_key" UNIQUE ("id", "company_id");
  END IF;
END $$;

-- ── 3. vendor_materials ───────────────────────────────────────────────────
-- "This vendor normally supplies this material." Eligibility/config only.
-- Deliberately has NO quantity, amount, date or status column: what was
-- ordered lives on po_line_items, what arrived on goods_receipt_items.
CREATE TABLE IF NOT EXISTS "vendor_materials" (
    "company_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Duplicate mappings are structurally impossible.
    CONSTRAINT "vendor_materials_pkey" PRIMARY KEY ("vendor_id", "material_id")
);

CREATE INDEX IF NOT EXISTS "vendor_materials_company_id_material_id_idx"
    ON "vendor_materials" ("company_id", "material_id");

-- COMPOSITE foreign keys — the cross-company guarantee. See the header.
-- ON DELETE CASCADE is correct here precisely because this table is config:
-- deleting a vendor or material removes the ELIGIBILITY row and nothing else.
-- No purchase order, PO line snapshot, goods receipt or report is reachable
-- from here, so no history can be harmed.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendor_materials_company_id_fkey') THEN
    ALTER TABLE "vendor_materials"
      ADD CONSTRAINT "vendor_materials_company_id_fkey"
      FOREIGN KEY ("company_id") REFERENCES "companies"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendor_materials_vendor_id_company_id_fkey') THEN
    ALTER TABLE "vendor_materials"
      ADD CONSTRAINT "vendor_materials_vendor_id_company_id_fkey"
      FOREIGN KEY ("vendor_id", "company_id") REFERENCES "vendors"("id", "company_id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendor_materials_material_id_company_id_fkey') THEN
    ALTER TABLE "vendor_materials"
      ADD CONSTRAINT "vendor_materials_material_id_company_id_fkey"
      FOREIGN KEY ("material_id", "company_id") REFERENCES "materials"("id", "company_id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ── 4. po_line_items.material_id (NULLABLE, additive) ─────────────────────
-- Canonical material identity for NEW data. Every existing line keeps NULL and
-- remains valid; nothing here requires a historical line to resolve to a
-- material. The `material` TEXT column is NOT touched — it stays the frozen
-- document snapshot, in the same spirit as rate_paise.
ALTER TABLE "po_line_items"
  ADD COLUMN IF NOT EXISTS "material_id" UUID;

CREATE INDEX IF NOT EXISTS "po_line_items_material_id_idx"
    ON "po_line_items" ("material_id");

-- ON DELETE SET NULL: if a master row were ever hard-deleted, the line loses
-- only its key. The snapshot text, quantity, rate, GST and amounts survive.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'po_line_items_material_id_fkey') THEN
    ALTER TABLE "po_line_items"
      ADD CONSTRAINT "po_line_items_material_id_fkey"
      FOREIGN KEY ("material_id") REFERENCES "materials"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── 5. BACKFILL from vendors.materials_supplied ───────────────────────────
-- Source: vendors.materials_supplied ONLY. Historical po_line_items.material
-- strings are deliberately NOT reconciled here — that is a separate, reviewed
-- step once the generated master has been inspected.
--
-- NORMALIZATION (exact, never fuzzy). Two strings are the same material iff
--     lower(btrim(regexp_replace(s, '\s+', ' ', 'g')))
-- is equal. That collapses leading/trailing whitespace, runs of internal
-- whitespace, and letter case — and nothing else:
--     'Cement', 'cement', 'CEMENT', '  Cement  '  ->  ONE material
--     'TMT  Steel'  and  'TMT Steel'              ->  ONE material
--     'Cement'      and  'OPC Cement'             ->  TWO materials (kept apart)
--
-- DISPLAY CASING — deterministic, "most sensible original spelling wins":
--   1. prefer a MIXED-case spelling ('Cement') over an all-upper ('CEMENT')
--      over an all-lower ('cement') one;
--   2. then the spelling that occurs most often across the company's vendors;
--   3. then lexicographic order, purely so the result is reproducible.
-- This mirrors normalizeMaterialName() / pickDisplayName() in
-- src/features/procurement/material-backfill.ts, which is unit-tested. The two
-- MUST be kept in lockstep.
WITH exploded AS (
  SELECT
    v."company_id"                                          AS company_id,
    v."id"                                                  AS vendor_id,
    btrim(regexp_replace(raw.name, '\s+', ' ', 'g'))        AS display_name,
    lower(btrim(regexp_replace(raw.name, '\s+', ' ', 'g'))) AS norm_name
  FROM "vendors" v
  CROSS JOIN LATERAL unnest(v."materials_supplied") AS raw(name)
  -- Blank / whitespace-only entries are not materials.
  WHERE btrim(regexp_replace(raw.name, '\s+', ' ', 'g')) <> ''
),
-- Count each distinct original spelling FIRST: a window function may not be
-- nested inside another window function's ORDER BY, so the tally has to be its
-- own aggregation step.
spellings AS (
  SELECT company_id, norm_name, display_name, count(*) AS uses
  FROM exploded
  GROUP BY company_id, norm_name, display_name
),
ranked AS (
  SELECT
    company_id,
    norm_name,
    display_name,
    row_number() OVER (
      PARTITION BY company_id, norm_name
      ORDER BY
        CASE
          WHEN display_name <> lower(display_name)
           AND display_name <> upper(display_name) THEN 0   -- mixed case
          WHEN display_name  = upper(display_name)
           AND display_name <> lower(display_name) THEN 1   -- ALL UPPER
          ELSE 2                                            -- all lower
        END,
        uses DESC,
        display_name
    ) AS rn
  FROM spellings
)
INSERT INTO "materials" ("id", "company_id", "name", "display_order", "created_at", "updated_at")
SELECT gen_random_uuid(), r.company_id, r.display_name, 0, now(), now()
FROM ranked r
WHERE r.rn = 1
-- Re-run tolerant, and harmless if an active material already exists under this
-- normalized name (the partial unique index is what we conflict on).
ON CONFLICT ("company_id", lower("name")) WHERE "deleted_at" IS NULL
DO NOTHING;

-- Map every vendor to the material its (normalized) string resolves to.
-- Joins on the SAME normalization, and on company_id, so a vendor can only ever
-- be mapped to its own company's material.
INSERT INTO "vendor_materials" ("company_id", "vendor_id", "material_id", "created_at")
SELECT DISTINCT
  e.company_id,
  e.vendor_id,
  m."id",
  now()
FROM (
  SELECT
    v."company_id"                                          AS company_id,
    v."id"                                                  AS vendor_id,
    lower(btrim(regexp_replace(raw.name, '\s+', ' ', 'g'))) AS norm_name
  FROM "vendors" v
  CROSS JOIN LATERAL unnest(v."materials_supplied") AS raw(name)
  WHERE btrim(regexp_replace(raw.name, '\s+', ' ', 'g')) <> ''
) e
JOIN "materials" m
  ON m."company_id" = e.company_id
 AND lower(m."name") = e.norm_name
 AND m."deleted_at" IS NULL
ON CONFLICT ("vendor_id", "material_id") DO NOTHING;

-- NOTE: vendors.materials_supplied is READ above and never written. It stays in
-- place as the legacy source of truth until a later, separate pass retires it.

-- ── 6. Row-Level Security (tenant-scoped, mirrors prisma/rls.sql) ─────────
ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'materials'
      AND policyname = 'materials_tenant'
  ) THEN
    CREATE POLICY materials_tenant ON public.materials
      FOR ALL
      USING (company_id = public.current_company_id())
      WITH CHECK (company_id = public.current_company_id());
  END IF;
END $$;

ALTER TABLE public.vendor_materials ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'vendor_materials'
      AND policyname = 'vendor_materials_tenant'
  ) THEN
    CREATE POLICY vendor_materials_tenant ON public.vendor_materials
      FOR ALL
      USING (company_id = public.current_company_id())
      WITH CHECK (company_id = public.current_company_id());
  END IF;
END $$;

-- ── POSTFLIGHT ASSERTIONS ─────────────────────────────────────────────────
-- Fail loudly if the final shape isn't exactly as intended (covers a mis-shaped
-- pre-existing object as well as a partial/failed apply). Read-only — RAISEs on
-- mismatch, changes nothing.
DO $$
DECLARE
  mat  regclass := to_regclass('public.materials');
  vm   regclass := to_regclass('public.vendor_materials');
  poli regclass := to_regclass('public.po_line_items');
  orphans bigint;
BEGIN
  IF mat IS NULL THEN RAISE EXCEPTION 'postflight: table materials does not exist'; END IF;
  IF vm  IS NULL THEN RAISE EXCEPTION 'postflight: table vendor_materials does not exist'; END IF;

  -- materials: all 11 expected columns.
  IF (SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'materials'
          AND column_name IN ('id','company_id','name','category','default_unit','hsn_code',
                              'display_order','deleted_at','deleted_by_id','created_at','updated_at')) <> 11 THEN
    RAISE EXCEPTION 'postflight: materials is missing expected columns';
  END IF;

  -- vendor_materials: exactly the 4 expected columns, and NOTHING transactional.
  IF (SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'vendor_materials') <> 4 THEN
    RAISE EXCEPTION 'postflight: vendor_materials must have exactly 4 columns (no quantities/amounts)';
  END IF;

  -- Composite PK on (vendor_id, material_id) — duplicates impossible.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vendor_materials_pkey' AND contype = 'p' AND conrelid = vm
      AND array_length(conkey, 1) = 2
  ) THEN
    RAISE EXCEPTION 'postflight: vendor_materials composite primary key missing';
  END IF;

  -- The case-insensitive partial unique index on materials.
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'materials_company_name_active_key'
      AND indexdef LIKE '%lower(name)%'
      AND indexdef LIKE '%deleted_at IS NULL%'
  ) THEN
    RAISE EXCEPTION 'postflight: materials case-insensitive partial unique index missing or weakened';
  END IF;

  -- Composite FKs — the cross-company guarantee. Both must be 2-column.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vendor_materials_vendor_id_company_id_fkey'
      AND contype = 'f' AND conrelid = vm AND array_length(conkey, 1) = 2
  ) THEN
    RAISE EXCEPTION 'postflight: composite FK to vendors missing — cross-company links would be possible';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vendor_materials_material_id_company_id_fkey'
      AND contype = 'f' AND conrelid = vm AND array_length(conkey, 1) = 2
  ) THEN
    RAISE EXCEPTION 'postflight: composite FK to materials missing — cross-company links would be possible';
  END IF;

  -- po_line_items.material_id exists, is NULLABLE, and its FK is ON DELETE SET NULL.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'po_line_items'
      AND column_name = 'material_id' AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'postflight: po_line_items.material_id missing or NOT NULL';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'po_line_items_material_id_fkey'
      AND contype = 'f' AND conrelid = poli AND confdeltype = 'n'   -- 'n' = SET NULL
  ) THEN
    RAISE EXCEPTION 'postflight: po_line_items.material_id FK missing or not ON DELETE SET NULL';
  END IF;

  -- The PO document snapshot column is still there and still NOT NULL.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'po_line_items'
      AND column_name = 'material' AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'postflight: po_line_items.material snapshot column was altered — it must remain NOT NULL';
  END IF;

  -- The legacy vendor array survives untouched.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'vendors'
      AND column_name = 'materials_supplied'
  ) THEN
    RAISE EXCEPTION 'postflight: vendors.materials_supplied was dropped — it must be retained in this pass';
  END IF;

  -- Backfill completeness: every non-blank vendor material string resolves to a
  -- mapping in the SAME company. Zero orphans expected.
  SELECT count(*) INTO orphans
  FROM (
    SELECT v."company_id" AS company_id, v."id" AS vendor_id,
           lower(btrim(regexp_replace(raw.name, '\s+', ' ', 'g'))) AS norm_name
    FROM "vendors" v
    CROSS JOIN LATERAL unnest(v."materials_supplied") AS raw(name)
    WHERE btrim(regexp_replace(raw.name, '\s+', ' ', 'g')) <> ''
  ) e
  WHERE NOT EXISTS (
    SELECT 1
    FROM "vendor_materials" x
    JOIN "materials" m ON m."id" = x."material_id"
    WHERE x."vendor_id" = e.vendor_id
      AND x."company_id" = e.company_id
      AND lower(m."name") = e.norm_name
  );
  IF orphans > 0 THEN
    RAISE EXCEPTION 'postflight: % vendor material string(s) did not map to a material', orphans;
  END IF;

  -- RLS enabled + tenant-scoped on both tables.
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = mat) THEN
    RAISE EXCEPTION 'postflight: row level security not enabled on materials';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = vm) THEN
    RAISE EXCEPTION 'postflight: row level security not enabled on vendor_materials';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'materials' AND policyname = 'materials_tenant'
      AND qual LIKE '%current_company_id()%' AND with_check LIKE '%current_company_id()%'
  ) THEN
    RAISE EXCEPTION 'postflight: materials RLS policy missing or not tenant-scoped';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'vendor_materials' AND policyname = 'vendor_materials_tenant'
      AND qual LIKE '%current_company_id()%' AND with_check LIKE '%current_company_id()%'
  ) THEN
    RAISE EXCEPTION 'postflight: vendor_materials RLS policy missing or not tenant-scoped';
  END IF;
END $$;

-- ── Down (to reverse this migration) ──────────────────────────────────────
-- Note: this DISCARDS the generated master and its vendor mappings. Nothing
-- else is lost — vendors.materials_supplied was never modified, and PO lines
-- only lose the material_id key, keeping their `material` snapshot text.
--   ALTER TABLE po_line_items   DROP CONSTRAINT IF EXISTS po_line_items_material_id_fkey;
--   DROP INDEX IF EXISTS po_line_items_material_id_idx;
--   ALTER TABLE po_line_items   DROP COLUMN IF EXISTS material_id;
--   DROP TABLE IF EXISTS vendor_materials;
--   ALTER TABLE vendors         DROP CONSTRAINT IF EXISTS vendors_id_company_id_key;
--   DROP TABLE IF EXISTS materials;
