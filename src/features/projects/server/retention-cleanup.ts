import "server-only";
import { prisma } from "@/lib/db/prisma";
import { isPurgeEligible, purgeEligibleAt } from "../retention";

/**
 * Retention cleanup — the internal/admin-only path for PERMANENTLY (physically)
 * removing soft-deleted projects once their company retention window has elapsed
 * (GDPR, legal, storage). This module is deliberately NOT a set of server
 * actions: it is `server-only` and exposes no `"use server"` surface, so it can
 * never be invoked from the browser or by a normal user. Wire it to a scheduled
 * job or an admin tool. Nothing here runs automatically on its own.
 */

export interface PurgeCandidate {
  id: string;
  companyId: string;
  code: string;
  name: string;
  deletedAt: Date;
  retentionDays: number;
  eligibleAt: Date;
}

/**
 * List soft-deleted projects that are past their retention window and therefore
 * ELIGIBLE for permanent cleanup. Read-only — returns candidates for review and
 * never deletes. Companies with no retention policy (indefinite) are excluded.
 */
export async function findPurgeEligibleProjects(now: Date = new Date()): Promise<PurgeCandidate[]> {
  const rows = await prisma.project.findMany({
    where: {
      deletedAt: { not: null },
      company: { projectRetentionDays: { not: null } },
    },
    select: {
      id: true,
      companyId: true,
      code: true,
      name: true,
      deletedAt: true,
      company: { select: { projectRetentionDays: true } },
    },
  });

  const out: PurgeCandidate[] = [];
  for (const r of rows) {
    const days = r.company.projectRetentionDays;
    if (days == null || !r.deletedAt) continue;
    if (!isPurgeEligible(r.deletedAt, days, now)) continue;
    out.push({
      id: r.id,
      companyId: r.companyId,
      code: r.code,
      name: r.name,
      deletedAt: r.deletedAt,
      retentionDays: days,
      eligibleAt: purgeEligibleAt(r.deletedAt, days)!,
    });
  }
  return out;
}

/**
 * Permanently delete ONE soft-deleted project that is past its retention window
 * — the reviewed, admin-only GDPR/cleanup operation. Cascades to all child
 * records at the DB level and records a `project.purged` audit entry (which
 * survives, being unlinked from the project row). Refuses any project that isn't
 * soft-deleted or isn't yet eligible, so a scheduled job can never destroy live
 * or still-recoverable data.
 */
export async function purgeProject(id: string, now: Date = new Date()): Promise<void> {
  const p = await prisma.project.findUnique({
    where: { id },
    select: {
      id: true,
      companyId: true,
      code: true,
      name: true,
      deletedAt: true,
      company: { select: { projectRetentionDays: true } },
    },
  });
  if (!p || !p.deletedAt) throw new Error("NOT_ELIGIBLE: project is not soft-deleted");
  if (!isPurgeEligible(p.deletedAt, p.company.projectRetentionDays, now)) {
    throw new Error("NOT_ELIGIBLE: retention window has not elapsed");
  }
  await prisma.$transaction([
    prisma.activityLog.create({
      data: {
        companyId: p.companyId,
        actorId: null, // system/admin cleanup — no interactive actor
        action: "project.purged",
        entityType: "project",
        entityId: id,
        summary: `permanently deleted project ${p.code} — ${p.name} (retention cleanup)`,
        meta: { code: p.code, name: p.name, retentionDays: p.company.projectRetentionDays },
      },
    }),
    prisma.project.delete({ where: { id } }),
  ]);
}
