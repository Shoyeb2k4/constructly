import { projectsApi } from "@/features/projects/data";
import { budgetApi } from "@/features/budget/data";
import { deriveBudget } from "@/features/budget/calc";
import { STAGE_LABEL, TYPE_LABEL } from "@/features/projects/constants";
import type { ReportDef, ReportResult, ReportRow } from "../types";
import { countKpi, echoFilters, moneyKpi, now, plural } from "./shared";

/**
 * Project reports.
 *
 * Budget is a PROJECT concept and is reported as one. There is deliberately no
 * "project liability" or "project due" here: neither exists in the domain, and
 * a report is the easiest place in the app to invent a number that sounds
 * official and means nothing.
 */

/* ── Budget vs Actual (flagship) ─────────────────────────────────────── */

const budgetVsActual: ReportDef = {
  id: "budget-vs-actual",
  name: "Budget vs Actual",
  question: "Where is each project against its budget, and what has the money gone on?",
  category: "Projects",
  filters: ["project"],
  featured: true,
  async run(f): Promise<ReportResult> {
    // The canonical split, straight from the shared budget source (ADR-0018) —
    // the same figures the project Overview and the dashboard read. This used
    // to derive procurement as `used − labour`, which happened to agree only
    // because the labour summary it subtracted was unfiltered; the canonical
    // source gives both halves directly and cannot drift.
    const [projects, spend] = await Promise.all([
      projectsApi.list({ includeArchived: true }),
      budgetApi.spendByProject(),
    ]);
    const scoped = f.projectId ? projects.filter((p) => p.id === f.projectId) : projects;

    const budgets = scoped.map((p) => ({
      project: p,
      budget: deriveBudget(p.budgetPaise, spend[p.id] ?? { laborPaise: 0, procurementPaise: 0 }),
    }));

    const rows: ReportRow[] = budgets.map(({ project: p, budget: b }) => ({
      href: `/projects/${p.id}`,
      cells: [
        p.code,
        p.name,
        b.budgetPaise,
        b.laborPaise,
        b.procurementPaise,
        b.usedPaise,
        b.remainingPaise,
        p.budgetPaise > 0 ? `${b.utilizationPct}%` : "—",
      ],
    }));

    const t = budgets.reduce(
      (a, { budget: b }) => {
        a.budget += b.budgetPaise;
        a.labor += b.laborPaise;
        a.proc += b.procurementPaise;
        a.used += b.usedPaise;
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
      subtitle: plural(scoped.length, "project"),
      generatedAt: now(),
      // Budget and spend are LIFETIME concepts — a project's budget is not a
      // monthly figure — so this report takes no period and says so.
      periodLabel: "Project lifetime",
      activeFilters: echoFilters(f, { project: new Map(projects.map((p) => [p.id, p.name])) }),
      kpis: [
        moneyKpi("Total budget", t.budget),
        moneyKpi("Attendance value", t.labor, "Labour recorded against these projects"),
        moneyKpi("Ordered value", t.proc, "Purchase orders counting toward budget"),
        moneyKpi("Remaining", t.budget - t.used),
      ],
      columns: [
        { key: "code", label: "Code", hideBelow: "lg" },
        { key: "name", label: "Project" },
        { key: "budget", label: "Budget", kind: "money" },
        { key: "labor", label: "Attendance value", kind: "money", hideBelow: "xl" },
        { key: "proc", label: "Ordered value", kind: "money", hideBelow: "xl" },
        { key: "used", label: "Budget used", kind: "money" },
        { key: "remaining", label: "Remaining", kind: "money", hideBelow: "lg" },
        { key: "util", label: "Utilisation", align: "right" },
      ],
      rows,
      note: "Budget used counts labour recorded and purchase orders, per the company's approval setting. It is not a statement of what has been paid — see the Payments report for cash.",
      isEmpty: scoped.length === 0,
      hasAnyData: projects.length > 0,
    };
  },
};

/* ── Project summary ─────────────────────────────────────────────────── */

const projectSummary: ReportDef = {
  id: "project-summary",
  name: "Project summary",
  question: "What is every project's stage, budget and utilisation right now?",
  category: "Projects",
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
      subtitle: plural(scoped.length, "project"),
      generatedAt: now(),
      periodLabel: "Project lifetime",
      activeFilters: echoFilters(f, { project: new Map(projects.map((p) => [p.id, p.name])) }),
      kpis: [
        countKpi("Projects", scoped.length),
        moneyKpi("Total budget", totalBudget),
        moneyKpi("Budget used", totalUsed),
      ],
      columns: [
        { key: "code", label: "Code", hideBelow: "lg" },
        { key: "name", label: "Project" },
        { key: "type", label: "Type", hideBelow: "xl" },
        { key: "stage", label: "Stage" },
        { key: "budget", label: "Budget", kind: "money" },
        { key: "used", label: "Budget used", kind: "money" },
        { key: "remaining", label: "Remaining", kind: "money", hideBelow: "lg" },
        { key: "util", label: "Utilisation", align: "right" },
      ],
      rows,
      isEmpty: scoped.length === 0,
      hasAnyData: projects.length > 0,
    };
  },
};

/* ── Deadlines ───────────────────────────────────────────────────────── */

const deadlineReport: ReportDef = {
  id: "deadlines",
  name: "Deadlines",
  question: "Which project deadlines are overdue or coming up?",
  category: "Projects",
  filters: ["project"],
  async run(f, ctx): Promise<ReportResult> {
    const projects = await projectsApi.list({ includeArchived: false });
    const scoped = f.projectId ? projects.filter((p) => p.id === f.projectId) : projects;
    // One detail read per ACTIVE project. There is no bulk deadline query in the
    // projects repository, and adding one is that module's API work, not a
    // report's — the cost is bounded by the active project count and measured
    // in the phase report, with the exact fix named.
    const details = await Promise.all(scoped.map((p) => projectsApi.get(p.id)));
    const dayMs = 86_400_000;
    const daysLeft = (due: string) =>
      Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${ctx.today}T00:00:00Z`)) / dayMs);

    const items = details
      .filter((d): d is NonNullable<typeof d> => !!d)
      .flatMap((d) =>
        d.deadlines
          .filter((dl) => !dl.completedAt)
          .map((dl) => ({
            project: d.name,
            projectId: d.id,
            title: dl.title,
            dueDate: dl.dueDate,
            left: daysLeft(dl.dueDate),
          })),
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
      title: "Deadlines",
      subtitle: plural(items.length, "open deadline"),
      generatedAt: now(),
      periodLabel: `Open as at ${ctx.today}`,
      activeFilters: echoFilters(f, { project: new Map(projects.map((p) => [p.id, p.name])) }),
      kpis: [
        countKpi("Open", items.length),
        countKpi("Overdue", overdue, overdue > 0 ? "Past their due date" : "Nothing is late"),
      ],
      columns: [
        { key: "project", label: "Project" },
        { key: "title", label: "Deadline" },
        { key: "due", label: "Due date", kind: "date" },
        { key: "status", label: "Status" },
        { key: "left", label: "Time left", align: "right", hideBelow: "md" },
      ],
      rows,
      isEmpty: items.length === 0,
      hasAnyData: projects.length > 0,
    };
  },
};

export const PROJECT_REPORTS: ReportDef[] = [budgetVsActual, projectSummary, deadlineReport];
