# Environment Variables

_Every variable Constructly reads, where it comes from, and where it must be set. Template: [`.env.example`](../.env.example)._

## Reference

| Variable | Scope | Required | Source | Notes |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Client + Server | ✅ prod | Supabase → Settings → API | e.g. `https://<ref>.supabase.co`. Public by design. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Client + Server | ✅ prod | Supabase → Settings → API keys | `sb_publishable_…`. Public by design; RLS is the real guard. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client + Server | alt | Supabase (legacy) | Legacy JWT anon key — accepted if the publishable key isn't set. |
| `DATABASE_URL` | Server | ✅ prod | Supabase → Connect → **Transaction pooler** | Port **6543**, `?pgbouncer=true&connection_limit=1`. App runtime (serverless). |
| `DIRECT_URL` | Server | ✅ prod | Supabase → Connect → **Session pooler** | Port **5432**. Used by Prisma for migrations. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | optional | Supabase → Settings → API keys | **Secret.** Bypasses RLS — never expose to the client. Currently unused by the app (reserved for admin tooling). |
| `CONSTRUCTLY_DEMO` | Server | dev only | — | `1` serves the seeded demo company without auth. **MUST be unset in production.** |
| `SUPABASE_DB_PASSWORD` | local helper | — | Supabase → Settings → Database | Only read by `scripts/deploy-production.mjs` to build the pooler URLs. Never deployed. |

`NEXT_PUBLIC_*` values are inlined into the client bundle at build time — only ever put publishable, non-secret values there. Everything else stays server-side.

## Connection strings (important)

Vercel/serverless runs behind IPv4 and short-lived functions, so **use the Supavisor pooler, not the direct `db.<ref>` host** (that host is IPv6-only from many networks and exhausts connections under serverless):

```
# App runtime — transaction pooler, port 6543
DATABASE_URL="postgresql://postgres.<ref>:<password>@aws-1-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"

# Migrations — session pooler, port 5432
DIRECT_URL="postgresql://postgres.<ref>:<password>@aws-1-<region>.pooler.supabase.com:5432/postgres"
```

URL-encode special characters in the password (`@`→`%40`, `:`→`%3A`, `/`→`%2F`, `#`→`%23`). `scripts/deploy-production.mjs` does this for you from `SUPABASE_DB_PASSWORD`.

## Where each is set

- **Local dev** (`.env.local`, gitignored): all of the above, or none (falls back to demo mode).
- **Vercel Production**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL`, `DIRECT_URL`. **Do not** set `CONSTRUCTLY_DEMO`.
- **Vercel Preview**: the public Supabase pair (same project, or a staging project). Preview deployments authenticate against whatever Supabase project you point them at.
- **CI (GitHub Actions)**: `CONSTRUCTLY_DEMO=1` only — tests + build run against demo mode, no live DB.

## Verify

```bash
vercel env ls                       # names + scopes (values encrypted)
curl -s https://<domain>/api/health?deep=1   # { status: ok, database: ok }
```

## Rotation

Rotating the DB password (Supabase → Settings → Database → Reset) invalidates `DATABASE_URL`/`DIRECT_URL` everywhere — re-run `scripts/deploy-production.mjs` (updates local + Vercel + redeploys). Rotating the publishable key: update it in Supabase, then in Vercel, then redeploy. The service-role key rotates independently and should be treated like a root credential.
