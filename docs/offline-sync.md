# Offline Sync

_The offline-first engine (ADR-0007). Only field-capture flows are offline; financial modules are online-only by design (ADR-0024)._

## Scope

**Offline-first:** Labour Attendance is the sole fully offline entity — site work happens where connectivity is poor, and attendance must never be lost.

**Online-only** (financial integrity): Procurement, Purchase Orders, Vendors, Payments, Goods Receipts. These require a live server round-trip so authorization, GST, and outstanding math are always authoritative.

## Architecture

```
UI mutation → enqueue(entity, op, payload)
                ↓  (validate against registered Zod schema)
            IndexedDB outbox  (Dexie — src/lib/sync/db.ts)
                ↓  flush() on online / reconnect / interval
            POST /api/sync   { mutations: [...] }   (ordered by clientSeq)
                ↓  per-entity handler, under tenant + RLS
            applied[] returned  → outbox.bulkDelete(applied)
```

- **`src/lib/sync/engine.ts`** — `enqueue`, `flush`, `pendingCount`. Validates on enqueue, flushes in `clientSeq` order, deletes only server-confirmed mutations.
- **`src/lib/sync/registry.ts`** — modules register an entity descriptor (`name`, Zod `schema`, conflict strategy). No bespoke sync code per feature.
- **`src/lib/sync/db.ts`** — Dexie store (`outbox`, `cache`), browser-only.
- **`src/lib/sync/use-sync.ts`** / **`use-online-status.ts`** — React hooks driving the sync chip + auto-flush.
- **`/api/sync`** — idempotent batch endpoint; per-entity handlers.

## Guarantees

- **Idempotency** — `clientUuid` is the server upsert key; re-sending an applied mutation is a no-op. Safe to retry blindly.
- **Ordering** — mutations flush in monotonic `clientSeq` order for deterministic last-write-wins.
- **No data loss** — mutations stay in the outbox until the server confirms `applied`. Offline flush is a no-op; a server error leaves them queued for the next flush (tested in `src/lib/sync/engine.test.ts`).
- **Auto-reconnect** — flush triggers on the browser `online` event; TanStack Query additionally refetches on reconnect (`refetchOnReconnect`) so views self-heal.
- **Backpressure** — `/api/sync` caps 500 mutations/request and rate-limits per user.

## Attendance specifics

`labour_attendance` upserts on `(projectId, date, labourSubcategoryId)`; `quantityPresent = 0` deletes the row. The daily rate is **snapshotted on first record** (ADR-0022) and preserved on edits, so historical cost never changes when rates are edited later. Server handler: `applyLabourAttendance` in `src/app/api/sync/route.ts`.

## Conflict handling

Last-write-wins per entity (the registered strategy). The server returns `conflicts[]` with the authoritative value for the UI to surface; today attendance uses LWW so conflicts are rare (one crew records per project/day).

## Testing

`src/lib/sync/engine.test.ts` mocks Dexie + fetch to cover schema validation, ordered flush, the offline no-op guard, applied-mutation cleanup, server-error retention, and idempotent re-send. E2E attendance capture is exercised in `tests/e2e/attendance.spec.ts`.
