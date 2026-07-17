# Deployment Guide

_Production deployment on Vercel + Supabase. Follow top to bottom for a first launch._

## Architecture

- **App**: Next.js 16 (App Router) on Vercel — serverless functions + edge static.
- **Database**: Supabase PostgreSQL with Row-Level Security.
- **Auth**: Supabase Auth (email/password + Google OAuth).
- **Storage**: Supabase Storage (project + vendor documents).

## Prerequisites

- Node 22+, a Vercel account, a Supabase project.
- `DATABASE_URL` (pooled) and `DIRECT_URL` (direct, for migrations) from Supabase.
- Supabase `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## Environment variables

| Var | Where | Notes |
|---|---|---|
| `DATABASE_URL` | Vercel (server) | Pooled connection (pgBouncer). |
| `DIRECT_URL` | Vercel (server) | Direct connection for `prisma migrate deploy`. |
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel (public) | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel (public) | |
| `CONSTRUCTLY_DEMO` | **unset in prod** | Setting it bypasses auth — never enable in production. |

## Database setup

```bash
# 1. Apply the schema (creates tables, enums, indexes)
npx prisma migrate deploy

# 2. Apply Row-Level Security policies (idempotent)
psql "$DIRECT_URL" -f prisma/rls.sql

# 3. If upgrading an existing DB with Module-3 procurement data:
psql "$DIRECT_URL" -f prisma/migration-procurement-v2.sql   # GST/payments backfill
psql "$DIRECT_URL" -f prisma/migration-labour-hierarchy.sql # if pre-hierarchy labour
```

RLS is **not optional** — the app assumes it. Verify with a cross-tenant read as a non-owner (should return zero rows).

## Supabase configuration

- Enable email + Google auth providers; set the site URL + redirect URLs to the production domain.
- Create Storage buckets for documents; scope object policies per `company_id`.
- Confirm the CSP `connect-src` in `next.config.ts` includes your Supabase project URL.

## Deploy

```bash
vercel --prod       # or connect the Git repo for push-to-deploy
```

Vercel runs `next build` (typechecks + builds). The security headers in `next.config.ts` ship automatically.

## Post-deploy verification

- `GET /api/health` → `{ status: "ok" }`; `GET /api/health?deep=1` → `database: "ok"`.
- Sign in as an owner; create a project; confirm RLS by signing in as a PM and checking scoped visibility.
- Confirm security headers: `curl -sI https://<domain> | grep -i "content-security-policy\|strict-transport"`.
- Run the [Production Checklist](./production-checklist.md).

## Scaling notes

- The `/api/sync` rate limiter is in-process. For multi-instance, back it with Redis/Upstash (swap `src/lib/rate-limit.ts` store; interface unchanged).
- Wire `reportError()` in `src/lib/logger.ts` to Sentry for production error tracking.
- Prisma uses the pooled `DATABASE_URL` at runtime and `DIRECT_URL` only for migrations.

## Rollback

Vercel keeps immutable deployments — promote a previous build instantly. Database migrations are forward-only; take a Supabase snapshot before `migrate deploy`.
