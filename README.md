# Constructly

The modern construction ERP for small firms — projects, labor, procurement, and vendors in one beautiful place. Premium, minimal, offline-capable in the field.

> **Status:** Module 0 (Foundation) complete. See [`docs/roadmap.md`](docs/roadmap.md).

## Quickstart

```bash
npm install
npm run db:generate      # generate the Prisma client
npm run dev              # http://localhost:3000  (runs in demo mode, no backend needed)
```

The app boots in **demo mode** (seeded "Meridian Build Co.") so you can explore immediately.
Visit **`/style`** for the live design-system gallery.

## Connecting a backend (Supabase)

1. Copy `.env.example` → `.env.local` and fill Supabase + database URLs.
2. `npm run db:migrate` — create the schema.
3. Apply RLS: run `prisma/rls.sql` against the database (tenant isolation).
4. `npm run db:seed` — seed the demo company.

Setting the Supabase env vars automatically switches off demo mode and turns on real auth.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js dev / production build / serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest unit tests |
| `npm run e2e` | Playwright E2E (`npx playwright install chromium` first) |
| `npm run db:generate` / `migrate` / `seed` | Prisma workflows |

## Stack

Next.js 16 · TypeScript · Tailwind v4 · shadcn/ui (Radix) · Prisma 6 · Supabase (Auth/Postgres/Storage) · TanStack Query · Zod · Dexie (offline).

## Documentation

`docs/` is the single source of truth: [architecture](docs/architecture.md) · [database](docs/database.md) · [api](docs/api.md) · [design-system](docs/design-system.md) · [roadmap](docs/roadmap.md) · [decisions](docs/decisions.md) · [changelog](docs/changelog.md).
