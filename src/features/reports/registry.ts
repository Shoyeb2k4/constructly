import { projectsApi } from "@/features/projects/data";
import { laborApi } from "@/features/labor/data";
import { procurementApi } from "@/features/procurement/data";
import { STAGE_LABEL, TYPE_LABEL } from "@/features/projects/constants";
import { PO_STATUS_LABEL, PO_PAYMENT_STATUS_LABEL } from "@/features/procurement/constants";
import { formatPaiseCompact } from "@/lib/money";
import type { ReportDef, ReportFilters, ReportResult, ReportRow } from "./types";

const now = () => new Date().toISOString();

function rangeLabel(f: ReportFilters): string {
  if (f.dateFrom && f.dateTo) return `${f.dateFrom} → ${f.dateTo}`;
  if (f.dateFrom) return `from ${f.dateFrom}`;
  if (f.dateTo) return `until ${f.dateTo}`;
  return "all time";
}

/* ── Project summary ─────────────────────────────────────────────────── */

const projectSummary: ReportDef = {
  id: "project-summary",
  name: "Project summary",
  description: "Every project with budget, spend, remaining, and utilization.",
  category: "Project",
  filters: ["project"],
  async run(f): Promise<ReportResult> {
    const projects = await projectsApi.list({ includeArchived: true });
    const scoped = f.projectId ? projects.filter((p) => p.id === f.projectId) : projects;
    const rows: ReportRow[] = scoped.map((p) => ({
      href: `/projects/${p.id}`,
      cells: [
        p.code,
        p.name,
        TYPE_LABEL[p.type],
        STAGE_LABEL[p.stage],
        p.budgetPaise,
        p.usedPaise,
        p.budgetPaise - p.usedPaise,
        p.budgetPaise > 0 ? `${Math.round((p.usedPaise / p.budgetPaise) * 100)}%` : "—",
      ],
    }));
    const totalBudget = scoped.reduce((s, p) => s + p.budgetPaise, 0);
    const totalUsed = scoped.reduce((s, p) => s + p.usedPaise, 0);
    rows.push({
      kind: "total",
      cells: ["", "Total", "", "", totalBudget, totalUsed, totalBudget - totalUsed, ""],
    });
    return {
      id: this.id,
      title: "Project summary",
      subtitle: `${scoped.length} project${scoped.length === 1 ? "" : "s"}`,
      generatedAt: now(),
      kpis: [
        { label: "Projects", value: String(scoped.length) },
        { label: "Total budget", value: formatPaiseCompact(totalBudget) },
        { label: "Total used", value: formatPaiseCompact(totalUsed) },
      ],
      columns: [
        { key: "code", label: "Code" },
        { key: "name", label: "Project" },
        { key: "type", label: "Type" },
        { key: "stage", label: "Stage" },
        { key: "budget", label: "Budget", kind: "money" },
        { key: "used", label: "Used", kind: "money" },
        { key: "remaining", label: "Remaining", kind: "money" },
        { key: "util", label: "Utilization", align: "right" },
      ],
      rows,
      isEmpty: scoped.length === 0,
    };
  },
};

/* ── Budget vs Actual (flagship) ─────────────────────────────────────── */

const budgetVsActual: ReportDef = {
  id: "budget-vs-actual",
  name: "Budget vs Actual",
  description: "Per project: budget against actual labour + procurement spend.",
  category: "Financial",
  filters: ["project"],
  featured: true,
  async run(f): Promise<ReportResult> {
    // usedPaise on the project list comes from the SAME shared budget source
    // (ADR-0018) the Overview + dashboard use; labour split from the labour
    // summary → procurement = used − labour. Exactly matches those views.
    const [projects, labour] = await Promise.all([
      projectsApi.list({ includeArchived: true }),
      laborApi.summary({}),
    ]);
    const laborByProject = new Map(labour.byProject.map((p) => [p.projectId, p.estimatedCostPaise]));
    const scoped = f.projectId ? projects.filter((p) => p.id === f.projectId) : projects;
    const rows: ReportRow[] = scoped.map((p) => {
      const labor = laborByProject.get(p.id) ?? 0;
      const procurement = p.usedPaise - labor;
      return {
        href: `/projects/${p.id}`,
        cells: [
          p.code,
          p.name,
          p.budgetPaise,
          labor,
          procurement,
          p.usedPaise,
          p.budgetPaise - p.usedPaise,
          p.budgetPaise > 0 ? `${Math.round((p.usedPaise / p.budgetPaise) * 100)}%` : "—",
        ],
      };
    });
    const t = scoped.reduce(
      (a, p) => {
        const labor = laborByProject.get(p.id) ?? 0;
        a.budget += p.budgetPaise;
        a.labor += labor;
        a.proc += p.usedPaise - labor;
        a.used += p.usedPaise;
        return a;
      },
      { budget: 0, labor: 0, proc: 0, used: 0 },
    );
    rows.push({
      kind: "total",
      cells: ["", "Total", t.budget, t.labor, t.proc, t.used, t.budget - t.used, ""],
    });
    return {
      id: this.id,
      title: "Budget vs Actual",
      subtitle: `${scoped.length} project${scoped.length === 1 ? "" : "s"}`,
      generatedAt: now(),
      kpis: [
        { label: "Total budget", value: formatPaiseCompact(t.budget) },
        { label: "Labour", value: formatPaiseCompact(t.labor) },
        { label: "Procurement", value: formatPaiseCompact(t.proc) },
        { label: "Remaining", value: formatPaiseCompact(t.budget - t.used) },
      ],
      columns: [
        { key: "code", label: "Code" },
        { key: "name", label: "Project" },
        { key: "budget", label: "Budget", kind: "money" },
        { key: "labor", label: "Labour", kind: "money" },
        { key: "proc", label: "Procurement", kind: "money" },
        { key: "used", label: "Used", kind: "money" },
        { key: "remaining", label: "Remaining", kind: "money" },
        { key: "util", label: "Utilization", align: "right" },
      ],
      rows,
      isEmpty: scoped.length === 0,
    };
  },
};

