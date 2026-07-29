-- RBAC foundation (Phase 1). Additive and backward-compatible: the legacy
-- users.role enum is left untouched and remains authoritative until the Phase 2
-- enforcement swap. This only introduces the roles table + a nullable
-- users.role_id link. Safe to run against a live database.

-- Per-company roles.
CREATE TABLE IF NOT EXISTS public.roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  key         text,
  name        text NOT NULL,
  description text,
  is_system   boolean NOT NULL DEFAULT false,
  is_owner    boolean NOT NULL DEFAULT false,
  permissions text[] NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS roles_company_id_idx ON public.roles (company_id);
-- One role name per company.
CREATE UNIQUE INDEX IF NOT EXISTS roles_company_name_key ON public.roles (company_id, name);
-- One seeded system role per key per company (custom roles have null key and are
-- excluded, so multiple custom roles per company are fine).
CREATE UNIQUE INDEX IF NOT EXISTS roles_company_key_key
  ON public.roles (company_id, key) WHERE key IS NOT NULL;

-- Link users to their role (nullable during migration; SET NULL on role delete).
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS role_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'users_role_id_fkey'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_role_id_fkey
      FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS users_role_id_idx ON public.users (role_id);
