import { describe, it, expect, beforeEach } from "vitest";
import { runReport } from "./registry";
import { buildExportRows } from "./export-model";
import { getPayments } from "@/features/payments/data";
import { paymentsVisibilityFor } from "@/features/payments/visibility";
import { ALL_PERMISSIONS, type Permission } from "@/features/rbac/permissions";
import { resolvePeriod } from "@/lib/period";
import type { SessionUser } from "@/lib/auth/types";
import type { ReportContext, ReportFilters } from "./types";

/**
 * Reports leak through TOTALS.
 *
 * A row can be hidden and the report still give the data away: a count, a sum,
 * a chart bar or an exported line is enough to infer what is on a project you
 * cannot open. So scoping has to happen where the data is READ, not after — and
 * these tests assert the read, not the render.
 */

const TODAY = "2026-08-20";
const OWNER_ID = "00000000-0000-0000-0000-000000000001";
/** A real session id that manages no project in the demo company. */
const OUTSIDER_ID = "99999999-9999-9999-9999-999999999999";

/**
 * A genuinely project-scoped user: every ordinary permission, but none of the
 * cross-project `*_all` grants.
 *
 * The distinction matters. A company-wide contractor advance carries no project
 * at all, so no project filter can contain it — it is admitted on
 * `contractors.view_all` alone, which is the contractor ledger's own rule.
 * Handing a "manages nothing" user that permission and then expecting to see
 * nothing would be testing a rule the domain does not have.
 */
const SCOPED_ONLY: Permission[] = ALL_PERMISSIONS.filter((p) => !p.endsWith("_all"));

function ctx(over: Partial<ReportContext> = {}): Omit<ReportContext, "period"> {
  return {
    today: TODAY,
    userId: OWNER_ID,
    isOwner: true,
    permissions: [...ALL_PERMISSIONS],
    ...over,
  };
}

const run = (id: string, f: ReportFilters = {}, c = ctx()) => runReport(id, f, c);

function user(permissions: Permission[], isOwner: boolean, id = OWNER_ID): SessionUser {
  return {
    id,
    email: "u@example.com",
    fullName: "U",
    role: isOwner ? "OWNER" : "PROJECT_MANAGER",
    permissions,
    company: { id: "co", name: "Co" },
  };
}

const AMOUNT = 8;

beforeEach(() => localStorage.clear());

