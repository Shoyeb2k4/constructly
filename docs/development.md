# Development Guide

_Get productive on Constructly in minutes._

## Setup

```bash
npm install
npx prisma generate       # generates the client into src/generated/prisma (gitignored)
npm run dev               # http://localhost:3000 — runs in demo mode by default
```

No backend is required locally: without Supabase env vars the app runs in **demo mode** (`CONSTRUCTLY_DEMO`), serving the seeded "Meridian Build Co." from localStorage. This is what the browser preview and Playwright use.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind v4 (CSS-first tokens) · Prisma 6 (pinned) · Supabase · TanStack Query · Zod · Dexie.

> ⚠️ This is a newer Next.js than most training data — read the relevant guide in `node_modules/next/dist/docs/` before using an unfamiliar API. See `AGENTS.md`.

## Project shape (feature-first)

```
src/
  app/            App Router routes, layouts, error boundaries, api/
  components/     shared UI primitives (ui/) + app patterns (patterns/) + shell/
  features/<name>/
    types.ts          DTOs (money as integer paise)
    calc.ts           PURE business logic — the single source of truth (tested)
    schema.ts         Zod form/input schemas
    repository.ts     interface the UI depends on
    demo/             localStorage implementation + seed
    server/           Prisma server-actions implementation
    hooks.ts          TanStack Query hooks (optimistic)
    data.ts           selects demo vs server by isDemoMode
    components/        feature UI
  lib/            money, auth, db, sync engine, rate-limit, logger, env
```

### The repository pattern (every feature)

UI → `hooks.ts` → `data.ts` picks `demoRepository` or `serverRepository` (both satisfy the same `Repository` interface) → pure `calc.ts` for all math. Add a feature by implementing the interface twice; the UI never changes.

### Golden rules

- **Money is integer paise** (`src/lib/money.ts`). Never float. GST rates are integer basis points.
- **Business logic lives in `calc.ts`** as pure functions, consumed by demo + server + dashboard + reports so every surface agrees. Test the pure function.
- **Derive, don't store** — budget, outstanding, aging are computed from transactions, never persisted (no drift).
- **Snapshots for history** — labour rates and PO line rates freeze at record time; editing a rate never rewrites past records.
- **Three-layer auth** — UI gating + server guards + Postgres RLS. Never trust the client.
- **Immutable financial docs** — approved POs don't change; Revise clones to a linked draft.

## Commands

```bash
npm run dev         # dev server (demo mode)
npm run typecheck   # tsc --noEmit
npm run lint        # eslint --max-warnings 0
npm test            # vitest (unit + integration + permission + sync)
npm run e2e         # Playwright + axe
npm run build       # production build
```

## Common tasks

- **New money value?** Store `_paise` (BigInt in Prisma if it can exceed Int32); expose as `number` in DTOs; format with `MoneyText` / `formatPaiseCompact`.
- **New offline entity?** Register it in `src/lib/sync/registry.ts` with a Zod schema and add a handler in `/api/sync`. See [offline-sync.md](./offline-sync.md).
- **New report?** Add to the report registry and reuse the shared aggregation — never re-derive numbers.
- **Schema change?** Update `prisma/schema.prisma`, `prisma/rls.sql`, add a migration, regenerate, and update `docs/database.md` + `docs/erd.md`.

## Conventions

- React Compiler is on — no state writes during render, no ref writes in render; use the adjust-state-during-render or key-remount patterns.
- Dialogs/forms: `schema.parse(values)` in `onSubmit` before mapping to the repository input.
- Every change updates `/docs` (source of truth) and lands with tests. Commit + tag milestones. No tech debt without an ADR.
