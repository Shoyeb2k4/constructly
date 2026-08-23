import { getDB } from "./db";
import { getEntity } from "./registry";
import type { SyncMutation, SyncOp, SyncResult } from "./types";
import { isNativeClient, mobileApiBase } from "@/lib/mobile/platform";
import { getAccessToken } from "@/lib/mobile/session";

let seqCounter = 0;

function nextSeq(): number {
  seqCounter = Math.max(seqCounter + 1, Date.now());
  return seqCounter;
}

/**
 * Queue a mutation for an offline-capable entity. Validates against the
 * registered schema, then persists to the outbox. Returns the clientUuid.
 */
export async function enqueue(
  entity: string,
  op: SyncOp,
  payload: unknown,
): Promise<string> {
  const descriptor = getEntity(entity);
  if (!descriptor) {
    throw new Error(`Entity "${entity}" is not registered for offline sync`);
  }
  if (op === "upsert") {
    descriptor.schema.parse(payload);
  }

  const mutation: SyncMutation = {
    clientUuid: crypto.randomUUID(),
    clientSeq: nextSeq(),
    entity,
    op,
    payload,
    createdAt: Date.now(),
  };

  await getDB().outbox.add(mutation);
  return mutation.clientUuid;
}

/** Count of mutations still awaiting sync. */
export async function pendingCount(): Promise<number> {
  return getDB().outbox.count();
}

/**
 * Flush the outbox to the server in sequence order. Idempotent: the server
 * upserts on clientUuid, so re-sending an already-applied mutation is safe.
 * Applied mutations are removed; conflicts are returned for UI surfacing.
 */
export async function flush(): Promise<SyncResult> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { applied: [], conflicts: [] };
  }

  const db = getDB();
  const batch = await db.outbox.orderBy("clientSeq").toArray();
  if (batch.length === 0) return { applied: [], conflicts: [] };

  // Two things differ inside Capacitor, and both are silent failures if missed:
  //  - a relative "/api/sync" resolves against the WebView's own origin
  //    (https://localhost), where no server exists;
  //  - there are no cookies to authenticate with, so the session is presented
  //    as a bearer token, exactly as the mobile RPC does.
  // On the web both reduce to the original behaviour: empty base, no header.
  const token = isNativeClient ? await getAccessToken() : null;

  const res = await fetch(`${mobileApiBase}/api/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      mutations: batch.map((m) => ({
        clientUuid: m.clientUuid,
        clientSeq: m.clientSeq,
        entity: m.entity,
        op: m.op,
        payload: m.payload,
      })),
    }),
  });

  if (!res.ok) {
    throw new Error(`Sync failed with status ${res.status}`);
  }

  const result = (await res.json()) as SyncResult;
  if (result.applied.length > 0) {
    await db.outbox.bulkDelete(result.applied);
  }
  return result;
}
