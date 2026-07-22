-- Payment idempotency — dedup key for vendor_payments.
-- Safe + reversible. Adds a nullable column and a PARTIAL unique index (only
-- where client_uuid IS NOT NULL), so existing rows (client_uuid = NULL) are
-- untouched and multiple legacy NULLs are allowed. No data is modified.

-- ── Up ────────────────────────────────────────────────────────────────
ALTER TABLE public.vendor_payments
  ADD COLUMN IF NOT EXISTS client_uuid text;

CREATE UNIQUE INDEX IF NOT EXISTS vendor_payments_client_uuid_key
  ON public.vendor_payments (client_uuid)
  WHERE client_uuid IS NOT NULL;

-- ── Down (to reverse this migration) ──────────────────────────────────
--   DROP INDEX IF EXISTS public.vendor_payments_client_uuid_key;
--   ALTER TABLE public.vendor_payments DROP COLUMN IF EXISTS client_uuid;
