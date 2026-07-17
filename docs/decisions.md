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

## ADR-0013 — Prisma pinned to v6 (not v7)
**Status:** Accepted · 2026-07-14
**Context:** Prisma 7 removes `url`/`directUrl` from the schema datasource and requires a `prisma.config.ts` + driver-adapter runtime — a brand-new connection paradigm released recently.
**Decision:** Pin to Prisma **6.x** (engine-based, url-in-schema) for the foundation. Stable and battle-tested for a commercial product.
**Consequences:** Generator is `prisma-client-js` with output to `src/generated/prisma` (gitignored, regenerated via `npm run db:generate`). Revisit a Prisma 7 migration once its config model settles.

## ADR-0014 — Demo mode for credential-free preview
**Status:** Accepted · 2026-07-14
**Context:** The UI must be reviewable and E2E-testable without a live Supabase backend.
**Decision:** A `CONSTRUCTLY_DEMO` flag (auto-on when Supabase env is absent) serves a seeded demo identity ("Meridian Build Co.", owner Aarav Mehta) with no real auth. All env branching lives in `src/lib/env.ts`; `getCurrentUser()` returns the demo user in this mode. Playwright runs against demo mode.
**Consequences:** `npm run dev` renders the full app immediately. Real auth activates automatically once Supabase env vars are set.

## ADR-0025 — Procurement forward-compatibility (GST split, vendor ledger)
**Status:** Accepted · 2026-07-17 (client refinements after ADR-0024; readiness only, not implemented)
**Context:** The client approved Procurement v2 and asked that the architecture be ready for richer tax and a full vendor ledger **without a future schema redesign** — but explicitly *not* to build them yet.
**Decision (readiness commitments, no behaviour change now):**
- **GST split / HSN / tax mode:** `POLineItem.gstRateBps` stays the single per-line rate and `gstPaise` the per-line rounded source of truth. CGST/SGST/IGST are a *presentation* split derived from that one rate (intra-state → CGST+SGST halves, inter-state → IGST) — no stored duplication. `hsnCode` (line) and a PO-level `taxInclusive` boolean attach as new nullable columns when needed; existing rows default correctly (exclusive, null HSN). No redesign.
- **Vendor ledger:** a complete running ledger (purchases as debits, payments as credits, running balance, monthly summary, credit/debit balances) derives entirely from existing `PurchaseOrder` + `VendorPayment` rows. Proven now by the pure `vendorLedger()` in `src/features/procurement/calc.ts` (unit-tested: running balance + monthly rollup + project scoping) — the Vendor Profile can grow an eventual Ledger tab with zero schema change.
- **Project Overview** now shows the dedicated Procurement budget (budget / used / remaining) distinctly from the overall project budget (used / remaining); the dashboard procurement card became a command center (spend, GST paid, outstanding + pending count, top vendors, spend by project, top materials, upcoming deliveries, monthly trend) — all from the same shared assembler.
**Consequences:** Tax/ledger features ship later as additive columns + UI over the existing pure calc; no migration risk introduced now.

