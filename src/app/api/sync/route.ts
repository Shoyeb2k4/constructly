import { NextResponse } from "next/server";
import { z } from "zod";
import type { SyncResult } from "@/lib/sync/types";
import type { SessionUser } from "@/lib/auth/types";
import { getCurrentUser } from "@/lib/auth/current-user";
import { rateLimit } from "@/lib/rate-limit";
import { reportError } from "@/lib/logger";

// A generous ceiling — normal field sync is a handful of rows per flush. This
// guards against a runaway client or abuse, not legitimate use.
const SYNC_LIMIT = { limit: 120, windowMs: 60_000 };
// Cap the batch so one request can't enqueue unbounded work.
const MAX_MUTATIONS = 500;

/**
 * Offline sync endpoint (ADR-0007). Idempotent batch upsert keyed on
 * clientUuid — re-sending an applied mutation is safe. Domain handlers apply
 * each mutation under the caller's tenant + RLS. Last-write-wins per entity.
 */
type SyncHandler = (
  clientUuid: string,
  payload: unknown,
  user: SessionUser,
) => Promise<void>;

const mutationSchema = z.object({
  clientUuid: z.string().uuid(),
  clientSeq: z.number(),
  entity: z.string(),
  op: z.enum(["upsert", "delete"]),
  payload: z.unknown(),
});
const bodySchema = z.object({ mutations: z.array(mutationSchema) });

async function applyLabourAttendance(clientUuid: string, payload: unknown, user: SessionUser) {
  const { prisma } = await import("@/lib/db/prisma");
  const { labourAttendanceMutationSchema } = await import("@/features/labor/schema");
  const p = labourAttendanceMutationSchema.parse(payload);

  // Tenant + project-access guard (RLS is the backstop).
  const project = await prisma.project.findFirst({
    where: {
      id: p.projectId,
      companyId: user.company.id,
      ...(user.role !== "OWNER" ? { pmId: user.id } : {}),
    },
    select: { id: true },
  });
  if (!project) throw new Error("FORBIDDEN");

  const key = {
    projectId: p.projectId,
    date: new Date(p.date),
    labourSubcategoryId: p.labourSubcategoryId,
  };
  if (p.quantityPresent <= 0) {
    await prisma.labourAttendance.deleteMany({ where: { ...key, companyId: user.company.id } });
    return;
  }
  // Snapshot the rate on first recording; edits keep it (ADR-0022).
  const existing = await prisma.labourAttendance.findUnique({
    where: { projectId_date_labourSubcategoryId: key },
    select: { dailyRatePaiseSnapshot: true },
  });
  const snapshot = existing
    ? existing.dailyRatePaiseSnapshot
    : (
        await prisma.labourSubcategory.findFirstOrThrow({
          where: { id: p.labourSubcategoryId, companyId: user.company.id },
          select: { dailyRatePaise: true },
        })
      ).dailyRatePaise;
  await prisma.labourAttendance.upsert({
    where: { projectId_date_labourSubcategoryId: key },
    create: {
      companyId: user.company.id,
      ...key,
      quantityPresent: p.quantityPresent,
      dailyRatePaiseSnapshot: snapshot,
      estimatedCostPaise: Math.round((snapshot ?? 0) * p.quantityPresent),
      notes: p.notes ?? null,
      contractorId: p.contractorId ?? null,
      clientUuid,
      clientSeq: BigInt(Date.now()),
    },
    update: {
      quantityPresent: p.quantityPresent,
      estimatedCostPaise: Math.round((snapshot ?? 0) * p.quantityPresent),
      ...(p.notes !== undefined ? { notes: p.notes } : {}),
      ...(p.contractorId !== undefined ? { contractorId: p.contractorId } : {}),
    },
  });
}

const handlers: Record<string, SyncHandler> = {
  labour_attendance: applyLabourAttendance,
};

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Sign in required" } },
      { status: 401 },
    );
  }

  // Per-user rate limit (RLS + auth already scope access; this caps volume).
  const rl = rateLimit(`sync:${user.id}`, SYNC_LIMIT);
  if (!rl.ok) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Too many sync requests" } },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_BODY", message: "Malformed sync payload" } },
      { status: 422 },
    );
  }
  if (parsed.data.mutations.length > MAX_MUTATIONS) {
    return NextResponse.json(
      { error: { code: "BATCH_TOO_LARGE", message: `Max ${MAX_MUTATIONS} mutations per request` } },
      { status: 413 },
    );
  }

  const result: SyncResult = { applied: [], conflicts: [] };
  for (const m of parsed.data.mutations) {
    const handler = handlers[m.entity];
    if (!handler) continue;
    try {
      await handler(m.clientUuid, m.payload, user);
      result.applied.push(m.clientUuid);
    } catch (err) {
      // Left in the client outbox for retry on the next flush.
      reportError(err, { scope: "sync", entity: m.entity, clientUuid: m.clientUuid, userId: user.id });
    }
  }
  return NextResponse.json(result);
}
