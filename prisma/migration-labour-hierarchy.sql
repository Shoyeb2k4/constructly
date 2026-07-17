-- Labour hierarchy data migration (Category → Subcategory), ADR-0023.
-- Run AFTER `prisma migrate` has created labour_subcategories and added the
-- labour_subcategory_id column. Every existing flat category becomes:
--   Category ──> Default Subcategory (same name, same rate)
-- and existing attendance is repointed — no data loss, no manual work.
--
-- Assumes the pre-migration labour_attendance still has labour_category_id
-- (run this between the additive DDL step and the column drop).

begin;

-- 1. One default subcategory per existing category (same name + rate).
insert into public.labour_subcategories
  (id, company_id, category_id, name, daily_rate_paise, display_order, created_at, updated_at)
select
  gen_random_uuid(), c.company_id, c.id, c.name, c.daily_rate_paise, 0, now(), now()
from public.labour_categories c;

-- 2. Repoint attendance at each category's default subcategory.
update public.labour_attendance a
set labour_subcategory_id = s.id
from public.labour_subcategories s
where s.category_id = a.labour_category_id;

-- 3. Category-level rate now lives on the subcategory; drop old columns
--    (Prisma's generated migration handles labour_attendance.labour_category_id
--    and labour_categories.daily_rate_paise removal after this data step).

commit;
