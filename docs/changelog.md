# Changelog

_Human-readable log of what changed and when. Newest first. Keep entries short; link to ADRs for rationale._

## [Unreleased]

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
