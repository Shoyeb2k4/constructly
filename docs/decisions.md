# Architecture Decision Record (ADR)

> The chronological log of **why** things are the way they are. Every architectural or
> business-logic decision gets an entry. Never delete — supersede.

Status legend: `Accepted` · `Superseded` · `Proposed`

---

## ADR-0001 — Framework: Next.js (App Router) over bare React
**Status:** Accepted · 2026-07-14
**Context:** Commercial multi-tenant SaaS needing SSR, routing, API layer, SEO for marketing pages, and a single deployable for a small team.
**Decision:** Next.js 15 (App Router) + TypeScript.
**Consequences:** One language end-to-end, server components reduce client JS, API routes co-located. Vendor-neutral; can migrate the API to a standalone service later if needed.

## ADR-0002 — Database & ORM: PostgreSQL + Prisma
**Status:** Accepted · 2026-07-14
**Decision:** Supabase-hosted PostgreSQL, Prisma ORM.
**Consequences:** Type-safe queries, migrations in git. RLS is enforced in Postgres (see ADR-0006), Prisma connects under a request-scoped role.

## ADR-0003 — Auth: Supabase Auth (managed)
**Status:** Accepted · 2026-07-14
**Decision:** Managed auth — email/password + Google OAuth. No custom auth in MVP.
**Consequences:** Sessions, password resets, and social login handled for us. User identity (`auth.uid()`) is the anchor for RLS policies.

## ADR-0004 — Hosting: Managed serverless
**Status:** Accepted · 2026-07-14
**Decision:** Vercel (app) + Supabase (Postgres, Auth, Storage).
**Consequences:** Auto-scaling, low ops. Serverless functions are stateless — the offline sync endpoint must be idempotent (see ADR-0007).

## ADR-0005 — Market & money: India first, integer paise
**Status:** Accepted · 2026-07-14
**Decision:** Primary market India. Currency ₹ (INR) stored as **integer paise**. GSTIN fields, `+91` phone formatting, DD/MM/YYYY dates, IST. Architecture stays locale-ready (currency/locale not hardcoded in domain logic).
**Consequences:** No floating-point money anywhere. A `Money` value type wraps paise. GSTIN validated with the standard 15-char checksum.

## ADR-0006 — Multi-tenancy: shared DB + Row-Level Security
**Status:** Accepted · 2026-07-14
**Decision:** Single shared database. Every domain row carries `company_id`. **PostgreSQL RLS** isolates tenants at the database layer; app code is a second line of defense, not the only one.
**Consequences:** Production-grade isolation from day one. Every table needs an RLS policy before it ships. Clean upgrade path to a dedicated DB per enterprise tenant later.

## ADR-0007 — Offline strategy: field-capture only, extensible
**Status:** Accepted · 2026-07-14
**Context:** Full offline-everything is months of conflict-resolution work for features used mostly at a desk. Genuine field need is on-site data capture with poor signal.
**Decision:** Offline-first for **Labor Attendance, Quick PO creation, Quick Notes, and read-only cached Basic Project Info**. Everything else is online-first with graceful read caching. The sync engine is built as a **generic, reusable layer** so any future module can opt in without refactoring.
**Design:** IndexedDB (Dexie) outbox → client-generated UUID + `client_seq` per mutation → background sync flushes to an idempotent `/api/sync` endpoint → server upserts on UUID → **last-write-wins per field**, with a conflict log surfaced to the user. Attendance keyed by (project, laborer, date) makes conflicts rare.
**Consequences:** Reusable `SyncableEntity` contract. Modules declare offline-capability via a registry; no bespoke sync per feature.

## ADR-0008 — Labor attendance computes wages (no payroll)
**Status:** Accepted · 2026-07-14
**Decision:** Attendance statuses: Present, Absent, Half-day, plus Overtime hours. System auto-computes **daily wages payable**, **project-wise labor cost**, and **contractor-wise labor cost**. No payroll, salary processing, or payment disbursement in MVP.
**Consequences:** Wage math lives in a pure, tested domain function. Amounts are reporting figures, not transactions.

## ADR-0009 — Contractors: light link now, payments later
**Status:** Accepted · 2026-07-14
**Decision:** A laborer optionally belongs to a Contractor. Contractor **payment management is out of MVP scope**, but the schema models Contractor as a first-class entity so payouts can be added without redesign.

## ADR-0010 — Purchase Orders: configurable approval + budget visibility
**Status:** Accepted · 2026-07-14
**Decision:** Both Owner and PM can create POs. Approval is an **optional per-company setting** (on/off). When on: PO flows Draft → Submitted → Approved (Owner approves). Projects always display **Budget Used / Budget Remaining** with a **soft warning** on overrun (never a hard block).
**Consequences:** `Company.settings.poApprovalRequired` flag. Budget is derived (sum of approved/relevant POs + labor cost) — decide inclusion rules in database.md.

## ADR-0011 — Documents: Supabase Storage, tenant-isolated, signed URLs
**Status:** Accepted · 2026-07-14
**Decision:** Drawings, PDFs, photos, contracts, and other files in Supabase Storage. Per-tenant path isolation, RLS on the storage bucket, time-limited signed URLs for access.

## ADR-0012 — UI/UX: premium, minimal, design-system-first
**Status:** Accepted · 2026-07-14
**Decision:** Not a traditional ERP. Inspiration: Linear, Notion, Vercel, Stripe, Arc, Apple HIG. Build the complete **design system (tokens, type, color, icons, components, spacing, motion, empty/loading/error states, dark mode) before any business screen.** Tailwind + shadcn/ui (Radix) as the component foundation.
