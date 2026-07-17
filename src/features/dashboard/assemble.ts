import { deriveBudget, poCountsForBudget } from "@/features/budget/calc";
import { poPaymentStatus } from "@/features/procurement/calc";
import type { PurchaseOrderListItem } from "@/features/procurement/types";
import type {
  BudgetHealthItem,
  DashboardSnapshot,
  DeadlineItem,
  MaterialSpendRow,
  ProcurementWidget,
  ProjectSpendRow,
  RawDashboardData,
  RawProject,
  SpendWeek,
  UpcomingDelivery,
  VendorRollupRow,
} from "./types";

const DAY = 86_400_000;
const CLOSED_STAGES = new Set(["CLOSED"]);

function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO + "T00:00:00Z").getTime();
  const b = new Date(toISO + "T00:00:00Z").getTime();
  return Math.round((a - b) / DAY);
}

/** Monday (ISO week start) of a given YYYY-MM-DD. UTC-based so it's TZ-stable. */
export function weekStart(dateISO: string): string {
  const d = new Date(dateISO + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/** Bucket spend entries into the last `weeks` ISO weeks ending at `today`. */
export function bucketSpendByWeek(
  entries: RawDashboardData["spendEntries"],
  today: string,
  weeks = 8,
): SpendWeek[] {
  const thisWeek = weekStart(today);
  const buckets: SpendWeek[] = [];
  const index = new Map<string, SpendWeek>();
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = new Date(thisWeek + "T00:00:00Z");
    ws.setUTCDate(ws.getUTCDate() - i * 7);
    const key = ws.toISOString().slice(0, 10);
    const bucket = { weekStart: key, laborPaise: 0, procurementPaise: 0 };
    buckets.push(bucket);
    index.set(key, bucket);
  }
  for (const e of entries) {
    const b = index.get(weekStart(e.date));
    if (b) {
      b.laborPaise += e.laborPaise;
      b.procurementPaise += e.procurementPaise;
    }
  }
  return buckets;
}

function isActive(p: RawProject): boolean {
  return !p.archived && !CLOSED_STAGES.has(p.stage);
}

function healthOf(p: RawProject): BudgetHealthItem {
  const b = deriveBudget(p.budgetPaise, {
    laborPaise: p.laborPaise,
    procurementPaise: p.procurementPaise,
  });
  return {
    projectId: p.id,
    name: p.name,
    code: p.code,
    usedPaise: b.usedPaise,
    budgetPaise: b.budgetPaise,
    utilizationPct: b.utilizationPct,
    overBudget: b.overBudget,
  };
}

/** Month key (YYYY-MM) of a YYYY-MM-DD date. */
function monthKey(dateISO: string): string {
  return dateISO.slice(0, 7);
}

/** Procurement widgets: spend, GST, outstanding, top vendors/projects/materials,
 *  pending payments, upcoming deliveries, recent POs, monthly trend. */
function assembleProcurement(raw: RawDashboardData): ProcurementWidget {
  const counted = raw.procurementPOs.filter((p) => poCountsForBudget(p.status, raw.approvalRequired));
  const spendPaise = counted.reduce((s, p) => s + p.totalPaise, 0);
  const gstPaidPaise = counted.reduce((s, p) => s + p.gstPaise, 0);

  // Outstanding per vendor = counted purchases − all payments to that vendor.
  const byVendor = new Map<string, { name: string; purchased: number; paid: number }>();
  const bump = (id: string, name: string) => {
    let v = byVendor.get(id);
    if (!v) byVendor.set(id, (v = { name, purchased: 0, paid: 0 }));
    return v;
  };
  counted.forEach((p) => (bump(p.vendorId, p.vendorName).purchased += p.totalPaise));
  raw.procurementPayments.forEach((p) => {
    const v = byVendor.get(p.vendorId);
    if (v) v.paid += p.amountPaise;
  });

  const topVendors: VendorRollupRow[] = [...byVendor.entries()]
    .map(([vendorId, v]) => ({ vendorId, name: v.name, amountPaise: v.purchased }))
    .filter((v) => v.amountPaise > 0)
    .sort((a, b) => b.amountPaise - a.amountPaise)
    .slice(0, 5);

  const outstandingVendors: VendorRollupRow[] = [...byVendor.entries()]
    .map(([vendorId, v]) => ({ vendorId, name: v.name, amountPaise: v.purchased - v.paid }))
    .filter((v) => v.amountPaise > 0)
    .sort((a, b) => b.amountPaise - a.amountPaise)
    .slice(0, 5);

  const outstandingPaise = [...byVendor.values()].reduce(
    (s, v) => s + Math.max(0, v.purchased - v.paid),
    0,
  );

  const paidByPO = new Map(raw.procurementPOs.map((p) => [p.id, p.paidPaise]));
  const pendingPaymentsCount = counted.filter((p) => p.totalPaise - (paidByPO.get(p.id) ?? 0) > 0).length;

  // Spend by project (counted grand totals).
  const byProject = new Map<string, ProjectSpendRow>();
  counted.forEach((p) => {
    const row = byProject.get(p.projectId) ?? { projectId: p.projectId, name: p.projectName, code: p.projectCode, amountPaise: 0 };
    row.amountPaise += p.totalPaise;
    byProject.set(p.projectId, row);
  });
  const spendByProject = [...byProject.values()].sort((a, b) => b.amountPaise - a.amountPaise).slice(0, 6);

  // Top materials purchased (taxable line amounts across counted POs).
  const byMaterial = new Map<string, MaterialSpendRow>();
  counted.forEach((p) =>
    p.lines.forEach((l) => {
      const key = l.material.toLowerCase();
      const row = byMaterial.get(key) ?? { material: l.material, category: l.category, amountPaise: 0 };
      row.amountPaise += l.amountPaise;
      byMaterial.set(key, row);
    }),
  );
  const topMaterials = [...byMaterial.values()].sort((a, b) => b.amountPaise - a.amountPaise).slice(0, 6);

  // Upcoming deliveries: counted POs with a future (or today) expected date.
  const upcomingDeliveries: UpcomingDelivery[] = counted
    .filter((p) => p.expectedDelivery && daysBetween(p.expectedDelivery, raw.today) >= 0)
    .map((p) => ({
      poId: p.id,
      poNumber: p.poNumber,
      vendorName: p.vendorName,
      projectName: p.projectName,
      expectedDelivery: p.expectedDelivery!,
      daysUntil: -daysBetween(raw.today, p.expectedDelivery!),
      totalPaise: p.totalPaise,
    }))
    .sort((a, b) => a.expectedDelivery.localeCompare(b.expectedDelivery))
    .slice(0, 5);
  const recentPOs: PurchaseOrderListItem[] = [...raw.procurementPOs]
    .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate))
    .slice(0, 6)
    .map((p) => ({
      id: p.id,
      poNumber: p.poNumber,
      status: p.status,
      purchaseDate: p.purchaseDate,
      expectedDelivery: null,
      subtotalPaise: p.totalPaise,
      gstPaise: 0,
      totalPaise: p.totalPaise,
      paidPaise: paidByPO.get(p.id) ?? 0,
      paymentStatus: poPaymentStatus(p.totalPaise, paidByPO.get(p.id) ?? 0),
      invoiceNumber: null,
      vendor: { id: p.vendorId, name: p.vendorName },
      project: { id: p.projectId, name: p.projectName, code: p.projectCode },
      createdAt: p.createdAt,
    }));

  // Monthly procurement trend — last 6 months ending at `today`.
  const months: string[] = [];
  const base = new Date(raw.today + "T00:00:00Z");
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1));
    months.push(d.toISOString().slice(0, 7));
  }
  const monthIndex = new Map(months.map((m) => [m, 0]));
  counted.forEach((p) => {
    const m = monthKey(p.purchaseDate);
    if (monthIndex.has(m)) monthIndex.set(m, monthIndex.get(m)! + p.totalPaise);
  });
  const monthlyTrend = months.map((m) => ({ month: m, procurementPaise: monthIndex.get(m) ?? 0 }));

  return {
    spendPaise,
    gstPaidPaise,
    outstandingPaise,
    pendingPaymentsCount,
    outstandingVendors,
    topVendors,
    spendByProject,
    topMaterials,
    upcomingDeliveries,
    recentPOs,
    monthlyTrend,
  };
}

