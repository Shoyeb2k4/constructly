# API

_Contract for server routes & actions. Update as endpoints land. Conventions first, then per-module._

## Conventions
- **Auth:** every route requires a valid Supabase session unless marked public. Tenant derived
  server-side from the session — **never** trust a `company_id` from the client.
- **Validation:** request bodies parsed with the module's Zod schema; 422 on failure with field errors.
- **Errors:** JSON `{ error: { code, message, fields? } }`. Codes are stable strings.
- **Money:** integer paise in/out. Formatting is a client concern.
- **Mutations of record** (financial/status) write an `ActivityLog` entry.
- **Idempotency:** offline-syncable writes accept `client_uuid`; server upserts (safe re-send).
- Prefer **server actions** for form mutations; **route handlers** (`/api/*`) for sync, webhooks, exports.

## Module 0 endpoints
| Method | Path | Purpose |
|---|---|---|
| — | `auth/*` (Supabase) | sign-up, sign-in, OAuth, reset |
| POST | server action `onboardCompany` | create Company + set caller as OWNER |
| GET | `me` (server) | session user + company + role |
| POST | `/api/sync` | **skeleton** — idempotent batch upsert of syncable entities (no domain tables yet) |

### `/api/sync` (contract, stable across modules)
Request:
```json
{ "mutations": [
  { "clientUuid": "…", "clientSeq": 12, "entity": "attendance",
    "op": "upsert", "payload": { … } }
] }
```
Response:
```json
{ "applied": ["…uuid"], "conflicts": [ { "clientUuid": "…", "serverValue": { … } } ] }
```
Conflict resolution: last-write-wins per field; conflicts returned for UI surfacing.

## Module 1 — Projects (server actions)
Defined in `src/features/projects/server/actions.ts`. All derive the tenant from the
session and enforce role + assignment on top of RLS. Demo mode uses an equivalent
client repository (`demo/demo-repository.ts`) behind the same `ProjectsRepository` interface.

| Action | Who | Notes |
|---|---|---|
| `listProjects(filters)` | all (PM: assigned) | search + stage/type/pm/tag/favorites/archived filters |
| `getProject(id)` | all (PM: assigned) | detail incl. deadlines, documents, notes, activity |
| `createProject(input)` | Owner | auto `PRJ-####`; logs activity |
| `updateProject(id, patch)` | Owner, PM(assigned) | |
| `changeStage(id, stage)` | Owner, PM(assigned) | optimistic on client |
| `assignManager(id, pmId)` | Owner | |
| `duplicateProject(id)` / `setArchived(id, bool)` / `removeProject(id)` | Owner | delete is soft |
| `toggleFavorite(id)` | all | per-user |
| `addDeadline` / `toggleDeadline` / `removeDeadline` | Owner, PM(assigned) | |
| `addNote` | Owner, PM(assigned) | offline-capable entity |
| `addDocument` / `removeDocument` | Owner, PM(assigned) | Supabase Storage path recorded |
| `listManagers()` | all | active PMs for assignment |

Money crosses this boundary as integer **paise** (`number`); Prisma stores BigInt and
converts in the mapper.

## Module 2 — Labour & Attendance (Category → Subcategory · ADR-0023)
`src/features/labor/server/actions.ts` behind `LaborRepository` (demo mirror). Attendance is a
registered sync entity (`labour_attendance`); `/api/sync` upserts idempotently on the
`(project, date, subcategory)` key (quantity 0 deletes) with ADR-0022 rate snapshots.

| Action | Who | Notes |
|---|---|---|
| `listCategories()` | all | nested `CategoryWithSubs[]`, ordered by `displayOrder` |
| `createCategory` / `updateCategory` / `deleteCategory` / `reorderCategories(ids)` | all | delete cascades subs + attendance |
| `createSubcategory` / `updateSubcategory` / `deleteSubcategory` / `reorderSubcategories(catId, ids)` | all | patch `categoryId` moves it; optional day rate |
| `getSheet(projectId, date)` | Owner, PM(assigned) | groups per category, one row per subcategory |
| `setQuantity(projectId, date, subcategoryId, quantity, notes?)` | Owner, PM(assigned) | upsert; 0 deletes; snapshots rate on first record |
| `copyPreviousDay(projectId, date)` | Owner, PM(assigned) | re-snapshots at today's rates |
| `listAttendance(filters)` | all (PM scoped) | flat records incl. category + subcategory — feeds exports |
| `summary(filters)` | all (PM scoped) | man-days by category → subcategory, by project, daily trend, cost |

