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

## Later modules
Endpoints for projects, laborers/attendance, vendors/POs, dashboard aggregates, and report exports
are documented here as each module is built.
