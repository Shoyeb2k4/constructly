import { poCountsForBudget } from "@/features/budget/calc";
import { demoApprovalRequired } from "@/features/budget/spend";
import type {
  DashActivity,
  RawDashboardData,
  RawLabourEntry,
  RawProject,
  RawSpendEntry,
} from "../types";
import type { PurchaseOrderListItem } from "@/features/procurement/types";

const K = {
  projects: "constructly.demo.projects.v1",
  labourAttendance: "constructly.demo.labourAttendance.v1",
  labourCategories: "constructly.demo.labourCategories.v1",
  pos: "constructly.demo.pos.v1",
  vendors: "constructly.demo.vendors.v1",
};

function read<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? "[]") as T[];
  } catch {
    return [];
  }
}

interface StoredProject {
  id: string; name: string; code: string; stage: string; archivedAt: string | null;
  budgetPaise: number; expectedCompletionDate: string | null; updatedAt: string;
  pm: { id: string } | null;
  deadlines: { id: string; title: string; dueDate: string; completedAt: string | null }[];
  activity: { id: string; summary: string; actorName?: string; createdAt: string }[];
}
interface StoredLabour { projectId: string; date: string; labourCategoryId: string; quantityPresent: number; estimatedCostPaise: number }
interface StoredCategory { id: string; name: string; color: string; dailyRatePaise: number | null }
interface StoredPO { id: string; poNumber: string; vendorId: string; projectId: string; status: string; purchaseDate: string; totalPaise: number; invoiceNumber: string | null; createdByName: string; createdAt: string; approvedByName: string | null; approvedAt: string | null }
interface StoredVendor { id: string; businessName: string }

export function gatherDemoDashboard(opts: { userId: string; isOwner: boolean }): RawDashboardData {
  const today = new Date().toISOString().slice(0, 10);
  const approval = demoApprovalRequired();

  let projects = read<StoredProject>(K.projects);
  if (!opts.isOwner) projects = projects.filter((p) => p.pm?.id === opts.userId);
  const projectIds = new Set(projects.map((p) => p.id));
  const projMeta = new Map(projects.map((p) => [p.id, { name: p.name, code: p.code }]));

  const categories = read<StoredCategory>(K.labourCategories);
  const catById = new Map(categories.map((c) => [c.id, c]));
  const labour = read<StoredLabour>(K.labourAttendance).filter((a) => projectIds.has(a.projectId));
  const pos = read<StoredPO>(K.pos).filter((p) => projectIds.has(p.projectId));
  const vendors = read<StoredVendor>(K.vendors);
  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.businessName ?? "Unknown";

  // Per-project labor (stored snapshot estimates, ADR-0022) + procurement.
  const laborByProject = new Map<string, number>();
  labour.forEach((a) => {
    laborByProject.set(a.projectId, (laborByProject.get(a.projectId) ?? 0) + (a.estimatedCostPaise ?? 0));
  });
  const procByProject = new Map<string, number>();
  pos
    .filter((p) => poCountsForBudget(p.status as "DRAFT" | "SUBMITTED" | "APPROVED", approval))
    .forEach((p) => procByProject.set(p.projectId, (procByProject.get(p.projectId) ?? 0) + p.totalPaise));

  const rawProjects: RawProject[] = projects.map((p) => ({
    id: p.id,
    name: p.name,
    code: p.code,
    stage: p.stage,
    archived: !!p.archivedAt,
    budgetPaise: p.budgetPaise,
    laborPaise: laborByProject.get(p.id) ?? 0,
    procurementPaise: procByProject.get(p.id) ?? 0,
    expectedCompletionDate: p.expectedCompletionDate,
    deadlines: p.deadlines,
    lastActivityAt: p.activity[0]?.createdAt ?? p.updatedAt ?? null,
  }));

  const labourEntries: RawLabourEntry[] = labour.map((a) => {
    const c = catById.get(a.labourCategoryId);
    return {
      date: a.date,
      categoryName: c?.name ?? "Unknown",
      color: c?.color ?? "#64748B",
      quantityPresent: a.quantityPresent,
      estimatedCostPaise: a.estimatedCostPaise ?? 0,
    };
  });

  const spendEntries: RawSpendEntry[] = [
    ...labourEntries.map((e) => ({
      date: e.date,
      laborPaise: e.estimatedCostPaise,
      procurementPaise: 0,
    })),
    ...pos
      .filter((p) => poCountsForBudget(p.status as "DRAFT" | "SUBMITTED" | "APPROVED", approval))
      .map((p) => ({ date: p.purchaseDate, laborPaise: 0, procurementPaise: p.totalPaise })),
  ];

  const pendingPOs: PurchaseOrderListItem[] = pos
    .filter((p) => p.status === "SUBMITTED")
    .map((p) => ({
      id: p.id,
      poNumber: p.poNumber,
      status: "SUBMITTED",
      purchaseDate: p.purchaseDate,
      totalPaise: p.totalPaise,
      invoiceNumber: p.invoiceNumber,
      vendor: { id: p.vendorId, name: vendorName(p.vendorId) },
      project: { id: p.projectId, name: projMeta.get(p.projectId)?.name ?? "", code: projMeta.get(p.projectId)?.code ?? "" },
      createdAt: p.createdAt,
    }));

  // Unified activity feed.
  const activity: DashActivity[] = [];
  projects.forEach((p) =>
    p.activity.slice(0, 4).forEach((a) =>
      activity.push({ id: a.id, summary: a.summary, actorName: a.actorName ?? null, createdAt: a.createdAt, href: `/projects/${p.id}`, kind: "project" }),
    ),
  );
  pos.forEach((p) => {
    activity.push({ id: `${p.id}-c`, summary: `created ${p.poNumber} for ${vendorName(p.vendorId)}`, actorName: p.createdByName, createdAt: p.createdAt, href: `/procurement/${p.id}`, kind: "purchase_order" });
    if (p.approvedAt) activity.push({ id: `${p.id}-a`, summary: `approved ${p.poNumber}`, actorName: p.approvedByName, createdAt: p.approvedAt, href: `/procurement/${p.id}`, kind: "purchase_order" });
  });
  const byDate = new Map<string, number>();
  labour.forEach((a) => byDate.set(a.date, (byDate.get(a.date) ?? 0) + a.quantityPresent));
  [...byDate.entries()].slice(-6).forEach(([date, total]) =>
    activity.push({ id: `att-${date}`, summary: `recorded labour attendance — ${total} workers`, actorName: null, createdAt: `${date}T09:00:00.000Z`, href: "/labor", kind: "attendance" }),
  );

  return { projects: rawProjects, spendEntries, labourEntries, pendingPOs, activity, today };
}
