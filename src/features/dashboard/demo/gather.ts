import { poCountsForBudget } from "@/features/budget/calc";
import { demoApprovalRequired } from "@/features/budget/spend";
import type {
  DashActivity,
  RawDashboardData,
  RawLabourEntry,
  RawProcurementPayment,
  RawProcurementPO,
  RawProject,
  RawSpendEntry,
} from "../types";
import { poPaymentStatus } from "@/features/procurement/calc";
import {
  DEMO_VENDORS,
  demoPayments,
  demoPurchaseOrders,
} from "@/features/procurement/demo/seed";
import {
  DEMO_CATEGORIES,
  DEMO_SUBCATEGORIES,
  demoLabourAttendance,
} from "@/features/labor/demo/seed";
import { demoSeed as demoProjectSeed } from "@/features/projects/demo/seed";
import type { PurchaseOrderListItem } from "@/features/procurement/types";

const K = {
  projects: "constructly.demo.projects.v1",
  labourAttendance: "constructly.demo.labourAttendance.v2",
  labourCategories: "constructly.demo.labourCategories.v2",
  labourSubcategories: "constructly.demo.labourSubcategories.v2",
  pos: "constructly.demo.pos.v2",
  posV1: "constructly.demo.pos.v1",
  vendors: "constructly.demo.vendors.v2",
  vendorsV1: "constructly.demo.vendors.v1",
  payments: "constructly.demo.vendorPayments.v1",
};

/**
 * Read a demo store, SEEDING it if it does not exist yet.
 *
 * DEFECT FIX. Each module's demo repository seeds its store on first read, so a
 * store only exists once that module has been visited. This gatherer used to
 * read the raw keys and return `[]` when they were missing — so on a fresh
 * session the dashboard silently reported zero purchase orders, zero vendors
 * and zero labour until the user had toured every module, and then the numbers
 * changed underneath them. A summary that under-reports is worse than one that
 * fails, because nothing looks wrong.
 *
 * The seeds used here are the SAME functions the module repositories use, so
 * the dashboard can never disagree with the module it summarises.
 */
function read<T>(key: string, seed?: () => unknown[]): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (raw != null) return JSON.parse(raw) as T[];
  } catch {
    return [];
  }
  if (!seed) return [];
  const seeded = structuredClone(seed()) as T[];
  try {
    window.localStorage.setItem(key, JSON.stringify(seeded));
  } catch {
    /* storage unavailable — the read still returns the data */
  }
  return seeded;
}

interface StoredProject {
  id: string; name: string; code: string; stage: string; archivedAt: string | null;
  budgetPaise: number; expectedCompletionDate: string | null; updatedAt: string;
  pm: { id: string } | null;
  deadlines: { id: string; title: string; dueDate: string; completedAt: string | null }[];
  activity: { id: string; summary: string; actorName?: string; createdAt: string }[];
}
interface StoredLabour { projectId: string; date: string; labourSubcategoryId: string; quantityPresent: number; estimatedCostPaise: number }
interface StoredCategory { id: string; name: string; color: string | null }
interface StoredSubcategory { id: string; categoryId: string; name: string }
interface StoredPOLine { material: string; category: string | null; amountPaise: number }
interface StoredPO { id: string; poNumber: string; vendorId: string; projectId: string; status: string; purchaseDate: string; expectedDelivery: string | null; subtotalPaise: number; gstPaise: number; totalPaise: number; invoiceNumber: string | null; createdByName: string; createdAt: string; approvedByName: string | null; approvedAt: string | null; lineItems: StoredPOLine[] }
interface StoredVendor { id: string; businessName: string }
interface StoredPayment { vendorId: string; projectId: string; purchaseOrderId: string | null; amountPaise: number }

/** Read the current key, falling back to the pre-v2 store if not migrated. */
function readWithFallback<T>(key: string, legacy: string, seed?: () => unknown[]): T[] {
  if (typeof window === "undefined") return [];
  if (window.localStorage.getItem(key) != null) return read<T>(key);
  if (window.localStorage.getItem(legacy) != null) return read<T>(legacy);
  return read<T>(key, seed);
}