/* ── Labour cost ─────────────────────────────────────────────────────── */

const labourCost: ReportDef = {
  id: "labour-cost",
  name: "Labour cost",
  description: "Man-days and estimated cost by category → subcategory.",
  category: "Labour",
  filters: ["project", "dateRange"],
  async run(f): Promise<ReportResult> {
    const summary = await laborApi.summary({
      projectId: f.projectId || "ALL",
      from: f.dateFrom,
      to: f.dateTo,
    });
    const rows: ReportRow[] = [];
    for (const c of summary.byCategory) {
      rows.push({ kind: "group", cells: [c.name, "", ""] });
      for (const s of c.subcategories) {
        rows.push({ cells: [`   ${s.name}`, s.manDays, s.estimatedCostPaise] });
      }
      rows.push({ kind: "total", cells: [`${c.name} total`, c.manDays, c.estimatedCostPaise] });
    }
    rows.push({ kind: "total", cells: ["Grand total", summary.totalManDays, summary.estimatedCostPaise] });
    return {
      id: this.id,
      title: "Labour cost report",
      subtitle: rangeLabel(f),
      generatedAt: now(),
      kpis: [
        { label: "Man-days", value: String(summary.totalManDays) },
        { label: "Est. cost", value: formatPaiseCompact(summary.estimatedCostPaise) },
      ],
      columns: [
        { key: "name", label: "Category / Subcategory" },
        { key: "manDays", label: "Man-days", kind: "number" },
        { key: "cost", label: "Est. cost", kind: "money" },
      ],
      rows,
      isEmpty: summary.totalManDays === 0,
    };
  },
};

/* ── Procurement (purchase orders) ───────────────────────────────────── */

const procurement: ReportDef = {
  id: "procurement",
  name: "Procurement report",
  description: "Purchase orders with GST, totals, and payment status.",
  category: "Procurement",
  filters: ["project", "vendor", "dateRange"],
  async run(f): Promise<ReportResult> {
    const pos = await procurementApi.listPurchaseOrders({
      projectId: f.projectId || "ALL",
      vendorId: f.vendorId || "ALL",
      dateFrom: f.dateFrom,
      dateTo: f.dateTo,
    });
    const rows: ReportRow[] = pos.map((p) => ({
      href: `/procurement/${p.id}`,
      cells: [
        p.poNumber,
        p.vendor.name,
        p.project.name,
        p.purchaseDate,
        PO_STATUS_LABEL[p.status],
        p.subtotalPaise,
        p.gstPaise,
        p.totalPaise,
        PO_PAYMENT_STATUS_LABEL[p.paymentStatus],
      ],
    }));
    const sub = pos.reduce((s, p) => s + p.subtotalPaise, 0);
    const gst = pos.reduce((s, p) => s + p.gstPaise, 0);
    const total = pos.reduce((s, p) => s + p.totalPaise, 0);
    rows.push({ kind: "total", cells: ["", "", "", "", "Total", sub, gst, total, ""] });
    return {
      id: this.id,
      title: "Procurement report",
      subtitle: rangeLabel(f),
      generatedAt: now(),
      kpis: [
        { label: "Purchase orders", value: String(pos.length) },
        { label: "Subtotal", value: formatPaiseCompact(sub) },
        { label: "GST", value: formatPaiseCompact(gst) },
        { label: "Total", value: formatPaiseCompact(total) },
      ],
      columns: [
        { key: "po", label: "PO" },
        { key: "vendor", label: "Vendor" },
        { key: "project", label: "Project" },
        { key: "date", label: "Date", kind: "date" },
        { key: "status", label: "Status" },
        { key: "subtotal", label: "Subtotal", kind: "money" },
        { key: "gst", label: "GST", kind: "money" },
        { key: "total", label: "Total", kind: "money" },
        { key: "payment", label: "Payment" },
      ],
      rows,
      isEmpty: pos.length === 0,
    };
  },
};

