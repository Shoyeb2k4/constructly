import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { z } from "zod";

/**
 * Offline sync engine tests. Dexie (IndexedDB) and fetch are mocked so the
 * engine's contract — schema validation, ordered idempotent flush, offline
 * guard, applied-mutation cleanup — is exercised without a browser.
 */

// In-memory stand-in for the Dexie outbox table.
const rows: { clientUuid: string; clientSeq: number; entity: string; op: string; payload: unknown; createdAt: number }[] = [];
const outbox = {
  add: vi.fn(async (m: (typeof rows)[number]) => { rows.push(m); }),
  count: vi.fn(async () => rows.length),
  orderBy: vi.fn(() => ({ toArray: async () => [...rows].sort((a, b) => a.clientSeq - b.clientSeq) })),
  bulkDelete: vi.fn(async (ids: string[]) => {
    for (const id of ids) {
      const i = rows.findIndex((r) => r.clientUuid === id);
      if (i >= 0) rows.splice(i, 1);
    }
  }),
};

vi.mock("./db", () => ({ getDB: () => ({ outbox }) }));

import { enqueue, flush, pendingCount } from "./engine";
import { registerEntity, getEntity } from "./registry";

registerEntity({ name: "test_entity", schema: z.object({ v: z.number() }), conflict: "last-write-wins" });

beforeEach(() => {
  rows.length = 0;
  vi.clearAllMocks();
  vi.stubGlobal("navigator", { onLine: true });
});
afterEach(() => vi.unstubAllGlobals());

describe("sync registry", () => {
  it("registers and resolves entities", () => {
    expect(getEntity("test_entity")?.name).toBe("test_entity");
    expect(getEntity("missing")).toBeUndefined();
  });
});

describe("sync enqueue", () => {
  it("validates payload against the registered schema", async () => {
    await expect(enqueue("test_entity", "upsert", { v: "nope" })).rejects.toThrow();
    expect(rows).toHaveLength(0);
  });
  it("rejects unregistered entities", async () => {
    await expect(enqueue("ghost", "upsert", {})).rejects.toThrow(/not registered/);
  });
  it("queues a valid mutation with a stable clientUuid", async () => {
    const id = await enqueue("test_entity", "upsert", { v: 1 });
    expect(typeof id).toBe("string");
    expect(rows).toHaveLength(1);
    expect(await pendingCount()).toBe(1);
  });
  it("does not validate delete payloads (tombstones)", async () => {
    await expect(enqueue("test_entity", "delete", { anything: true })).resolves.toBeTruthy();
  });
});

describe("sync flush", () => {
  it("is a no-op while offline (data stays in the outbox)", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    await enqueue("test_entity", "upsert", { v: 1 });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await flush();
    expect(res.applied).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1); // preserved — never lose user data
  });

  it("posts mutations in clientSeq order and deletes applied ones", async () => {
    const a = await enqueue("test_entity", "upsert", { v: 1 });
    const b = await enqueue("test_entity", "upsert", { v: 2 });
    let sentOrder: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      sentOrder = body.mutations.map((m: { clientSeq: number }) => m.clientSeq);
      return { ok: true, json: async () => ({ applied: [a, b], conflicts: [] }) };
    }));
    const res = await flush();
    expect(sentOrder).toEqual([...sentOrder].sort((x, y) => x - y)); // ascending
    expect(res.applied).toEqual([a, b]);
    expect(rows).toHaveLength(0); // applied removed
  });

  it("keeps mutations queued when the server errors (retry next flush)", async () => {
    await enqueue("test_entity", "upsert", { v: 1 });
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })));
    await expect(flush()).rejects.toThrow(/500/);
    expect(rows).toHaveLength(1); // not lost
  });

  it("re-sending an applied mutation is safe (idempotent key = clientUuid)", async () => {
    const id = await enqueue("test_entity", "upsert", { v: 1 });
    // Server reports it applied even though the client re-sent it.
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ applied: [id], conflicts: [] }) })));
    await flush();
    await flush(); // second flush has nothing to send
    expect(rows).toHaveLength(0);
  });
});
