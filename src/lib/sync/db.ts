import Dexie, { type Table } from "dexie";
import type { SyncMutation } from "./types";

/**
 * Local-first store. The `outbox` holds pending mutations captured offline;
 * `cache` holds read-through snapshots for offline-readable views
 * (e.g. basic project info). Browser-only — guarded at call sites.
 */
export class ConstructlyDB extends Dexie {
  outbox!: Table<SyncMutation, string>;
  cache!: Table<{ key: string; value: unknown; updatedAt: number }, string>;

  constructor() {
    super("constructly");
    this.version(1).stores({
      outbox: "clientUuid, clientSeq, entity, createdAt",
      cache: "key, updatedAt",
    });
  }
}

let _db: ConstructlyDB | null = null;

/** Lazily create the Dexie instance (only in the browser). */
export function getDB(): ConstructlyDB {
  if (typeof window === "undefined") {
    throw new Error("getDB() called on the server — sync store is browser-only");
  }
  if (!_db) _db = new ConstructlyDB();
  return _db;
}
