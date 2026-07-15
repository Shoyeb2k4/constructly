"use server";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { spendByProject } from "@/features/budget/server-actions";
import { poCountsForBudget } from "@/features/budget/calc";
import type { DashActivity, RawDashboardData, RawSpendEntry } from "../types";

export async function gatherServerDashboard(): Promise<RawDashboardData> {
  const user = await requireUser();
  const isOwner = user.role === "OWNER";
  const companyId = user.company.id;
  const today = new Date().toISOString().slice(0, 10);
  const windowStart = new Date(Date.now() - 8 * 7 * 86_400_000);

  const projectWhere = { companyId, deletedAt: null, ...(isOwner ? {} : { pmId: user.id }) };

  const [projects, spend, company, attendance, pos, logs] = await Promise.all([
    prisma.project.findMany({ where: projectWhere, include: { deadlines: true } }),
    spendByProject(),
    prisma.company.findUnique({ where: { id: companyId }, select: { settings: true } }),
    prisma.attendance.findMany({
      where: { companyId, date: { gte: windowStart }, ...(isOwner ? {} : { project: { pmId: user.id } }) },
      select: { projectId: true, date: true, status: true, wagePayablePaise: true },
    }),
    prisma.purchaseOrder.findMany({
      where: { companyId, ...(isOwner ? {} : { project: { pmId: user.id } }) },
      include: { vendor: { select: { businessName: true } } },
    }),
    prisma.activityLog.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { actor: { select: { fullName: true } } },
    }),
  ]);

  const approval = (company?.settings as { poApprovalRequired?: boolean } | null)?.poApprovalRequired ?? false;
  const lastActivity = new Map<string, string>();
  logs.forEach((l) => {
    if (l.entityType === "project" && !lastActivity.has(l.entityId)) lastActivity.set(l.entityId, l.createdAt.toISOString());
  });

  const rawProjects = projects.map((p) => {
    const s = spend[p.id] ?? { laborPaise: 0, procurementPaise: 0 };
    return {
      id: p.id,
      name: p.name,
      code: p.code,
      stage: p.stage,
      archived: !!p.archivedAt,
      budgetPaise: Number(p.budgetPaise),
      laborPaise: s.laborPaise,
      procurementPaise: s.procurementPaise,
      expectedCompletionDate: p.expectedCompletionDate ? p.expectedCompletionDate.toISOString().slice(0, 10) : null,
      deadlines: p.deadlines.map((d) => ({ id: d.id, title: d.title, dueDate: d.dueDate.toISOString().slice(0, 10), completedAt: d.completedAt ? d.completedAt.toISOString() : null })),
      lastActivityAt: lastActivity.get(p.id) ?? p.updatedAt.toISOString(),
    };
  });

  const spendEntries: RawSpendEntry[] = [
    ...attendance.map((a) => ({ date: a.date.toISOString().slice(0, 10), laborPaise: a.wagePayablePaise, procurementPaise: 0 })),
    ...pos
      .filter((p) => poCountsForBudget(p.status, approval))
      .map((p) => ({ date: p.purchaseDate.toISOString().slice(0, 10), laborPaise: 0, procurementPaise: Number(p.totalPaise) })),
  ];

  const todays = attendance.filter((a) => a.date.toISOString().slice(0, 10) === today);

  const pendingPOs = pos
    .filter((p) => p.status === "SUBMITTED")
    .map((p) => ({
      id: p.id,
      poNumber: p.poNumber,
      status: "SUBMITTED" as const,
      purchaseDate: p.purchaseDate.toISOString().slice(0, 10),
      totalPaise: Number(p.totalPaise),
      invoiceNumber: p.invoiceNumber,
      vendor: { id: p.vendorId, name: p.vendor.businessName },
      project: { id: p.projectId, name: "", code: "" },
      createdAt: p.createdAt.toISOString(),
    }));

  const activity: DashActivity[] = logs.map((l) => ({
    id: l.id,
    summary: l.summary,
    actorName: l.actor?.fullName ?? null,
    createdAt: l.createdAt.toISOString(),
    href: l.entityType === "project" ? `/projects/${l.entityId}` : "/dashboard",
    kind: "project",
  }));

  return {
    projects: rawProjects,
    spendEntries,
    todaysLaborCount: todays.filter((a) => a.status === "PRESENT" || a.status === "HALF_DAY").length,
    todaysWagesPaise: todays.reduce((s, a) => s + a.wagePayablePaise, 0),
    pendingPOs,
    activity,
    today,
  };
}
