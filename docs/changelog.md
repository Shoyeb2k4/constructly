# Changelog

_Human-readable log of what changed and when. Newest first. Keep entries short; link to ADRs for rationale._

## [Unreleased]

### 2026-07-15 — Labour redesigned: category-based attendance (client change request)
Individual labor tracking removed from the MVP; attendance is now a headcount per category.
- **Removed:** Laborer/Attendance models, workers roster, per-worker rows, wages, contractor-per-laborer, payroll surface. Contractor model stays dormant in the schema.
- **New schema:** `LabourCategory` (name, color, optional `dailyRatePaise`) + `LabourAttendance` (project, date, category, `quantityPresent`, notes; unique per (project, date, category); sync-ready `clientUuid`/`clientSeq`). RLS updated.
- **New attendance screen (sub-1-minute):** one stepper row per category (− qty +, direct input, per-row notes), Copy yesterday, project + date selection, live total + estimated cost, **PDF/Excel export** of the daily sheet.
- **Categories management:** add/edit/delete (cascade confirm), color swatches, optional day rate.
- **Summary:** total man-days, estimated cost, working days, man-days by category (colored bars), labour trend (daily), by-project rollup, range + project filters, PDF/Excel export.
- **Labor cost is now an estimate** (user-approved): category day rate × headcount, flowing through the same budget source (ADR-0018) to project Overview, list meters, dashboard cost split, and spend trend.
- **Dashboard:** Today's-labor KPI now sums headcounts; new **Labour widget** (today by category, 30-day man-days, daily trend sparkline).
- Sync engine entity swapped to `labour_attendance` (idempotent upsert on the (project, date, category) key).
- Exports: `xlsx` + `jspdf`/`jspdf-autotable` added (pulled forward from Module 5).
- **Tests:** 68 passing (new calc + demo-repository + dashboard labour widget suites replace the individual-labor tests). Build/typecheck/lint clean; verified in-browser (steppers, copy-yesterday, persistence, summary, dashboard).

