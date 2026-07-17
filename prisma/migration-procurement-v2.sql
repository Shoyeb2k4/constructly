-- Constructly — Procurement & Vendor Management v2 migration
-- Run AFTER `prisma migrate deploy` (which creates the new tables/columns) on
-- databases that carried Module-3 procurement data. Purely additive backfill:
-- existing PO totals were ex-GST sums of line amounts, so
--   subtotal = old total, gst = 0, grand total unchanged.
-- Existing rows never change meaning; history is preserved exactly.

begin;

-- Purchase orders: backfill the new denormalized split.
-- (New columns default to 0; only rows written before v2 need the copy.)
update public.purchase_orders
set subtotal_paise = total_paise
where subtotal_paise = 0
  and gst_paise = 0
  and total_paise <> 0;

-- Line items: gst_rate_bps / gst_paise default 0 (correct for pre-GST rows);
-- category stays null (uncategorized) — no rewrite needed.

-- Seed material-category presets for companies that don't have any yet.
update public.companies
set settings = settings || jsonb_build_object(
  'materialCategories',
  jsonb_build_array('Cement','Steel','Sand & Aggregate','Electrical','Plumbing','Paint','Hardware','Other')
)
where settings->'materialCategories' is null;

commit;