## ADR-0024 — Procurement & Vendor Management v2 (extends ADR-0018/0019)
**Status:** Accepted · 2026-07-17 (roadmap re-prioritized ahead of Reports)
**Context:** Procurement is the purchasing backbone: many-to-many `Vendor ↔ Project` through purchase orders, plus GST, vendor payments with outstanding tracking, project-wise purchasing, and richer dashboards. Module 3 shipped the PO core; this extends it without a rewrite (all Module-3 data survives).
**Decision:**
- **Schema (additive):** `Project.procurementBudgetPaise?` (dedicated, independent of `budgetPaise`); `Vendor.pan?`; `VendorDocument`; PO gains `expectedDelivery?`, `subtotalPaise`, `gstPaise` (grand `totalPaise` = subtotal + GST — budget math unchanged); `POLineItem` gains `category?`, `gstRateBps` (basis points — integer tax math, no float), `gstPaise` (rounded **per line** so totals equal the sum of visible lines); new `VendorPayment` (project-aware, PO link **optional** for advances / on-account / multi-PO settlements, `PaymentMode` enum); `GoodsReceipt`/`GoodsReceiptItem` (schema + RLS + repository stubs only — UI deferred).
- **Outstanding is DERIVED, never stored** (mirrors budget ADR-0018): `Σ counted PO grand totals − Σ payments`, scoped by vendor and/or project. PO payment status (UNPAID/PARTIAL/PAID) and aging buckets (0–30 / 31–60 / 60+, advances applied FIFO to oldest POs) all come from one pure `calc.ts` consumed by demo, server, dashboard, and UI — no duplicated math.
- **Material categories** are company-wide presets in `Company.settings.materialCategories` (seeded: Cement, Steel, Sand & Aggregate, Electrical, Plumbing, Paint, Hardware, Other), Settings-managed, powering PO line categories + filters + analytics.
- **Duplicate PO** clones any PO to a fresh unlinked draft dated today (distinct from Revise, which links to the source for audit).
- **Online-only** (financial integrity): procurement, POs, vendors, payments, goods receipts. Labour attendance remains the sole offline-first module.
- **Navigation both ways:** project → Procurement tab (6 summary cards, vendors-involved table with per-vendor drill-in, scoped POs/payments) and Labour tab; vendor profile (4 stat cards + Overview/Projects/POs/Payments/Documents/Outstanding tabs, project-filter pill); PO detail ↔ project ↔ vendor; company dashboard procurement card (spend, outstanding + top vendors, recent POs, monthly trend).
- **Payment deletion is owner-only** and writes an `ActivityLog` entry (PMs can record, not remove).
**Migration:** `prisma/migration-procurement-v2.sql` backfills `subtotal = old total, gst = 0` and seeds category presets. Demo stores bump to v2 keys (`vendors.v2`, `pos.v2`, `vendorPayments.v1`) with automatic v1 → v2 migration on load (verified live: pre-GST PO migrated with subtotal = total, gst = 0, category null, legacy keys removed).
**Consequences:** GST-accurate financials; project-wise purchasing; real outstanding/aging without stored drift; goods-receipt-ready. Reports & Analytics (Module 5) resumes after this.

## ADR-0023 — Labour hierarchy: Category → Subcategory (extends ADR-0021)
**Status:** Accepted · 2026-07-16 (client change request)
**Context:** Sites organize labour as trade groups with roles inside them (Carpenter → Main Carpenter / Carpenter Helper). Still strictly headcounts — no individuals, IDs, check-in/out, or payroll.
**Decision:** `LabourCategory` (name, optional color, `displayOrder`) contains unlimited `LabourSubcategory` rows (name, **optional `dailyRatePaise`** — the rate moved down to the subcategory, `displayOrder`). `LabourAttendance` now references `labourSubcategoryId` (unique per project + date + subcategory) and keeps the ADR-0022 snapshots (`dailyRatePaiseSnapshot`, `estimatedCostPaise` = qty × snapshot — history never rewrites). Attendance UI groups collapsible categories with a stepper per subcategory; hierarchy management supports create/edit/delete/move plus **drag-and-drop reordering** persisted via `displayOrder`. Reports, exports, and the dashboard aggregate per category **with subcategory breakdown** (category totals + grand total). Sync entity payload carries `labourSubcategoryId`.
**Migration:** every existing flat category becomes Category → Default Subcategory (same name + rate) and attendance is repointed — `prisma/migration-labour-hierarchy.sql` for Postgres; the demo store migrates v1 → v2 automatically on load (verified live: 9 categories, 105 records, zero loss).
**Consequences:** Unlimited categories/subcategories; entry stays sub-1-minute; all rollups gain a second level; budget math unchanged (sums stored snapshot costs).

## ADR-0021 — Labour redesigned to category-based attendance (supersedes ADR-0017)
**Status:** Accepted · 2026-07-15 (client change request)
**Context:** Client feedback: the MVP must not track individual laborers, wages, per-worker attendance, or payroll. Attendance is a **headcount per labour category per project per date**.
**Decision:** Removed `Laborer` + individual `Attendance` (and their UI). New models: `LabourCategory` (name, color, **optional `dailyRatePaise`**) and `LabourAttendance` (projectId, date, labourCategoryId, quantityPresent, notes; unique per (project, date, category); `clientUuid`/`clientSeq` kept for the sync engine). Labor **cost is now an estimate** = category day rate × headcount (user-approved); categories without a rate contribute ₹0. Budget (ADR-0018), dashboard cost split, and Overview all consume the estimate from the same source. Features: add/edit/delete via quantity steppers (0 deletes), copy previous day, project/date/range filters, PDF + Excel export (jsPDF + SheetJS, pulled forward from Module 5), man-days/trend summaries, dashboard labour widgets. `Contractor` stays in the schema (dormant for future payments) but leaves the Labor UI.
**Consequences:** Sub-1-minute entry (a handful of steppers). No payroll surface. Repository pattern, offline sync entity (`labour_attendance`), permissions, and design system all reused. ADR-0017's wage snapshot is superseded — historical correctness now derives from headcounts × current category rate (estimates, not payables).

