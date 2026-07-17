"use server";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/current-user";
import type { ProjectSpend } from "./calc";

async function approvalRequired(companyId: string): Promise<boolean> {
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { settings: true } });
  const s = c?.settings as { poApprovalRequired?: boolean } | null;
  return s?.poApprovalRequired ?? false;
}

/** Labor cost = stored snapshot estimates (ADR-0022) — a simple sum. */
async function labourByProject(companyId: string): Promise<Map<string, number>> {
  const rows = await prisma.labourAttendance.groupBy({
    by: ["projectId"],
    where: { companyId },
    _sum: { estimatedCostPaise: true },
  });
  return new Map(rows.map((r) => [r.projectId, r._sum.estimatedCostPaise ?? 0]));
}

export async function projectSpend(projectId: string): Promise<ProjectSpend> {
  const user = await requireUser();
  const approval = await approvalRequired(user.company.id);
  const [labour, pos] = await Promise.all([
    prisma.labourAttendance.aggregate({
      where: { companyId: user.company.id, projectId },
      _sum: { estimatedCostPaise: true },
    }),
    prisma.purchaseOrder.findMany({
      where: {
        companyId: user.company.id,
        projectId,
        status: approval ? "APPROVED" : { not: "DRAFT" },
      },
      select: { totalPaise: true },
    }),
  ]);
  return {
    laborPaise: labour._sum.estimatedCostPaise ?? 0,
    procurementPaise: pos.reduce((s, p) => s + Number(p.totalPaise), 0),
  };
}

export async function spendByProject(): Promise<Record<string, ProjectSpend>> {
  const user = await requireUser();
  const approval = await approvalRequired(user.company.id);
  const [labour, pos] = await Promise.all([
    labourByProject(user.company.id),
    prisma.purchaseOrder.groupBy({
      by: ["projectId"],
      where: { companyId: user.company.id, status: approval ? "APPROVED" : { not: "DRAFT" } },
      _sum: { totalPaise: true },
    }),
  ]);
  const out: Record<string, ProjectSpend> = {};
  const get = (id: string) => (out[id] ??= { laborPaise: 0, procurementPaise: 0 });
  labour.forEach((paise, projectId) => (get(projectId).laborPaise = paise));
  pos.forEach((p) => (get(p.projectId).procurementPaise = Number(p._sum.totalPaise ?? 0)));
  return out;
}