/**
 * The single source of dashboard business logic. Pure — both the demo and the
 * server gather RawDashboardData their own way, then call this.
 */
export function assembleDashboard(raw: RawDashboardData): DashboardSnapshot {
  const { projects, today } = raw;
  const active = projects.filter(isActive);

  const deadlines: DeadlineItem[] = projects.flatMap((p) =>
    p.deadlines
      .filter((d) => !d.completedAt)
      .map((d) => {
        const daysLeft = -daysBetween(today, d.dueDate);
        return {
          id: d.id,
          projectId: p.id,
          projectName: p.name,
          title: d.title,
          dueDate: d.dueDate,
          overdue: daysLeft < 0,
          daysLeft,
        };
      }),
  );

  const upcomingDeadlines = deadlines
    .filter((d) => !d.overdue && d.daysLeft <= 14)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  const overdueProjects = active
    .filter((p) => p.expectedCompletionDate && daysBetween(today, p.expectedCompletionDate) > 0)
    .map((p) => ({
      projectId: p.id,
      name: p.name,
      daysOverdue: daysBetween(today, p.expectedCompletionDate!),
    }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue);

  const budgetHealth = active
    .map(healthOf)
    .sort((a, b) => b.utilizationPct - a.utilizationPct);

  const budgetWarnings = budgetHealth.filter((b) => b.overBudget || b.utilizationPct >= 90);

  const staleProjects = active
    .map((p) => ({
      projectId: p.id,
      name: p.name,
      daysSinceActivity: p.lastActivityAt
        ? daysBetween(today, p.lastActivityAt.slice(0, 10))
        : 999,
    }))
    .filter((s) => s.daysSinceActivity >= 14)
    .sort((a, b) => b.daysSinceActivity - a.daysSinceActivity);

  const budgetUsedPaise = active.reduce((s, p) => s + p.laborPaise + p.procurementPaise, 0);
  const budgetTotalPaise = active.reduce((s, p) => s + p.budgetPaise, 0);
  const costSplit = {
    laborPaise: active.reduce((s, p) => s + p.laborPaise, 0),
    procurementPaise: active.reduce((s, p) => s + p.procurementPaise, 0),
  };

  // Labour widget (Category → Subcategory): today's headcounts grouped by
  // category with subcategory breakdown, cost, 30-day man-days, daily trend.
  const todays = raw.labourEntries.filter((e) => e.date === today);
  const byCat = new Map<
    string,
    { name: string; color: string; quantity: number; subcategories: { name: string; quantity: number }[] }
  >();
  todays.forEach((e) => {
    const c = byCat.get(e.categoryName) ?? {
      name: e.categoryName,
      color: e.color,
      quantity: 0,
      subcategories: [],
    };
    c.quantity += e.quantityPresent;
    let sub = c.subcategories.find((s) => s.name === e.subcategoryName);
    if (!sub) {
      sub = { name: e.subcategoryName, quantity: 0 };
      c.subcategories.push(sub);
    }
    sub.quantity += e.quantityPresent;
    byCat.set(e.categoryName, c);
  });
  byCat.forEach((c) => c.subcategories.sort((a, b) => b.quantity - a.quantity));
  const byDay = new Map<string, number>();
  raw.labourEntries.forEach((e) => byDay.set(e.date, (byDay.get(e.date) ?? 0) + e.quantityPresent));
  const labour = {
    todayByCategory: [...byCat.values()].sort((a, b) => b.quantity - a.quantity),
    todayCostPaise: todays.reduce((s, e) => s + e.estimatedCostPaise, 0),
    manDays30: raw.labourEntries
      .filter((e) => daysBetween(today, e.date) <= 30)
      .reduce((s, e) => s + e.quantityPresent, 0),
    trend: [...byDay.entries()]
      .map(([date, total]) => ({ date, total }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-28),
  };

  return {
    isEmpty: projects.length === 0,
    kpis: {
      activeProjects: active.length,
      upcomingDeadlines: upcomingDeadlines.length + overdueProjects.length,
      overdue: overdueProjects.length,
      todaysLaborCount: todays.reduce((s, e) => s + e.quantityPresent, 0),
      todaysWagesPaise: todays.reduce((s, e) => s + e.estimatedCostPaise, 0),
      budgetUsedPaise,
      budgetTotalPaise,
      pendingApprovals: raw.pendingPOs.length,
    },
    spendTrend: bucketSpendByWeek(raw.spendEntries, today),
    costSplit,
    labour,
    procurement: assembleProcurement(raw),
    budgetHealth,
    attention: {
      overdueProjects,
      upcomingDeadlines,
      pendingPOs: raw.pendingPOs,
      budgetWarnings,
      staleProjects,
    },
    recentActivity: [...raw.activity]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 8),
  };
}
