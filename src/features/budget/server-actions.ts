"use server";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/current-user";
import type { ProjectSpend } from "./calc";

async function approvalRequired(companyId: string): Promise<boolean> {
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { settings: true } });
  const s = c?.settings as { poApprovalRequired?: boolean } | null;
  return s?.poApprovalRequired ?? false;
}

export async function projectSpend(projectId: string): Promise<ProjectSpend> {
  const user = await requireUser();
  const labor = await prisma.attendance.aggregate({
    where: { companyId: user.company.id, projectId },
    _sum: { wagePayablePaise: true },
  });
  const approval = await approvalRequired(user.company.id);
  const pos = await prisma.purchaseOrder.findMany({
    where: {
      companyId: user.company.id,
      projectId,
      status: approval ? "APPROVED" : { not: "DRAFT" },
    },
    select: { totalPaise: true },
  });
  return {
    laborPaise: labor._sum.wagePayablePaise ?? 0,
    procurementPaise: pos.reduce((s, p) => s + Number(p.totalPaise), 0),
  };
}

export async function spendByProject(): Promise<Record<string, ProjectSpend>> {
  const user = await requireUser();
  const approval = await approvalRequired(user.company.id);
  const labor = await prisma.attendance.groupBy({
    by: ["projectId"],
    where: { companyId: user.company.id },
    _sum: { wagePayablePaise: true },
  });
  const pos = await prisma.purchaseOrder.groupBy({
    by: ["projectId"],
    where: { companyId: user.company.id, status: approval ? "APPROVED" : { not: "DRAFT" } },
    _sum: { totalPaise: true },
  });
  const out: Record<string, ProjectSpend> = {};
  const get = (id: string) => (out[id] ??= { laborPaise: 0, procurementPaise: 0 });
  labor.forEach((l) => (get(l.projectId).laborPaise = l._sum.wagePayablePaise ?? 0));
  pos.forEach((p) => (get(p.projectId).procurementPaise = Number(p._sum.totalPaise ?? 0)));
  return out;
}