PDF/Excel export is client-side (`src/features/labor/exports.ts`, jsPDF + SheetJS), grouped with
category totals and a grand total.

## Module 3 — Vendors & Procurement v2 (server actions · ADR-0024)
`src/features/procurement/server/actions.ts` behind `ProcurementRepository` (demo mirror). All money
is integer paise; GST rates are integer basis points. Online-only. Pure `calc.ts` (GST per-line
rounding, outstanding, payment status, aging, rollups, project summary) is the single math source for
demo, server, dashboard, and UI.

| Action | Who | Notes |
|---|---|---|
| `listVendors` / `getVendor` | all | vendor incl. `pan`, derived `outstandingPaise`, `projectsServed`; detail adds payments, project rollups, documents |
| `createVendor` / `updateVendor` / `setVendorStatus` | Owner | |
| `toggleVendorFavorite` / `listMaterials` | all | |
| `listMaterialCategories` / `setMaterialCategories` | all | company-wide presets in `Company.settings` |
| `addVendorDocument` / `removeVendorDocument` | all | Supabase Storage path recorded |
| `listPurchaseOrders(filters)` | all (PM scoped) | filters: status, project, vendor, material, category, date range, payment status |
| `getPurchaseOrder` | all | detail incl. GST split + linked payments + payment status |
| `createPurchaseOrder` / `updatePurchaseOrder` (DRAFT only) | PM(assigned)+ | GST-aware; totals from `poTotals` |
| `submitPurchaseOrder` / `approvePurchaseOrder` (Owner) | | approved POs immutable |
| `revisePurchaseOrder` | PM(assigned)+ | clones to a **linked** draft (audit) |
| `duplicatePurchaseOrder` | PM(assigned)+ | clones to an **unlinked** draft dated today |
| `deletePurchaseOrder` / `pendingApprovalCount` | Owner / all | |
| `listPayments` / `createPayment` | PM(assigned)+ | payment project-aware; PO link optional; create logs activity |
| `deletePayment` | **Owner only** | financial record — audited via `ActivityLog` |
| `getProjectProcurement(projectId)` | PM(assigned)+ | summary (6 cards) + vendors-involved + scoped POs/payments |
| `vendorAging(vendorId, projectId?)` | all | 0–30 / 31–60 / 60+ buckets, advances FIFO |

PO + payment writes invalidate budget + projects + dashboard. `GoodsReceipt` methods are interface stubs
(UI deferred). Demo stores are v2 keys with automatic v1 → v2 migration.

## Module 3 — Budget (shared source · ADR-0018)
`src/features/budget`: `deriveBudget()` (pure) + `projectSpend` / `spendByProject` (demo + server).
Consumed by the project Overview budget card and projects list; the dashboard uses the same source.

## Module 4 — Dashboard (aggregation)
`src/features/dashboard`: `getDashboard({ userId, isOwner })` = `assembleDashboard(raw)` where `raw`
comes from `gatherDemoDashboard` (localStorage) or `gatherServerDashboard` (Prisma, one batched
`Promise.all`). Pure `assembleDashboard` is the single business-logic source (ADR-0020). Role-aware;
cached via TanStack Query with background refetch. The snapshot now includes a **procurement widget**
(spend, outstanding total + top/outstanding vendors, recent POs, 6-month trend — ADR-0024) and the
project detail exposes **Procurement** and **Labour** tabs.

## Module 5 — Reports & Analytics (ADR-0026)
`src/features/reports`. A report is a `ReportDef` in `registry.ts` whose `run(filters)` returns a
generic `ReportResult` (columns + typed rows + KPIs) by calling the **same shared repositories /
aggregation** every other module uses — so reports match the Dashboard, Project Overview,
Procurement, and Labour views exactly (single source of truth, no re-derivation).

| Report | Source it reuses | Filters |
|---|---|---|
| Budget vs Actual (flagship) | `projectsApi.list` (`usedPaise` = shared budget source) + `laborApi.summary` split | project |
| Project summary | `projectsApi.list` | project |
| Labour cost | `laborApi.summary` (Category → Subcategory) | project, date range |
| Procurement | `procurementApi.listPurchaseOrders` (GST split, payment status) | project, vendor, date range |
| Vendor report | `procurementApi.listVendors` (derived outstanding) | vendor |
| Deadline report | `projectsApi.get` deadlines | project |

Filters are URL-synced on `/reports/[id]`. Export is client-side over `ReportResult` — generic
`reportToPdf` (jsPDF + autotable) / `reportToExcel` (SheetJS), grouped rows + totals, "Rs." in PDFs.
Role scoping comes for free: the underlying repos already scope PM access. No new server endpoints.
