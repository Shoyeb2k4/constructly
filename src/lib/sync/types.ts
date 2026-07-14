import type { z } from "zod";

export type SyncOp = "upsert" | "delete";

/** A single queued mutation, persisted in the IndexedDB outbox. */
export interface SyncMutation {
  /** Client-generated stable id — the idempotency key on the server. */
  clientUuid: string;
  /** Monotonic per-client sequence for deterministic flush order. */
  clientSeq: number;
  entity: string;
  op: SyncOp;
  payload: unknown;
  createdAt: number;
  /** Last error message if a flush attempt failed. */
  lastError?: string;
}

export interface SyncConflict {
  clientUuid: string;
  serverValue: unknown;
}

export interface SyncResult {
  applied: string[];
  conflicts: SyncConflict[];
}

/**
 * A module makes an entity offline-capable by registering a descriptor.
 * No bespoke sync code per feature — the engine handles queueing, ordering,
 * idempotent flush, and conflict surfacing generically.
 */
export interface SyncableEntity<T = unknown> {
  name: string;
  /** Validates a payload before it enters the outbox. */
  schema: z.ZodType<T>;
  /** Conflict strategy hint sent to the server. */
  conflict: "last-write-wins" | "server-wins";
}
