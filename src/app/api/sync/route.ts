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

  // Eligibility, offline-safe. Unlike the interactive action we DON'T reject —
  // a queued mutation whose config was later removed would become a poison
  // message that never syncs. Instead we degrade: keep the attendance (the
  // valuable offline data) and drop the now-invalid attribution. Nothing is ever
  // guessed onto a different contractor or agreement.
  //
  // The AGREEMENT is checked first, and when it holds it settles the contractor
  // too. An agreement's scope is its own authority on which labour types the
  // contractor supplies — requiring a project-contractor rate as well would mean
  // configuring the same fact twice, and silently dropping attribution for any
  // labour type priced only by the agreement.
  const { isAgreementAttributionEligible, isAttributionEligible, resolveAttendanceRate } =
    await import("@/features/labor/server/assignment-eligibility");
  let contractorId = p.contractorId ?? null;
  let contractId = p.contractId ?? null;

  const agreementHolds =
    contractorId != null &&
    contractId != null &&
    (await isAgreementAttributionEligible(
      user.company.id,
      p.projectId,
      contractorId,
      contractId,
      p.labourSubcategoryId,
    ));

  if (!agreementHolds) {
    // No usable agreement — fall back to the project-contractor rate check
    // (subcategory-exact, resolved server-side, never trusted from the client).
    contractId = null;
    if (
      contractorId != null &&
      !(await isAttributionEligible(user.company.id, p.projectId, contractorId, p.labourSubcategoryId))
    ) {
      contractorId = null;
    }
  }

  const date = new Date(p.date);

  // Settled labour is financially immutable — a settlement has already billed
  // (and possibly credited to an agreement) exactly these rows. Unlike the
  // eligibility degrade above we do NOT silently rewrite the mutation: the
  // offline client's intent can't be satisfied at all, so drop it rather than
  // corrupt a settled figure. The row it targets already holds the settled
  // value, so nothing offline is lost.
  //
  // The check spans EVERY agreement for this contractor/date/type, not just the
  // targeted one: if the day is settled under another agreement, applying this
  // mutation would create a second row and double-count the same work.
  const settled = await prisma.labourAttendance.findFirst({
    where: {
      companyId: user.company.id,
      projectId: p.projectId,
      date,
      labourSubcategoryId: p.labourSubcategoryId,
      contractorId,
      settlementId: { not: null },
    },
    select: { id: true },
  });
  if (settled) return;

  // Identity is FIVE fields: project, date, labour type, contractor AND
  // agreement. Every WHERE below carries all five — dropping `contractId` would
  // make an offline edit for one agreement overwrite, or clear, another's row.
  const identity = {
    companyId: user.company.id,
    projectId: p.projectId,
    date,
    labourSubcategoryId: p.labourSubcategoryId,
    contractorId,
    contractId,
  };

  if (p.quantityPresent <= 0) {
    await prisma.labourAttendance.deleteMany({ where: identity });
    return;
  }
  // findFirst, not the compound-unique accessor: Prisma types both nullable
  // identity columns as non-null there, so it cannot target a NULL-contractor or
  // NULL-agreement row.
  const existing = await prisma.labourAttendance.findFirst({
    where: identity,
    select: {
      id: true,
      dailyRatePaiseSnapshot: true,
      projectContractorLabourRateId: true,
      contractScopeRateRevisionId: true,
    },
  });
  // Snapshot the effective rate on first recording; edits keep it (ADR-0022).
  // A new row resolves against the ROW'S OWN DATE — an offline entry that syncs
  // days later must still be valued at the rate in force when the work happened.
  const resolved = existing
    ? {
        ratePaise: existing.dailyRatePaiseSnapshot,
        projectContractorLabourRateId: existing.projectContractorLabourRateId,
        contractScopeRateRevisionId: existing.contractScopeRateRevisionId,
      }
    : await resolveAttendanceRate(
        user.company.id,
        p.projectId,
        contractorId,
        p.labourSubcategoryId,
        contractId,
        p.date,
      );
  const estimatedCostPaise = Math.round((resolved.ratePaise ?? 0) * p.quantityPresent);

  if (existing) {
    await prisma.labourAttendance.update({
      where: { id: existing.id },
      data: {
        quantityPresent: p.quantityPresent,
        estimatedCostPaise,
        ...(p.notes !== undefined ? { notes: p.notes } : {}),
      },
    });
  } else {
    await prisma.labourAttendance.create({
      data: {
        ...identity,
        quantityPresent: p.quantityPresent,
        dailyRatePaiseSnapshot: resolved.ratePaise,
        projectContractorLabourRateId: resolved.projectContractorLabourRateId,
        contractScopeRateRevisionId: resolved.contractScopeRateRevisionId,
        estimatedCostPaise,
        notes: p.notes ?? null,
        clientUuid,
        clientSeq: BigInt(Date.now()),
      },
    });
  }
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