/* ── Vendor report ───────────────────────────────────────────────────── */

const vendorReport: ReportDef = {
  id: "vendor-summary",
  name: "Vendor report",
  description: "Lifetime purchases, outstanding, and reach across projects.",
  category: "Vendor",
  filters: ["vendor"],
  async run(f): Promise<ReportResult> {
    const vendors = await procurementApi.listVendors();
    const scoped = f.vendorId ? vendors.filter((v) => v.id === f.vendorId) : vendors;
    const rows: ReportRow[] = scoped
      .slice()
      .sort((a, b) => b.totalPurchasedPaise - a.totalPurchasedPaise)
      .map((v) => ({
        href: `/vendors/${v.id}`,
        cells: [
          v.businessName,
          v.status === "ACTIVE" ? "Active" : "Inactive",
          v.poCount,
          v.projectsServed,
          v.totalPurchasedPaise,
          Math.max(0, v.outstandingPaise),
        ],
      }));
    const purchased = scoped.reduce((s, v) => s + v.totalPurchasedPaise, 0);
    const outstanding = scoped.reduce((s, v) => s + Math.max(0, v.outstandingPaise), 0);
    rows.push({ kind: "total", cells: ["Total", "", "", "", purchased, outstanding] });
    return {
      id: this.id,
      title: "Vendor report",
      subtitle: `${scoped.length} vendor${scoped.length === 1 ? "" : "s"}`,
      generatedAt: now(),
      kpis: [
        { label: "Vendors", value: String(scoped.length) },
        { label: "Purchased", value: formatPaiseCompact(purchased) },
        { label: "Outstanding", value: formatPaiseCompact(outstanding) },
      ],
      columns: [
        { key: "vendor", label: "Vendor" },
        { key: "status", label: "Status" },
        { key: "pos", label: "POs", kind: "number" },
        { key: "projects", label: "Projects", kind: "number" },
        { key: "purchased", label: "Total purchased", kind: "money" },
        { key: "outstanding", label: "Outstanding", kind: "money" },
      ],
      rows,
      isEmpty: scoped.length === 0,
    };
  },
};

/* ── Deadline report ─────────────────────────────────────────────────── */

const deadlineReport: ReportDef = {
  id: "deadlines",
  name: "Deadline report",
  description: "Every open deadline with due date and overdue status.",
  category: "Project",
  filters: ["project"],
  async run(f): Promise<ReportResult> {
    const projects = await projectsApi.list({ includeArchived: false });
    const scoped = f.projectId ? projects.filter((p) => p.id === f.projectId) : projects;
    const details = await Promise.all(scoped.map((p) => projectsApi.get(p.id)));
    const today = new Date().toISOString().slice(0, 10);
    const dayMs = 86_400_000;
    const daysLeft = (due: string) =>
      Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / dayMs);

    const items = details
      .filter((d): d is NonNullable<typeof d> => !!d)
      .flatMap((d) =>
        d.deadlines
          .filter((dl) => !dl.completedAt)
          .map((dl) => ({ project: d.name, projectId: d.id, title: dl.title, dueDate: dl.dueDate, left: daysLeft(dl.dueDate) })),
      )
      .sort((a, b) => a.left - b.left);

    const rows: ReportRow[] = items.map((i) => ({
      href: `/projects/${i.projectId}?tab=deadlines`,
      cells: [
        i.project,
        i.title,
        i.dueDate,
        i.left < 0 ? "Overdue" : i.left === 0 ? "Due today" : "Upcoming",
        i.left < 0 ? `${-i.left}d late` : `${i.left}d`,
      ],
    }));
    const overdue = items.filter((i) => i.left < 0).length;
    return {
      id: this.id,
      title: "Deadline report",
      subtitle: `${items.length} open deadline${items.length === 1 ? "" : "s"}`,
      generatedAt: now(),
      kpis: [
        { label: "Open", value: String(items.length) },
        { label: "Overdue", value: String(overdue) },
      ],
      columns: [
        { key: "project", label: "Project" },
        { key: "title", label: "Deadline" },
        { key: "due", label: "Due date", kind: "date" },
        { key: "status", label: "Status" },
        { key: "left", label: "Time left", align: "right" },
      ],
      rows,
      isEmpty: items.length === 0,
    };
  },
};

export const REPORTS: ReportDef[] = [
  budgetVsActual,
  projectSummary,
  labourCost,
  procurement,
  vendorReport,
  deadlineReport,
];

export function getReport(id: string): ReportDef | undefined {
  return REPORTS.find((r) => r.id === id);
}
