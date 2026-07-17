import type { PurchaseOrderListItem } from "@/features/procurement/types";

/** Raw inputs gathered by demo/server, then assembled by the pure
 *  assembleDashboard() — the single business-logic source (no duplication). */

export interface RawProject {
  id: string;
  name: string;
  code: string;
  stage: string;
  archived: boolean;
  budgetPaise: number;
  laborPaise: number;
  procurementPaise: number;
  expectedCompletionDate: string | null;
  deadlines: { id: string; title: string; dueDate: string; completedAt: string | null }[];
  lastActivityAt: string | null;
}

export interface RawSpendEntry {
  date: string; // YYYY-MM-DD
  laborPaise: number;
  procurementPaise: number;
}

export type ActivityKind = "project" | "attendance" | "purchase_order" | "vendor";

export interface DashActivity {
  id: string;
  summary: string;
  actorName: string | null;
  createdAt: string;
  href: string;
  kind: ActivityKind;
}

/** One category-attendance record in scope. Cost is the stored snapshot
 *  estimate (rate-at-record-time × headcount, ADR-0022). */
export interface RawLabourEntry {
  date: string; // YYYY-MM-DD
  categoryName: string;
  color: string;
  quantityPresent: number;
  estimatedCostPaise: number;
}

export interface RawDashboardData {
  projects: RawProject[];
  spendEntries: RawSpendEntry[];
  labourEntries: RawLabourEntry[];
  pendingPOs: PurchaseOrderListItem[];
  activity: DashActivity[];
  today: string; // YYYY-MM-DD (IST)
}

/* ── Assembled snapshot (what widgets consume) ───────────────────────── */

export interface DashboardKpis {
  activeProjects: number;
  upcomingDeadlines: number;
  overdue: number;
  todaysLaborCount: number;
  todaysWagesPaise: number;
  budgetUsedPaise: number;
  budgetTotalPaise: number;
  pendingApprovals: number;
}

export interface SpendWeek {
  weekStart: string; // YYYY-MM-DD (Monday)
  laborPaise: number;
  procurementPaise: number;
}

export interface BudgetHealthItem {
  projectId: string;
  name: string;
  code: string;
  usedPaise: number;
  budgetPaise: number;
  utilizationPct: number;
  overBudget: boolean;
}

export interface DeadlineItem {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  dueDate: string;
  overdue: boolean;
  daysLeft: number;
}

export interface StaleProject {
  projectId: string;
  name: string;
  daysSinceActivity: number;
}

export interface LabourWidget {
  todayByCategory: { name: string; color: string; quantity: number }[];
  manDays30: number;
  trend: { date: string; total: number }[];
}

export interface DashboardSnapshot {
  isEmpty: boolean;
  kpis: DashboardKpis;
  spendTrend: SpendWeek[];
  costSplit: { laborPaise: number; procurementPaise: number };
  labour: LabourWidget;
  budgetHealth: BudgetHealthItem[];
  attention: {
    overdueProjects: { projectId: string; name: string; daysOverdue: number }[];
    upcomingDeadlines: DeadlineItem[];
    pendingPOs: PurchaseOrderListItem[];
    budgetWarnings: BudgetHealthItem[];
    staleProjects: StaleProject[];
  };
  recentActivity: DashActivity[];
}