export function gatherDemoDashboard(opts: { userId: string; isOwner: boolean }): RawDashboardData {
  const today = new Date().toISOString().slice(0, 10);
  const approval = demoApprovalRequired();

  let projects = read<StoredProject>(K.projects, demoProjectSeed);
  if (!opts.isOwner) projects = projects.filter((p) => p.pm?.id === opts.userId);
  const projectIds = new Set(projects.map((p) => p.id));
  const projMeta = new Map(projects.map((p) => [p.id, { name: p.name, code: p.code }]));

  const categories = read<StoredCategory>(K.labourCategories, () => DEMO_CATEGORIES);
  const catById = new Map(categories.map((c) => [c.id, c]));
  const subById = new Map(
    read<StoredSubcategory>(K.labourSubcategories, () => DEMO_SUBCATEGORIES).map((s) => [s.id, s]),
  );
  const labour = read<StoredLabour>(K.labourAttendance, demoLabourAttendance).filter((a) =>
    projectIds.has(a.projectId),
  );
  const pos = readWithFallback<StoredPO>(K.pos, K.posV1, demoPurchaseOrders).filter((p) =>
    projectIds.has(p.projectId),
  );
  const vendors = readWithFallback<StoredVendor>(K.vendors, K.vendorsV1, () => DEMO_VENDORS);
  const payments = read<StoredPayment>(K.payments, demoPayments).filter((p) =>
    projectIds.has(p.projectId),
  );
  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.businessName ?? "Unknown";
  const paidByPO = new Map<string, number>();
  payments.forEach((p) => {
    if (p.purchaseOrderId) paidByPO.set(p.purchaseOrderId, (paidByPO.get(p.purchaseOrderId) ?? 0) + p.amountPaise);
  });

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
    const sub = subById.get(a.labourSubcategoryId);
    const c = sub ? catById.get(sub.categoryId) : undefined;
    return {
      date: a.date,
      categoryName: c?.name ?? "Unknown",
      subcategoryName: sub?.name ?? "Unknown",
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

  const toListItem = (p: StoredPO): PurchaseOrderListItem => ({
    id: p.id,
    poNumber: p.poNumber,
    status: p.status as "DRAFT" | "SUBMITTED" | "APPROVED",
    purchaseDate: p.purchaseDate,
    expectedDelivery: null,
    subtotalPaise: p.totalPaise,
    gstPaise: 0,
    totalPaise: p.totalPaise,
    paidPaise: paidByPO.get(p.id) ?? 0,
    paymentStatus: poPaymentStatus(p.totalPaise, paidByPO.get(p.id) ?? 0),
    invoiceNumber: p.invoiceNumber,
    vendor: { id: p.vendorId, name: vendorName(p.vendorId) },
    project: { id: p.projectId, name: projMeta.get(p.projectId)?.name ?? "", code: projMeta.get(p.projectId)?.code ?? "" },
    createdAt: p.createdAt,
  });

  const pendingPOs: PurchaseOrderListItem[] = pos.filter((p) => p.status === "SUBMITTED").map(toListItem);

  const procurementPOs: RawProcurementPO[] = pos.map((p) => ({
    id: p.id,
    poNumber: p.poNumber,
    vendorId: p.vendorId,
    vendorName: vendorName(p.vendorId),
    projectId: p.projectId,
    projectName: projMeta.get(p.projectId)?.name ?? "",
    projectCode: projMeta.get(p.projectId)?.code ?? "",
    status: p.status as "DRAFT" | "SUBMITTED" | "APPROVED",
    purchaseDate: p.purchaseDate,
    expectedDelivery: p.expectedDelivery ?? null,
    gstPaise: p.gstPaise ?? 0,
    totalPaise: p.totalPaise,
    paidPaise: paidByPO.get(p.id) ?? 0,
    createdAt: p.createdAt,
    lines: (p.lineItems ?? []).map((l) => ({ material: l.material, category: l.category ?? null, amountPaise: l.amountPaise })),
  }));
  const procurementPayments: RawProcurementPayment[] = payments.map((p) => ({
    vendorId: p.vendorId,
    amountPaise: p.amountPaise,
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

  return {
    projects: rawProjects,
    spendEntries,
    labourEntries,
    pendingPOs,
    procurementPOs,
    procurementPayments,
    approvalRequired: approval,
    activity,
    today,
  };
}