describe("payments report scoping", () => {
  it("returns nothing to a caller who manages no project", async () => {
    const outsider = ctx({
      userId: OUTSIDER_ID,
      isOwner: false,
      permissions: SCOPED_ONLY,
    });
    const result = await run("payments", { period: "ALL_TIME" }, outsider);

    const data = result.rows.filter((r) => r.kind !== "total");
    expect(data).toHaveLength(0);
    expect(result.isEmpty).toBe(true);

    // And no total leaks a figure either — a "₹14,84,400" beside an empty table
    // would give away exactly what the empty table is hiding.
    const total = result.rows.find((r) => r.kind === "total");
    if (total) expect(Number(total.cells[AMOUNT])).toBe(0);
    for (const kpi of result.kpis) {
      expect(kpi.value, `KPI "${kpi.label}" leaked a figure`).toMatch(/^(₹0|0)$/);
    }
  });

  it("shows the owner strictly more than the outsider", async () => {
    const owner = await run("payments", { period: "ALL_TIME" });
    const outsider = await run(
      "payments",
      { period: "ALL_TIME" },
      ctx({ userId: OUTSIDER_ID, isOwner: false, permissions: SCOPED_ONLY }),
    );
    const rows = (r: typeof owner) => r.rows.filter((x) => x.kind !== "total").length;
    expect(rows(owner)).toBeGreaterThan(0);
    expect(rows(outsider)).toBe(0);
  });

  it("hides an instrument the caller's SOURCE module would hide", async () => {
    // No `contracts.view` → no agreement payments, decided by the Payments
    // module's own visibility rule rather than by anything Reports invents.
    const noContracts = ctx({
      permissions: ALL_PERMISSIONS.filter((p) => p !== "contracts.view"),
    });
    const result = await run("payments", { period: "ALL_TIME" }, noContracts);
    const types = result.rows
      .filter((r) => r.kind !== "total")
      .map((r) => String(r.cells[3]));
    expect(types).not.toContain("Contractor payment");
    // The instruments they may see are still there.
    expect(types.length).toBeGreaterThan(0);
  });

  it("hides the contractor ledger without contractors.view", async () => {
    const noLedger = ctx({
      permissions: ALL_PERMISSIONS.filter(
        (p) => p !== "contractors.view" && p !== "contractors.view_all",
      ),
    });
    const result = await run("payments", { period: "ALL_TIME" }, noLedger);
    const types = result.rows
      .filter((r) => r.kind !== "total")
      .map((r) => String(r.cells[3]));
    expect(types).not.toContain("Contractor advance");
    expect(types).not.toContain("Labour settlement");
  });

  it("keeps company-wide advances behind contractors.view_all", async () => {
    const withAll = await run("payments", { period: "ALL_TIME" });
    const withoutAll = await run(
      "payments",
      { period: "ALL_TIME" },
      ctx({ permissions: ALL_PERMISSIONS.filter((p) => p !== "contractors.view_all") }),
    );
    const generals = (r: typeof withAll) =>
      r.rows.filter((x) => x.kind !== "total" && String(x.cells[4]) === "No project").length;
    expect(generals(withAll)).toBeGreaterThan(0);
    expect(generals(withoutAll)).toBe(0);
  });

  it("agrees with what the Payments Centre would have shown the same caller", async () => {
    // The report must not widen its source module's answer by even one row.
    const permissions = ALL_PERMISSIONS.filter((p) => p !== "contracts.view");
    const c = ctx({ permissions });
    const period = resolvePeriod("ALL_TIME", TODAY);
    const snapshot = await getPayments({
      userId: c.userId,
      isOwner: c.isOwner,
      visibility: paymentsVisibilityFor(user(permissions, true)),
      from: period.from,
      to: period.to,
    });
    const result = await run("payments", { period: "ALL_TIME" }, c);
    expect(result.rows.filter((r) => r.kind !== "total")).toHaveLength(
      snapshot.transactions.length,
    );
  });
});

describe("an export cannot widen what the screen showed", () => {
  it("exports nothing for a caller whose report is empty", async () => {
    const outsider = ctx({
      userId: OUTSIDER_ID,
      isOwner: false,
      permissions: SCOPED_ONLY,
    });
    const result = await run("payments", { period: "ALL_TIME" }, outsider);
    const rows = buildExportRows(result, "Co");
    const headerIdx = rows.findIndex((r) => r[0] === result.columns[0].label);
    const noteLines = result.note ? 2 : 0;
    // Preamble + header + note only — not a single data line.
    expect(rows.length - headerIdx - 1 - noteLines).toBe(result.rows.length);
    expect(result.rows.filter((r) => r.kind !== "total")).toHaveLength(0);
  });

  it("carries exactly the scoped rows, never the unscoped ones", async () => {
    const owner = await run("payments", { period: "ALL_TIME" });
    const restricted = await run(
      "payments",
      { period: "ALL_TIME" },
      ctx({ permissions: ALL_PERMISSIONS.filter((p) => p !== "contracts.view") }),
    );
    expect(buildExportRows(restricted, "Co").length).toBeLessThan(
      buildExportRows(owner, "Co").length,
    );
  });
});

describe("project-scoped reads happen before assembly", () => {
  it("labour, procurement and project reports honour a project filter", async () => {
    for (const id of ["labour-cost", "procurement", "project-summary", "budget-vs-actual"]) {
      const all = await run(id, { period: "ALL_TIME" });
      const scoped = await run(id, {
        period: "ALL_TIME",
        projectId: "10000000-0000-0000-0000-000000000002",
      });
      const count = (r: typeof all) => r.rows.filter((x) => x.kind !== "total").length;
      expect(count(scoped), `${id} ignored its project filter`).toBeLessThanOrEqual(count(all));
    }
  });

  it("echoes the scope into the export so a file states what it covers", async () => {
    const result = await run("payments", {
      period: "ALL_TIME",
      projectId: "10000000-0000-0000-0000-000000000001",
    });
    expect(result.activeFilters.some((f) => f.label === "Project")).toBe(true);
    const flat = buildExportRows(result, "Co").map((r) => r.join("|"));
    expect(flat.some((l) => l.startsWith("Project|"))).toBe(true);
  });
});
