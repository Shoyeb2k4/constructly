# Constructly — Production Deployment

_The live production setup for this instance. Companion guides: [docs/deployment.md](docs/deployment.md) (generic runbook), [docs/environment-variables.md](docs/environment-variables.md), [docs/backup-and-recovery.md](docs/backup-and-recovery.md), [docs/rollback-guide.md](docs/rollback-guide.md), [docs/production-checklist.md](docs/production-checklist.md)._

## Stack

| Layer | Service | Detail |
|---|---|---|
| App | **Vercel** | project `constructly1/constructly`, Node build `prisma generate && next build` |
| Database | **Supabase Postgres** | project `constructly-production` (`rbteppevgibwddihqcpf`), region **ap-south-1**, Postgres 17 |
| Auth | **Supabase Auth** | email/password + Google OAuth; PKCE via `/auth/callback` |
| Storage | **Supabase Storage** | private `documents` bucket (25 MB cap, MIME allowlist, tenant-scoped policies) |

## Database (already applied)

Applied to the production project as tracked migrations:
1. `initial_schema` — full Prisma DDL (20 tables, 9 enums, indexes, FKs)
2. `rls_policies` — RLS enabled + tenant/role policies on every table
3. `storage_documents_bucket` — private bucket + tenant-scoped object policies
4. `harden_helper_functions` — revoke `anon` EXECUTE on SECURITY DEFINER helpers

Source of truth: `prisma/schema.prisma`, `prisma/rls.sql`, `prisma/migrations-init.sql`. Live types mirror: `src/lib/supabase/database.types.ts`.

## Connection strings (Supavisor pooler — required for serverless)

```
# App runtime — transaction pooler, 6543
DATABASE_URL=postgresql://postgres.rbteppevgibwddihqcpf:<pw>@aws-1-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
# Migrations — session pooler, 5432
DIRECT_URL=postgresql://postgres.rbteppevgibwddihqcpf:<pw>@aws-1-ap-south-1.pooler.supabase.com:5432/postgres
```
The direct `db.<ref>.supabase.co` host is IPv6-only from many networks and is **not** used.

## Vercel environment variables (Production)

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL`, `DIRECT_URL`.
`CONSTRUCTLY_DEMO` is **intentionally unset** so production runs with real auth.

## Deploy

```bash
# One-time after a DB-password change: fill SUPABASE_DB_PASSWORD in .env.local, then
node scripts/deploy-production.mjs     # verify DB → sync Vercel env → deploy → health

# Routine deploy (env already set):
vercel deploy --prod --yes
```

## Post-deploy: Supabase Auth URLs (do once per domain)

Supabase Dashboard → **Authentication → URL Configuration**:
- **Site URL**: the production URL
- **Redirect URLs**: `<production-url>/auth/callback`
- For Google login: enable the Google provider and add the same callback.

## Verify

```bash
curl -s <url>/api/health           # { status: "ok" }
curl -s "<url>/api/health?deep=1"  # { status: "ok", database: "ok" }
curl -sI <url>                     # CSP, HSTS, X-Frame-Options present
```
Then walk the [Production Checklist](docs/production-checklist.md).

## Rollback

Instant app rollback: Vercel → Deployments → promote the previous build. Full guide: [docs/rollback-guide.md](docs/rollback-guide.md).
