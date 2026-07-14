import type { SyncableEntity } from "./types";

/**
 * Central registry of offline-capable entities. Modules call `registerEntity`
 * at import time. Module 0 ships the registry empty; Modules 2–3 register
 * `attendance`, `purchase_order` (quick-create), and `note`.
 */
const registry = new Map<string, SyncableEntity>();

export function registerEntity<T>(entity: SyncableEntity<T>): void {
  registry.set(entity.name, entity as SyncableEntity);
}

export function getEntity(name: string): SyncableEntity | undefined {
  return registry.get(name);
}

export function listEntities(): SyncableEntity[] {
  return [...registry.values()];
}
