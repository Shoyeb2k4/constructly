# Installation Guide

Two paths: **run it locally in minutes** (no backend, demo mode) or **install for production** (Supabase + Vercel).

## Prerequisites

- Node.js 22+
- npm 11+
- (Production only) a Supabase project and a Vercel account

## Option A — Local / demo (no backend)

```bash
git clone <repo-url> constructly
cd constructly
npm install
npx prisma generate      # generates the Prisma client (into src/generated/prisma)
npm run dev              # http://localhost:3000
```

The app auto-runs in **demo mode** (`CONSTRUCTLY_DEMO`) when Supabase env vars are absent: a fully interactive, seeded "Meridian Build Co." backed by localStorage. This is the mode used by the browser preview and the test suite — perfect for evaluation, demos, and development.

Verify:

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

## Option B — Production install

### 1. Create the Supabase project
- Note `DATABASE_URL` (pooled) and `DIRECT_URL` (direct).
- Enable Email + Google auth providers; set site + redirect URLs.
- Create Storage bucket(s) for documents.

### 2. Configure environment
Create `.env` (local) / set in Vercel:

```
DATABASE_URL="postgresql://...pooled..."
DIRECT_URL="postgresql://...direct..."
NEXT_PUBLIC_SUPABASE_URL="https://<project>.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="<anon-key>"
# Do NOT set CONSTRUCTLY_DEMO in production.
```

### 3. Apply schema + security
```bash
npx prisma migrate deploy
psql "$DIRECT_URL" -f prisma/rls.sql
# Upgrading an existing DB? also run the data migrations:
psql "$DIRECT_URL" -f prisma/migration-procurement-v2.sql
psql "$DIRECT_URL" -f prisma/migration-labour-hierarchy.sql
```

### 4. Deploy
```bash
vercel --prod        # or connect the Git repo for push-to-deploy
```

### 5. Verify
- `GET /api/health` → ok; `GET /api/health?deep=1` → `database: ok`.
- Sign in, create a project, confirm RLS scoping as a PM.
- Walk the [Production Checklist](./docs/production-checklist.md).

Full details, scaling notes, and rollback: [docs/deployment.md](./docs/deployment.md).

## Troubleshooting

| Symptom | Fix |
|---|---|
| Prisma client errors after pulling | `npx prisma generate` |
| Stale demo data locally | Clear `constructly.demo.*` keys in localStorage and reload |
| `/api/health?deep=1` degraded | Check `DATABASE_URL`/`DIRECT_URL`; in demo mode this is expected (no DB) |
| CSP blocks Supabase | Add your project URL to `connect-src` in `next.config.ts` |
