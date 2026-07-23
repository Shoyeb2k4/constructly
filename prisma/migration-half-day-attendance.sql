-- Half-day labour attendance — allow 0.5 increments in quantity_present.
-- Safe + reversible. Widening integer -> double precision preserves every
-- existing whole-number value; no data is rewritten or lost.

-- ── Up ────────────────────────────────────────────────────────────────
ALTER TABLE public.labour_attendance
  ALTER COLUMN quantity_present TYPE double precision;

-- ── Down (to reverse this migration) ──────────────────────────────────
-- Note: reversing ROUNDS any half-day values to whole numbers.
--   ALTER TABLE public.labour_attendance
--     ALTER COLUMN quantity_present TYPE integer
--     USING round(quantity_present)::integer;
