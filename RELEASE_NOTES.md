# Constructly v1.0.0 — Release Notes

**The modern construction ERP.** A production-ready, multi-tenant commercial SaaS for small construction companies — India-first (₹, GST, offline-capable site workflows). Built with a premium, Linear/Stripe-grade interface, not a traditional ERP.

_Release date: 2026-07-18_

## Highlights

Constructly manages the full operating loop of a construction business from one beautiful place:

- **Executive Dashboard** — understandable in ten seconds: KPIs, spend trend, cost split, a procurement command center, an attention list, and a unified activity feed.
- **Projects** — table + Kanban, lifecycle stages, deadlines, documents, notes, and a budget that separates the overall project budget from a dedicated procurement budget.
- **Labour & Attendance** — offline-first, sub-one-minute site entry as a Category → Subcategory headcount (no individual tracking), with rate snapshots so history never rewrites.
- **Vendors & Procurement** — many-to-many Vendor ↔ Project through purchase orders, GST-accurate line items, vendor payments with derived outstanding + aging, immutable approved POs, and a project-level purchasing center.
- **Reports & Analytics** — Budget-vs-Actual, Project, Labour, Procurement, Vendor, and Deadline reports that provably match every other view (shared aggregation), exportable to PDF/Excel.

## What's in 1.0

Delivered across six modules (see `docs/changelog.md` for the full log):

| Module | Tag |
|---|---|
| 0 — Foundation (design system, app shell, auth, offline engine) | `v0.1.0-foundation` |
| 1 — Project Management | `v0.2.0-projects` |
| 2 — Labour & Attendance (→ Category→Subcategory hierarchy) | `v0.3.0-labor` → `v0.5.2-labour-hierarchy` |
| 3 — Vendors & Procurement (→ v2: GST, payments, outstanding) | `v0.4.0-procurement` → `v0.6.0-procurement-v2` |
| 4 — Executive Dashboard | `v0.5.0-dashboard` |
| 5 — Reports & Analytics | `v0.6.0-reports` |
| 6 — Hardening & Production Readiness | **`v1.0.0`** |

## Production hardening (this release)

- **Security** — strict CSP + security headers, per-user rate limiting on `/api/sync`, three-layer authorization (UI + server guards + Postgres RLS), Zod validation at every boundary, immutable audit log, dependency scanning. See `docs/security.md`.
- **Observability** — structured logging with a single Sentry-ready `reportError()` seam, route + global error boundaries, client error reporter, and a `/api/health` probe (+ deep DB check).
- **Accessibility** — WCAG 2.2 AA target: skip-to-content, focus management, reduced-motion, descriptive labels on custom charts, and an axe-core CI gate.
- **Performance** — route-based code splitting, lazy-loaded PDF/Excel exporters, virtualized long lists, tuned query cache with reconnect refetch.
- **Reliability** — idempotent, ordered, retry-safe offline sync; optimistic updates with rollback; auto-reconnect. Never loses user-entered data.
- **CI/CD** — GitHub Actions: typecheck · lint (0 warnings) · tests · production build · Playwright + axe · dependency audit.

## Engineering principles

- **Money is integer paise** end-to-end; GST rates are integer basis points — no floating-point arithmetic anywhere.
- **One source of truth** — all money/budget/GST/outstanding math is pure and shared, so the dashboard, project views, procurement, labour, and every report always agree.
- **Derive, don't store** — budget, outstanding, and aging are computed from transactions, eliminating drift.
- **Immutable financial history** — approved POs are locked; rate edits never rewrite past records.

## Quality at release

- 119 unit/integration/permission/sync tests green.
- TypeScript strict: 0 errors. ESLint: 0 warnings. Production build: green.
- Browser-verified: live migrations, exact financial math, dark mode, accessibility, health endpoint.

## Known items

- **`xlsx` (SheetJS) high advisory** — in the file-parsing path only; Constructly exports (writes) and never parses untrusted files, so it is unreachable. Tracked for the SheetJS CDN migration (`docs/security.md`).
- **Goods Receipts** — schema, RLS, and repository stubs ship; the receiving UI is deferred (ADR-0024).
- **GST CGST/SGST/IGST split, HSN codes, tax-inclusive pricing** — architecture is ready (ADR-0025); not yet implemented.

## Upgrade / install

New install and deployment steps: `INSTALL.md` and `docs/deployment.md`. Existing databases: run `prisma/migration-procurement-v2.sql` and (if pre-hierarchy) `prisma/migration-labour-hierarchy.sql`.
