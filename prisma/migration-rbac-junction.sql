-- RBAC future-proofing (still Phase 1, pre-enforcement): a user↔role junction so
-- multiple roles per user need no future migration, plus a role-inheritance
-- parent pointer. Additive and backward-compatible: existing single-role data is
-- mirrored into the junction by prisma/backfill-rbac.ts. Safe on a live DB.

-- Role inheritance: optional parent role.
ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS parent_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'roles_parent_id_fkey'
  ) THEN
    ALTER TABLE public.roles
      ADD CONSTRAINT roles_parent_id_fkey
      FOREIGN KEY (parent_id) REFERENCES public.roles(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS roles_parent_id_idx ON public.roles (parent_id);

-- User↔role junction (many-to-many).
CREATE TABLE IF NOT EXISTS public.user_roles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role_id        uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  is_primary     boolean NOT NULL DEFAULT false,
  assigned_by_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  assigned_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_roles_user_role_key ON public.user_roles (user_id, role_id);
CREATE INDEX IF NOT EXISTS user_roles_company_id_idx ON public.user_roles (company_id);
CREATE INDEX IF NOT EXISTS user_roles_role_id_idx ON public.user_roles (role_id);
