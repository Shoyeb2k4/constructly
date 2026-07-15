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

## Module 2 — Labor & Attendance (server actions)
Defined in `src/features/labor/server/actions.ts` behind the `LaborRepository` interface
(demo impl mirrors it client-side). Attendance is also a registered sync entity; `/api/sync`
applies `attendance` mutations idempotently.

| Action | Who | Notes |
|---|---|---|
| `listLaborers(filters)` / `createLaborer` / `updateLaborer` | all / all / all | search + trade/contractor/status filters |
| `setLaborerStatus` / `bulkSetLaborerStatus` | all | bulk (de)activate |
| `findDuplicateLaborers(name, phone)` | all | powers add-form warnings |
| `listContractors` / `createContractor` / `setContractorStatus` | all | contractor rollups included |
| `getSheet(projectId, date)` | Owner, PM(assigned) | crew + per-cell status |
| `setAttendance(projectId, laborerId, date, status, otHours)` | Owner, PM(assigned) | wage snapshot; null status = unmark |
| `markAllPresent` / `copyYesterday` / `addToCrew` | Owner, PM(assigned) | fast-entry helpers |
| `crossProjectPresence` | all | soft double-booking warning |
| `laborCostByProject(range)` / `laborCostByContractor(range)` | all | reporting foundation |

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

## Later modules
Endpoints for dashboard aggregates and report exports are documented here as each module is built.