## ADR-0020 — Dashboard: one pure assembler, two gatherers
**Status:** Accepted · 2026-07-14
**Context:** The dashboard must show real data from every module with no duplicated business logic, and work in demo + production.
**Decision:** `src/features/dashboard/assemble.ts` holds a single **pure** `assembleDashboard(raw)` (KPIs, week bucketing, overdue/upcoming/stale detection, budget health, cost split, activity merge). Demo and server each **gather** `RawDashboardData` their own way (localStorage vs Prisma), then call the same assembler. Charts are custom SVG/CSS (no chart lib) for a premium, theme-aware look and small bundle. Widgets are independent components composed by `DashboardView` — new widgets (cash flow, equipment, weather, AI insights) add without redesign. Role-aware: PM scoped to assigned projects.
**Consequences:** Business logic lives once (tested in isolation). Date math is UTC-based to stay TZ-stable. The gather/assemble split seeds Module 5 report exports.

## ADR-0018 — One budget source across the app
**Status:** Accepted · 2026-07-14
**Context:** The project Overview, list meters, and dashboard must never disagree on budget numbers.
**Decision:** A neutral `src/features/budget` feature is the single source: `deriveBudget(budgetPaise, { laborPaise, procurementPaise })` (pure, tested) plus demo (localStorage) and server (Prisma) spend readers. Labor = Σ attendance wages (Module 2); procurement = Σ POs counted per the company's approval setting (`poCountsForBudget`). Projects derive `usedPaise` from it; the Overview budget card and dashboard consume it. Replaces the Module 1 placeholder (`usedPaise = 0`).
**Consequences:** Consistent numbers everywhere. Adding a spend source later means extending one function.

## ADR-0019 — Approved purchase orders are immutable (Revise workflow)
**Status:** Accepted · 2026-07-14
**Decision:** Approval OFF → Draft is final on save. Approval ON → Draft → Submitted → Approved. An APPROVED PO cannot be edited; **Revise** clones it to a new DRAFT linked by `revisedFromId`, preserving an audit trail. Never silently mutate an approved financial document. Line items carry `sortOrder` for future drag-to-reorder.
**Consequences:** Financial documents are auditable. Budget counts only APPROVED POs when approval is on (else all non-draft).

## ADR-0017 — Attendance: wage snapshot + local-first offline
**Status:** Accepted · 2026-07-14
**Decision:** Each attendance row stores a **snapshot** of the wage rate and computed payable (`wageRatePaise`, `wagePayablePaise`). Editing a laborer's daily wage later never recomputes historical attendance. Attendance is registered with the reusable sync engine (ADR-0007); the demo path writes local-first (data survives offline), and `/api/sync` applies attendance idempotently with last-write-wins on the `(project, laborer, date)` key.
**Consequences:** Correct historical labor cost. `computeWage` is the single pure source of pay math (unit-tested). Full production offline (client outbox for attendance) builds on this foundation.
**Also:** the "Mark all present → flag exceptions" default is the primary lever for sub-2-minute entry.

## ADR-0016 — Projects: repository interface with demo + server implementations
**Status:** Accepted · 2026-07-14
**Context:** The UI must be fully interactive in demo mode (no DB) yet production-ready with Prisma + RLS.
**Decision:** The projects UI depends only on a `ProjectsRepository` interface (`src/features/projects/repository.ts`). Demo mode binds it to a client-side, localStorage-backed implementation; otherwise it binds to Prisma-backed server actions (`server/actions.ts`) enforcing role + assignment on top of RLS. Selection happens in `data.ts`; nothing above it changes. Reads/writes go through TanStack Query with optimistic updates for stage changes and favorites.
**Consequences:** `npm run dev` and Playwright run with no backend. Server path enforces three-layer auth. `usedPaise` is 0 in the server path until Modules 2–3 derive spend; the demo seeds realistic values.

## ADR-0015 — Offline sync via a generic reusable engine (implemented)
**Status:** Accepted · 2026-07-14
**Decision:** Implemented the ADR-0007 engine as `src/lib/sync/*`: a Dexie outbox, a `SyncableEntity` registry, an idempotent `enqueue`/`flush` engine, and the `POST /api/sync` contract endpoint. Modules 2–3 register entities; no per-feature sync code.
**Consequences:** The `/api/sync` server handler map is empty until domain tables exist. `useSync()` powers the topbar offline indicator.
