-- Rollback for the RBAC foundation (Phase 1). Restores the exact pre-RBAC schema.
-- This is safe and lossless with respect to authorization because the legacy
-- `users.role` enum was NEVER modified — it remained the source of truth the
-- whole time. Dropping these additive objects returns the app to its prior
-- behaviour. (Any role assignments captured in these tables are discarded.)
--
-- Order matters: drop the junction (references roles + users), then the
-- users.role_id link, then the roles table.

DROP TABLE IF EXISTS public.user_roles;

ALTER TABLE public.users DROP COLUMN IF EXISTS role_id;

DROP TABLE IF EXISTS public.roles;
