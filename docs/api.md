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

## Module 2 — Labour & Attendance (category-based · ADR-0021)
`src/features/labor/server/actions.ts` behind `LaborRepository` (demo mirror). Attendance is a
registered sync entity (`labour_attendance`); `/api/sync` upserts idempotently on the
`(project, date, category)` key (quantity 0 deletes).

| Action | Who | Notes |
|---|---|---|
| `listCategories` / `createCategory` / `updateCategory` / `deleteCategory` | all | color + optional day rate; delete cascades attendance |
| `getSheet(projectId, date)` | Owner, PM(assigned) | one row per category with headcount + notes |
| `setQuantity(projectId, date, categoryId, quantity, notes?)` | Owner, PM(assigned) | upsert; 0 deletes |
| `copyPreviousDay(projectId, date)` | Owner, PM(assigned) | fast-entry helper |
| `listAttendance(filters)` | all (PM scoped) | project / date / range filters — feeds exports |
| `summary(filters)` | all (PM scoped) | man-days by category/project, daily trend, cost estimate |

PDF/Excel export is client-side (`src/features/labor/exports.ts`, jsPDF + SheetJS).

## Module 3 — Vendors & Procurement (server actions)
`src/features/procurement/server/actions.ts` behind `ProcurementRepository` (demo mirror).
Vendors: `listVendors` / `getVendor` (+ history) / `createVendor` (Owner) / `updateVendor` (Owner) /
`setVendorStatus` (Owner) / `toggleVendorFavorite` / `listMaterials`.
POs: `listPurchaseOrders` / `getPurchaseOrder` / `createPurchaseOrder` / `updatePurchaseOrder`
(DRAFT only) / `submitPurchaseOrder` / `approvePurchaseOrder` (Owner) / `revisePurchaseOrder` /
`deletePurchaseOrder` (Owner) / `pendingApprovalCount`. PO writes invalidate budget + projects.

## Module 3 — Budget (shared source · ADR-0018)
`src/features/budget`: `deriveBudget()` (pure) + `projectSpend` / `spendByProject` (demo + server).
Consumed by the project Overview budget card and projects list; the dashboard uses the same source.

## Module 4 — Dashboard (aggregation)
`src/features/dashboard`: `getDashboard({ userId, isOwner })` = `assembleDashboard(raw)` where `raw`
comes from `gatherDemoDashboard` (localStorage) or `gatherServerDashboard` (Prisma, one batched
`Promise.all`). Pure `assembleDashboard` is the single business-logic source (ADR-0020). Role-aware;
cached via TanStack Query with background refetch.

## Later modules
Report export endpoints (PDF/Excel) are documented here as Module 5 is built.
