-- At most one PENDING invitation per (company, email) — makes "no duplicate
-- invitations" hold even under concurrent invites. Prisma has no partial unique,
-- so this lives as raw SQL (the project uses manual SQL migrations).
CREATE UNIQUE INDEX IF NOT EXISTS invitations_pending_unique
  ON public.invitations (company_id, email)
  WHERE status = 'PENDING';
