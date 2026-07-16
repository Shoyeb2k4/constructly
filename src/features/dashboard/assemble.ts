import { deriveBudget } from "@/features/budget/calc";
import type {
  BudgetHealthItem,
  DashboardSnapshot,
  DeadlineItem,
  RawDashboardData,
  RawProject,
  SpendWeek,
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

  // Labour widget (category-based): today's headcounts, 30-day man-days, trend.
  const todays = raw.labourEntries.filter((e) => e.date === today);
  const byCat = new Map<string, { name: string; color: string; quantity: number }>();
  todays.forEach((e) => {
    const c = byCat.get(e.categoryName) ?? { name: e.categoryName, color: e.color, quantity: 0 };
    c.quantity += e.quantityPresent;
    byCat.set(e.categoryName, c);
  });
  const byDay = new Map<string, number>();
  raw.labourEntries.forEach((e) => byDay.set(e.date, (byDay.get(e.date) ?? 0) + e.quantityPresent));
  const labour = {
    todayByCategory: [...byCat.values()].sort((a, b) => b.quantity - a.quantity),
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
      todaysWagesPaise: todays.reduce((s, e) => s + (e.ratePaise ?? 0) * e.quantityPresent, 0),
      budgetUsedPaise,
      budgetTotalPaise,
      pendingApprovals: raw.pendingPOs.length,
    },
    spendTrend: bucketSpendByWeek(raw.spendEntries, today),
    costSplit,
    labour,
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