### 2026-07-14 — Module 4: Executive Dashboard shipped
The centerpiece — a real, aggregated overview understandable in 10 seconds.
- **Single pure `assembleDashboard()`** consumed by both demo (localStorage) and server (Prisma) gatherers → zero duplicated business logic. One cached fetch, background-refreshed, role-aware (PM scoped to assigned projects).
- **Actionable KPIs (drill-down):** Active projects, Upcoming deadlines, Overdue, Today's labor, Budget used, Pending approvals — each links to its module.
- **Custom SVG/CSS charts** (no chart lib, theme-aware): weekly **Spend trend** (stacked labor+procurement), **Cost split** donut, **Budget utilization** bars. Widget architecture composes independent components — new widgets add without redesign.
- **Budget health** from the shared source (ADR-0018): total/used/remaining/utilization + per-project bars with over-budget flags.
- **Attention center** (the owner's daily action list): pending approvals, overdue projects, budget warnings, upcoming deadlines, stale projects — prioritized, deep-linked.
- **Unified activity feed** merged from projects, attendance, and purchase orders, sorted chronologically, each deep-linking to its record.
- **Onboarding dashboard** for the empty-company state; mobile-first responsive layout.
- Real budget now also flows into the projects list meters. Verified: Skyline 64%, company 8% of ₹9.5Cr, ₹76.8L procurement.
- **Tests:** pure aggregation unit tests (week bucketing, overdue/upcoming/stale/budget detection — 75 total) + Playwright dashboard E2E. Build/typecheck/lint clean; verified in-browser.
- **Fix:** week bucketing now UTC-based (was TZ-shifting dates in IST).

### 2026-07-14 — Module 3: Vendors & Procurement shipped
The financial backbone — vendor CRM, purchase orders, and real budget derivation.
- **PO editor (side-sheet):** inline editable line items, live total, and **live budget impact** banner; auto `PO-####`; keyboard-friendly; mobile responsive.
- **Configurable approval:** OFF → Draft becomes Final on save; ON → Draft → Submitted → Approved. **Approved POs are immutable**; changes go through a **Revise** workflow that clones to a new linked draft (full audit trail via `revisedFromId`).
- **Owner approvals inbox** with pending count; approve to count toward budget.
- **Real budget derivation (ADR-0018):** a shared `budget` feature combines labor (Module 2) + counted procurement into one source used by the project Overview (Total Budget, Labor, Procurement, Used, Remaining, Utilization %, soft over-budget warning), the projects list meters, and — next — the dashboard. Replaces the Module 1 placeholder. Verified: Skyline 64% (₹76.7L procurement + labor).
- **Vendor CRM:** search, status + material filters, favorites, recently-used, lifetime purchases + PO count rollups, and a per-vendor purchase timeline. Model kept lean so payments/ledger/credit/GST reports attach later without redesign.
- **Schema:** Vendor, VendorFavorite, PurchaseOrder (+ `revisedFromId`), POLineItem (+ `sortOrder` for future drag-reorder) + enums + RLS.
- **Tests:** budget + procurement calc unit tests + full procurement demo integration (66 total) + Playwright procurement E2E. Build/typecheck/lint clean; verified in-browser.
- Settings PO-approval toggle now persists (demo) and drives budget counting.

### 2026-07-14 — Module 2: Labor & Attendance shipped
The MVP's core differentiator — offline-first attendance built for sub-2-minute entry.
- **Flagship attendance screen:** pick project (remembers last) + date (defaults today) → **Mark all present** → flag exceptions (P / ½ / A) with large touch targets, OT steppers, **Copy yesterday**, Add-workers picker, desktop keyboard shortcuts (P/H/A + arrows), live sticky totals, and a clear sync chip. Verified: mark-all → 8 present, ₹6,400.
- **Wage math (snapshotted):** `computeWage` is pure + unit-tested; `wageRatePaise`/`wagePayablePaise` are frozen onto each attendance row so later wage changes never rewrite history.
- **Roster:** virtualized workers table (300+ ready), search + trade/contractor/status filters, bulk deactivate, intelligent duplicate warnings on add.
- **Contractors:** first-class model (extensible for future payments/invoices/advances/ledger) with per-contractor worker count and labor-cost rollup.
- **Rollups / reporting foundation:** labor cost by project and by contractor (incl. a Direct-labor bucket) over a date range.
- **Offline:** attendance registered with the reusable sync engine (ADR-0007); demo path is local-first (data never lost); `/api/sync` gained the idempotent attendance upsert handler.
- **Schema:** Contractor, Laborer, Attendance + enums + RLS (attendance PM-scoped via project access).
- **Tests:** wage unit tests + full demo-repository integration (48 total) + Playwright attendance E2E. Build/typecheck/lint clean; verified in-browser.
- **Fix:** demo `read()` now clones seed constants (they were handed out by reference — a latent bug that could corrupt the first in-app demo session).

### 2026-07-14 — Module 1: Project Management shipped
Full projects feature, built to the Module 0 bar.
- **Views:** virtualized table + **Kanban board** with dnd-kit drag between lifecycle stages (optimistic); rich **detail** with Overview, Deadlines, Documents, Notes, Activity tabs.
- **Create:** side-sheet (React Hook Form + Zod, auto-generated `PRJ-####` code with override, tags, PM assignment).
- **Actions:** duplicate, archive/restore, favorite/pin, delete (confirm), assign manager, stage stepper.
- **Extras:** recently-viewed strip, global search + stage/type/PM filters, ⌘K jump-to-project, drag-and-drop document uploads, keyboard shortcuts (`c`, `/`), optimistic UI everywhere safe.
- **Architecture:** `ProjectsRepository` interface with a demo (localStorage) implementation and a Prisma-backed server-action implementation; three-layer authorization (UI + server guards + Postgres RLS).
- **Schema:** Project, Deadline, ProjectDocument, Note, ProjectFavorite, ActivityLog + enums (ProjectType/Stage/DocumentCategory) + tags; RLS policies for all, PM-scoped project access.
- **Tests:** 27 unit/integration (schema, format, full demo-repository) + Playwright projects E2E. Build/typecheck/lint clean; verified in-browser (list, board, detail) with no console errors.

### 2026-07-14 — Module 0: Foundation shipped
Production-grade scaffold, reusable design system, and app shell — no business features.
- **Stack:** Next.js 16 (App Router) + TS, Tailwind v4 (CSS-first tokens), Prisma 6, Supabase (auth/db/storage), TanStack Query, Zod.
- **Design system ("Blueprint"):** light/dark tokens, Inter + JetBrains Mono, 15 UI primitives (button, card, badge, input, dialog, dropdown, tabs, tooltip, switch, command, toaster, …) + app patterns (StatCard, StatusBadge, EmptyState, ErrorState, skeletons, MoneyText, OfflineIndicator). Live gallery at `/style`.
- **App shell:** responsive sidebar + topbar, ⌘K command palette, theme toggle, user menu; routes for all 7 modules as polished empty states; executive dashboard with demo data.
- **Auth/tenancy:** Prisma schema (Company, User, roles) + RLS scaffold (`prisma/rls.sql`); Supabase browser/server clients; demo mode for credential-free preview.
- **Offline engine:** Dexie outbox + `SyncableEntity` registry + idempotent `/api/sync` contract + `useSync()`.
- **Money:** integer-paise utilities with INR/lakh-crore formatting (unit-tested).
- **Tooling:** Vitest (5 tests passing), Playwright E2E harness (3 smoke tests), strict TS, ESLint clean. `npm run build` green; verified in light + dark in-browser.

### 2026-07-14 — Project kickoff & foundation planning
- Established product scope, target market (India-first), and MVP module set.
- Locked foundational decisions: Next.js + Supabase + Vercel, RLS multi-tenancy,
  managed auth, integer-paise money, offline-first for field-capture only.
- Authored initial documentation set: architecture, database, api, design-system, roadmap,
  decisions (ADR-0001…0012), changelog.
- Defined "Blueprint" design system direction (tokens, type, color, motion, states, dark mode).
- Module 0 (Foundation) spec presented — awaiting approval to scaffold.
