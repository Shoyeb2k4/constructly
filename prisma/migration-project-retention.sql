-- Per-company retention policy for soft-deleted projects. Number of days after
-- deletion before a project becomes ELIGIBLE for admin/scheduled permanent
-- cleanup. NULL = keep indefinitely (the default). This never triggers an
-- automatic hard delete — it only marks eligibility for a reviewed, admin-only
-- purge. Additive and nullable — safe to run against a live database.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS project_retention_days integer;
