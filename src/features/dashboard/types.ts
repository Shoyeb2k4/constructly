import type { PurchaseOrderListItem } from "@/features/procurement/types";
import type { MaterialIdentityRef } from "@/features/procurement/material-identity";

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

/** One subcategory-attendance record in scope (Category → Subcategory,
 *  ADR-0023). Cost is the stored snapshot estimate (ADR-0022). */
export interface RawLabourEntry {
  date: string; // YYYY-MM-DD
  categoryName: string;
  subcategoryName: string;
  color: string;
  quantityPresent: number;
  estimatedCostPaise: number;
}

/** One material line on a counted PO, for material-spend rollups. */
export interface RawProcurementLine {
  /** Frozen PO snapshot — the label of an UNLINKED line's bucket only. */
  material: string;
  /** Identity. Null/absent = unlinked (legacy, older app, or hard-deleted
   *  Material): grouped by `legacy:<normalized snapshot>`. */
  materialId?: string | null;
  category: string | null;
  amountPaise: number; // taxable (ex-GST)
}

/** One counted purchase order, flattened for procurement widgets. */
export interface RawProcurementPO {
  id: string;
  poNumber: string;
  vendorId: string;
  vendorName: string;
  projectId: string;
  projectName: string;
  projectCode: string;
  status: "DRAFT" | "SUBMITTED" | "APPROVED";
  purchaseDate: string;
  expectedDelivery: string | null;
  gstPaise: number;
  totalPaise: number;
  paidPaise: number;
  createdAt: string;
  lines: RawProcurementLine[];
}

export interface RawProcurementPayment {
  vendorId: string;
  amountPaise: number;
}

export interface RawDashboardData {
  projects: RawProject[];
  spendEntries: RawSpendEntry[];
  labourEntries: RawLabourEntry[];
  pendingPOs: PurchaseOrderListItem[];
  procurementPOs: RawProcurementPO[];
  /** The company's Material Master, archived included — labels canonical
   *  material buckets by their CURRENT name. Loaded once, not per line. */
  procurementMaterials?: MaterialIdentityRef[];
  procurementPayments: RawProcurementPayment[];
  approvalRequired: boolean;
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
  todayByCategory: {
    name: string;
    color: string;
    quantity: number;
    subcategories: { name: string; quantity: number }[];
  }[];
  todayCostPaise: number;
  manDays30: number;
  trend: { date: string; total: number }[];
}

export interface VendorRollupRow {
  vendorId: string;
  name: string;
  amountPaise: number;
}

export interface MaterialSpendRow {
  /** Bucket identity: the materialId, or `legacy:<normalized snapshot>`. */
  key: string;
  materialId: string | null;
  /** Display label: the Material's current name, or the unlinked snapshot. */
  material: string;
  /** False = unlinked recorded name (not yet tied to a Material). */
  linked: boolean;
  archived: boolean;
  category: string | null;
  amountPaise: number;
}

export interface ProjectSpendRow {
  projectId: string;
  name: string;
  code: string;
  amountPaise: number;
}

export interface UpcomingDelivery {
  poId: string;
  poNumber: string;
  vendorName: string;
  projectName: string;
  expectedDelivery: string;
  daysUntil: number;
  totalPaise: number;
}

export interface ProcurementWidget {
  spendPaise: number;
  /** GST paid across counted POs (period-agnostic; matches spend scope). */
  gstPaidPaise: number;
  outstandingPaise: number;
  /** Count of POs with any outstanding balance (pending payments). */
  pendingPaymentsCount: number;
  outstandingVendors: VendorRollupRow[];
  topVendors: VendorRollupRow[];
  spendByProject: ProjectSpendRow[];
  topMaterials: MaterialSpendRow[];
  upcomingDeliveries: UpcomingDelivery[];
  recentPOs: PurchaseOrderListItem[];
  monthlyTrend: { month: string; procurementPaise: number }[];
}

export interface DashboardSnapshot {
  isEmpty: boolean;
  kpis: DashboardKpis;
  spendTrend: SpendWeek[];
  costSplit: { laborPaise: number; procurementPaise: number };
  labour: LabourWidget;
  procurement: ProcurementWidget;
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
