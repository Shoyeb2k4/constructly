-- Project soft-delete metadata: who deleted it and why. The `deleted_at`
-- column already exists; this adds the actor + reason so a soft-deleted project
-- carries a full audit trail and can be restored by the Owner. Additive and
-- nullable — safe to run against a live database.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS deleted_by_id uuid,
  ADD COLUMN IF NOT EXISTS deleted_reason text;

-- FK to users; SET NULL if the deleting user is later removed (keeps the row).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'projects_deleted_by_id_fkey'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_deleted_by_id_fkey
      FOREIGN KEY (deleted_by_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Speeds up the Owner's "recycle bin" query (company + deleted rows).
CREATE INDEX IF NOT EXISTS projects_company_deleted_at_idx
  ON public.projects (company_id, deleted_at);
