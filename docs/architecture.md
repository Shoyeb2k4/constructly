# Architecture

_Single source of truth for system design. Update on every architectural change (see decisions.md for the why)._

## 1. Overview

Constructly is a multi-tenant SaaS Construction ERP for small construction firms (India-first).
A Next.js application backed by Supabase (PostgreSQL, Auth, Storage), deployed on Vercel.
Field-capture flows work offline; everything else is online-first with caching.

## 2. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 15 (App Router) + TypeScript | SSR + server components + API routes |
| UI | Tailwind CSS + shadcn/ui (Radix) | Design-system-first, accessible |
| Data fetching | TanStack Query | Cache, background refetch, offline hints |
| Forms/validation | React Hook Form + Zod | **Shared** schemas client + server |
| ORM | Prisma | Migrations in git |
| Database | Supabase PostgreSQL | RLS-enforced tenant isolation |
| Auth | Supabase Auth | Email/password + Google |
| Storage | Supabase Storage | Signed URLs, tenant-isolated |
| Offline | Dexie (IndexedDB) + Background Sync | Generic reusable sync engine |
| Hosting | Vercel | Serverless; stateless functions |

## 3. Tenancy & security model

- Every domain row carries `company_id`.
- **PostgreSQL RLS** is the enforcement boundary. Policies derive the tenant from the authenticated `auth.uid()` → `users.company_id`.
- Prisma queries run under a request-scoped Postgres role; app-layer checks are defense-in-depth, not the sole guard.
- **Roles:** `OWNER` (full access) and `PROJECT_MANAGER` (assigned projects only). PM scoping is enforced server-side and in RLS where feasible.
- Every mutation validated with Zod before it touches the DB.
- Financial and status changes write to an immutable `ActivityLog` (audit trail).
- Money is integer **paise**; never float.

## 4. Offline architecture (reusable engine)

```
UI mutation ──▶ SyncEngine.enqueue(entity, op, payload)
                     │  writes to IndexedDB outbox (Dexie)
                     │  optimistic update to local cache
                     ▼
        Background Sync / online event
                     │  flush outbox in client_seq order
                     ▼
        POST /api/sync  (idempotent, upsert on client UUID)
                     │  server resolves conflicts: last-write-wins per field
                     ▼
        response: applied | conflicted[]  ──▶ conflict log surfaced in UI
```

**Reusability contract:** a module becomes offline-capable by registering a `SyncableEntity`
descriptor (table name, Zod schema, conflict strategy, id strategy). No bespoke sync code per
feature. MVP registers: `Attendance`, `PurchaseOrder` (quick-create), `Note`. `Project` basic
info is read-cached only.

Offline-capable in MVP: **Attendance, Quick PO, Quick Notes, Project basic info (read cache)**.
Online-first (graceful read caching): everything else.

## 5. Application structure (proposed)

```
constructly/
├─ docs/                      # source of truth (this folder)
├─ prisma/
│  ├─ schema.prisma
│  └─ migrations/
├─ src/
│  ├─ app/                    # Next.js App Router
│  │  ├─ (marketing)/         # public pages
│  │  ├─ (auth)/              # sign-in, sign-up, onboarding
│  │  ├─ (app)/               # authenticated shell
│  │  │  ├─ dashboard/
│  │  │  ├─ projects/
│  │  │  ├─ labor/
│  │  │  ├─ vendors/
│  │  │  ├─ procurement/
│  │  │  ├─ reports/
│  │  │  └─ settings/
│  │  └─ api/                 # route handlers (incl. /api/sync)
│  ├─ components/
│  │  ├─ ui/                  # design-system primitives (shadcn)
│  │  └─ patterns/            # composed app patterns (DataView, EmptyState…)
│  ├─ features/               # domain modules (project, labor, vendor…)
│  │  └─ <domain>/            # components, hooks, server actions, schema, types
│  ├─ lib/
│  │  ├─ db/                  # prisma client, tenant scoping
│  │  ├─ auth/                # supabase auth helpers, guards
│  │  ├─ sync/                # reusable offline engine
│  │  ├─ money/               # paise value type + formatting
│  │  └─ validation/          # shared zod schemas
│  ├─ styles/                 # tokens, globals
│  └─ config/                 # constants, feature flags
└─ tests/
```

Principle: **feature-first** organization (`src/features/<domain>`) so each module is cohesive
and independently reviewable, over a big shared components dump.

## 6. Environments

| Env | Purpose |
|---|---|
| local | Supabase local or a dev project; `.env.local` |
| preview | Vercel preview per PR |
| production | Vercel prod + Supabase prod project |

Secrets in Vercel/Supabase env vars; never committed.
