"use server";

import { prisma } from "@/lib/db/prisma";
import { requireUser } from "@/lib/auth/current-user";
import { spendByProject } from "@/features/budget/server-actions";
import { poCountsForBudget } from "@/features/budget/calc";
import { poPaymentStatus } from "@/features/procurement/calc";
import type {
  DashActivity,
  RawDashboardData,
  RawLabourEntry,
  RawProcurementPayment,
  RawProcurementPO,
  RawSpendEntry,
} from "../types";
import type { PurchaseOrderListItem } from "@/features/procurement/types";

export async function gatherServerDashboard(): Promise<RawDashboardData> {
  const user = await requireUser();
  const isOwner = user.role === "OWNER";
  const companyId = user.company.id;
  const today = new Date().toISOString().slice(0, 10);
  const windowStart = new Date(Date.now() - 8 * 7 * 86_400_000);

  const projectWhere = { companyId, deletedAt: null, ...(isOwner ? {} : { pmId: user.id }) };

  const [projects, spend, company, labour, pos, payments, logs, materials] = await Promise.all([
    prisma.project.findMany({ where: projectWhere, include: { deadlines: true } }),
    spendByProject(),
    prisma.company.findUnique({ where: { id: companyId }, select: { settings: true } }),
    prisma.labourAttendance.findMany({
      where: { companyId, date: { gte: windowStart }, ...(isOwner ? {} : { project: { pmId: user.id } }) },
      include: { subcategory: { include: { category: { select: { name: true, color: true } } } } },
    }),
    prisma.purchaseOrder.findMany({
      where: { companyId, ...(isOwner ? {} : { project: { pmId: user.id } }) },
      include: {
        vendor: { select: { businessName: true } },
        project: { select: { name: true, code: true } },
        lineItems: { select: { material: true, materialId: true, category: true, amountPaise: true } },
      },
    }),
    prisma.vendorPayment.findMany({
      where: { companyId, ...(isOwner ? {} : { project: { pmId: user.id } }) },
      select: { vendorId: true, purchaseOrderId: true, amountPaise: true },
    }),
    prisma.activityLog.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { actor: { select: { fullName: true } } },
    }),
    // One query for the whole Material Master (archived included) — labels the
    // top-materials buckets by current name. Never a lookup per line.
    prisma.material.findMany({ where: { companyId }, select: { id: true, name: true, deletedAt: true } }),
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

  const labourEntries: RawLabourEntry[] = labour.map((a) => ({
    date: a.date.toISOString().slice(0, 10),
    categoryName: a.subcategory.category.name,
    subcategoryName: a.subcategory.name,
    color: a.subcategory.category.color ?? "#64748B",
    quantityPresent: a.quantityPresent,
    estimatedCostPaise: a.estimatedCostPaise,
  }));

  const spendEntries: RawSpendEntry[] = [
    ...labourEntries.map((e) => ({
      date: e.date,
      laborPaise: e.estimatedCostPaise,
      procurementPaise: 0,
    })),
    ...pos
      .filter((p) => poCountsForBudget(p.status, approval))
      .map((p) => ({ date: p.purchaseDate.toISOString().slice(0, 10), laborPaise: 0, procurementPaise: Number(p.totalPaise) })),
  ];

  const paidByPO = new Map<string, number>();
  payments.forEach((p) => {
    if (p.purchaseOrderId) paidByPO.set(p.purchaseOrderId, (paidByPO.get(p.purchaseOrderId) ?? 0) + Number(p.amountPaise));
  });

  const toListItem = (p: (typeof pos)[number]): PurchaseOrderListItem => {
    const total = Number(p.totalPaise);
    const paid = paidByPO.get(p.id) ?? 0;
    return {
      id: p.id,
      poNumber: p.poNumber,
      status: p.status,
      purchaseDate: p.purchaseDate.toISOString().slice(0, 10),
      expectedDelivery: p.expectedDelivery ? p.expectedDelivery.toISOString().slice(0, 10) : null,
      subtotalPaise: Number(p.subtotalPaise),
      gstPaise: Number(p.gstPaise),
      totalPaise: total,
      paidPaise: paid,
      paymentStatus: poPaymentStatus(total, paid),
      invoiceNumber: p.invoiceNumber,
      vendor: { id: p.vendorId, name: p.vendor.businessName },
      project: { id: p.projectId, name: p.project.name, code: p.project.code },
      createdAt: p.createdAt.toISOString(),
    };
  };

  const pendingPOs = pos.filter((p) => p.status === "SUBMITTED").map(toListItem);

  const procurementPOs: RawProcurementPO[] = pos.map((p) => ({
    id: p.id,
    poNumber: p.poNumber,
    vendorId: p.vendorId,
    vendorName: p.vendor.businessName,
    projectId: p.projectId,
    projectName: p.project.name,
    projectCode: p.project.code,
    status: p.status,
    purchaseDate: p.purchaseDate.toISOString().slice(0, 10),
    expectedDelivery: p.expectedDelivery ? p.expectedDelivery.toISOString().slice(0, 10) : null,
    gstPaise: Number(p.gstPaise),
    totalPaise: Number(p.totalPaise),
    paidPaise: paidByPO.get(p.id) ?? 0,
    createdAt: p.createdAt.toISOString(),
    lines: p.lineItems.map((l) => ({
      material: l.material,
      materialId: l.materialId,
      category: l.category,
      amountPaise: Number(l.amountPaise),
    })),
  }));
  const procurementPayments: RawProcurementPayment[] = payments.map((p) => ({
    vendorId: p.vendorId,
    amountPaise: Number(p.amountPaise),
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
    labourEntries,
    pendingPOs,
    procurementPOs,
    procurementMaterials: materials.map((m) => ({ id: m.id, name: m.name, archived: m.deletedAt !== null })),
    procurementPayments,
    approvalRequired: approval,
    activity,
    today,
  };
}
