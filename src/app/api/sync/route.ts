import { NextResponse } from "next/server";
import { z } from "zod";
import type { SyncResult } from "@/lib/sync/types";
import type { SessionUser } from "@/lib/auth/types";
import { getCurrentUser } from "@/lib/auth/current-user";

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

async function applyAttendance(clientUuid: string, payload: unknown, user: SessionUser) {
  const { prisma } = await import("@/lib/db/prisma");
  const { attendanceMutationSchema } = await import("@/features/labor/schema");
  const { computeWage } = await import("@/features/labor/wage");
  const p = attendanceMutationSchema.parse(payload);

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

  if (p.status == null) {
    await prisma.attendance.deleteMany({
      where: { projectId: p.projectId, laborerId: p.laborerId, date: new Date(p.date), companyId: user.company.id },
    });
    return;
  }
  const laborer = await prisma.laborer.findFirstOrThrow({
    where: { id: p.laborerId, companyId: user.company.id },
    select: { dailyWagePaise: true },
  });
  const { wageRatePaise, wagePayablePaise } = computeWage(laborer.dailyWagePaise, p.status, p.otHours);
  await prisma.attendance.upsert({
    where: { projectId_laborerId_date: { projectId: p.projectId, laborerId: p.laborerId, date: new Date(p.date) } },
    create: {
      companyId: user.company.id,
      projectId: p.projectId,
      laborerId: p.laborerId,
      date: new Date(p.date),
      status: p.status,
      otHours: p.otHours,
      wageRatePaise,
      wagePayablePaise,
      recordedById: user.id,
      clientUuid,
      clientSeq: BigInt(Date.now()),
    },
    update: { status: p.status, otHours: p.otHours, wageRatePaise, wagePayablePaise, recordedById: user.id },
  });
}

const handlers: Record<string, SyncHandler> = {
  attendance: applyAttendance,
};

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Sign in required" } },
      { status: 401 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_BODY", message: "Malformed sync payload" } },
      { status: 422 },
    );
  }

  const result: SyncResult = { applied: [], conflicts: [] };
  for (const m of parsed.data.mutations) {
    const handler = handlers[m.entity];
    if (!handler) continue;
    try {
      await handler(m.clientUuid, m.payload, user);
      result.applied.push(m.clientUuid);
    } catch {
      // Left in the client outbox for retry on the next flush.
    }
  }
  return NextResponse.json(result);
}
