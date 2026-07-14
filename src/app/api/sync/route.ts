import { NextResponse } from "next/server";
import { z } from "zod";
import type { SyncResult } from "@/lib/sync/types";

/**
 * Offline sync endpoint (ADR-0007). Idempotent batch upsert keyed on
 * clientUuid — re-sending an applied mutation is safe. Module 0 ships the
 * stable contract; domain handlers register here as Modules 2–3 land.
 *
 * Server-side handler registry: entity name → apply function. Empty for now.
 */
type SyncHandler = (payload: unknown, companyId: string) => Promise<void>;
const handlers: Record<string, SyncHandler> = {};

const mutationSchema = z.object({
  clientUuid: z.string().uuid(),
  clientSeq: z.number(),
  entity: z.string(),
  op: z.enum(["upsert", "delete"]),
  payload: z.unknown(),
});

const bodySchema = z.object({
  mutations: z.array(mutationSchema),
});

export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_BODY", message: "Malformed sync payload" } },
      { status: 422 },
    );
  }

  // TODO(auth): resolve company from session once auth middleware lands.
  const companyId = "";

  const result: SyncResult = { applied: [], conflicts: [] };

  for (const m of parsed.data.mutations) {
    const handler = handlers[m.entity];
    if (!handler) continue; // Unknown entity: leave queued, no domain table yet.
    try {
      await handler(m.payload, companyId);
      result.applied.push(m.clientUuid);
    } catch {
      // Left in the outbox for retry on next flush.
    }
  }

  return NextResponse.json(result);
}
