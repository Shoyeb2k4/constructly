# Roadmap

_Delivery plan. Each module follows the workflow in "Process" below (ADR-0012 / user process #10)._

## Process (do not skip)
For every module: (1) explain architecture → (2) explain DB changes → (3) explain UI/UX →
(4) explain edge cases → (5) recommend improvements → (6) **wait for approval** → (7) implement →
review & optimize → update docs.

## Modules

### Module 0 — Foundation  ◀ current
Scalable architecture, production-grade scaffold, reusable design system. **No business features.**
- Next.js + TS + Tailwind + shadcn setup, feature-first structure
- Prisma schema (Company/User/settings) + first migration + **RLS scaffold**
- Supabase Auth (email/password + Google), sign-up → **company onboarding**, session guards, roles
- App shell (sidebar + topbar), routing skeleton for all modules (empty states)
- Design tokens (light/dark) + `/style` component gallery
- Reusable offline **SyncEngine** contract + `/api/sync` skeleton (no domain data yet)
- `Money` paise utility, Zod validation base, ActivityLog plumbing
**Exit:** an installable PWA where a user can sign up, create a company, sign in, and navigate a
themed, empty, tenant-isolated app — with the design system on display at `/style`.

### Module 1 — Project Management
Projects CRUD, lifecycle stages, PM assignment, documents (Supabase Storage), deadlines + countdown, notes (syncable), budget display scaffold.

### Module 2 — Labor & Attendance
Contractors, laborers, **offline-first attendance capture** (present/absent/half-day/OT), wage computation, project- & contractor-wise labor cost.

### Module 3 — Vendors & Procurement
Vendor CRM, POs + line items, **configurable approval flow**, budget used/remaining + soft overrun warning, quick-PO offline.

### Module 4 — Executive Dashboard
Real-data overview: active projects, deadlines, overdue, today's labor, purchases, procurement/budget summary, recent activity, quick actions.

### Module 5 — Reports & Analytics
Project / labor / procurement / vendor / financial / budget-vs-actual / deadline reports. PDF + Excel export.

### Module 6 — Hardening & Production Readiness
Performance, a11y audit, full empty/loading/error pass, seed/demo data, security review, observability, deploy runbook.

## Status
| Module | Status |
|---|---|
| 0 Foundation | ✅ Shipped 2026-07-14 — tagged v0.1.0-foundation |
| 1 Project Management | ✅ Shipped 2026-07-14 — list, board, detail, CRUD, 27 tests, verified |
| 2 Labor & Attendance | Next — spec pending approval |
| 3–6 | Planned |
