import { describe, it, expect } from "vitest";
import {
  reportClass,
  reportViewPermission,
  canViewReport,
  canExportReport,
} from "./report-meta";
import type { Permission } from "@/features/rbac/permissions";

/** Build a `has(permission)` predicate from a granted set. */
const withPerms = (...granted: Permission[]) => {
  const set = new Set<string>(granted);
  return (p: Permission) => set.has(p);
};

describe("report classification", () => {
  it("budget-vs-actual is a financial report", () => {
    expect(reportClass("budget-vs-actual")).toBe("financial");
    expect(reportViewPermission("budget-vs-actual")).toBe("reports.view_financial");
  });
  it("other reports are operational", () => {
    for (const id of ["project-summary", "labour-cost", "procurement", "vendor-summary", "deadlines"]) {
      expect(reportClass(id)).toBe("operational");
      expect(reportViewPermission(id)).toBe("reports.view_operational");
    }
  });
});

describe("canViewReport — financial reports need the financial permission", () => {
  it("reports.view alone is not enough for any report", () => {
    const has = withPerms("reports.view");
    expect(canViewReport(has, "project-summary")).toBe(false);
    expect(canViewReport(has, "budget-vs-actual")).toBe(false);
  });

  it("operational view unlocks operational but NOT financial reports", () => {
    const has = withPerms("reports.view", "reports.view_operational");
    expect(canViewReport(has, "project-summary")).toBe(true);
    expect(canViewReport(has, "budget-vs-actual")).toBe(false);
  });

  it("financial view unlocks financial but NOT operational reports", () => {
    const has = withPerms("reports.view", "reports.view_financial");
    expect(canViewReport(has, "budget-vs-actual")).toBe(true);
    expect(canViewReport(has, "project-summary")).toBe(false);
  });

  it("reports.view_all unlocks every report", () => {
    const has = withPerms("reports.view", "reports.view_all");
    expect(canViewReport(has, "budget-vs-actual")).toBe(true);
    expect(canViewReport(has, "project-summary")).toBe(true);
  });
});

describe("canExportReport — viewing never implies exporting", () => {
  it("a viewer WITHOUT reports.export cannot export, even if they can view", () => {
    const has = withPerms("reports.view", "reports.view_operational");
    expect(canViewReport(has, "project-summary")).toBe(true);
    expect(canExportReport(has, "project-summary")).toBe(false);
  });

  it("export requires BOTH visibility and reports.export", () => {
    const has = withPerms("reports.view", "reports.view_operational", "reports.export");
    expect(canExportReport(has, "project-summary")).toBe(true);
    // still can't export a financial report — no financial visibility
    expect(canExportReport(has, "budget-vs-actual")).toBe(false);
  });
});
