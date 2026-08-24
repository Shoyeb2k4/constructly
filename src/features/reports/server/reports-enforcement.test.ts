import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { Permission } from "@/features/rbac/permissions";

const h = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/lib/auth/current-user", () => ({
  requireUser: async () => {
    if (!h.user) throw new Error("UNAUTHENTICATED");
    return h.user;
  },
}));

import { authorizeReportView, authorizeReportExport } from "./actions";

function u(permissions: Permission[]): SessionUser {
  return { id: "u1", email: "u@x.com", fullName: "U", role: "PROJECT_MANAGER", permissions, company: { id: "c1", name: "Co" } };
}

beforeEach(() => {
  h.user = null;
});

describe("authorizeReportView", () => {
  it("blocks a financial report without reports.view_financial", async () => {
    h.user = u(["reports.view", "reports.view_operational"]);
    await expect(authorizeReportView("budget-vs-actual")).rejects.toThrow("FORBIDDEN");
  });

  it("allows an operational report with operational view", async () => {
    h.user = u(["reports.view", "reports.view_operational"]);
    await expect(authorizeReportView("project-summary")).resolves.toBeUndefined();
  });

  it("allows a financial report with financial view", async () => {
    h.user = u(["reports.view", "reports.view_financial"]);
    await expect(authorizeReportView("budget-vs-actual")).resolves.toBeUndefined();
  });
});

/**
 * The export gate now RETURNS its decision rather than throwing it.
 *
 * That is a reporting change, not a policy change, and these tests are written
 * to prove exactly that: the same permission combinations are allowed and
 * refused as before. What is new is that a refusal names WHICH gate refused, so
 * the caller can no longer report every failure as "you lack permission" — the
 * bug that told an Owner holding all 97 permissions that they had none.
 */
describe("authorizeReportExport — view != export", () => {
  it("refuses export when the user can view but lacks reports.export", async () => {
    h.user = u(["reports.view", "reports.view_operational"]);
    await expect(authorizeReportExport("project-summary")).resolves.toEqual({
      allowed: false,
      reason: "CANNOT_EXPORT",
    });
  });

  it("allows export only with both visibility and reports.export", async () => {
    h.user = u(["reports.view", "reports.view_operational", "reports.export"]);
    await expect(authorizeReportExport("project-summary")).resolves.toEqual({ allowed: true });
    // financial report still blocked — no financial visibility
    await expect(authorizeReportExport("budget-vs-actual")).resolves.toEqual({
      allowed: false,
      reason: "CANNOT_VIEW",
    });
  });

  it("refuses export outright without reports.view", async () => {
    h.user = u(["reports.export"]);
    await expect(authorizeReportExport("project-summary")).resolves.toEqual({
      allowed: false,
      reason: "CANNOT_VIEW",
    });
  });

  it("still THROWS when there is no session — that is not a denial", async () => {
    // The distinction the UI depends on: "signed out" must not be reported as
    // "you don't have permission".
    h.user = null;
    await expect(authorizeReportExport("project-summary")).rejects.toThrow("UNAUTHENTICATED");
  });

  it("allows every report for a holder of reports.view_all", async () => {
    // The production Owner's shape: view_all plus export. This is the case that
    // was being denied in the UI while the server would have allowed it.
    h.user = u(["reports.view", "reports.view_all", "reports.export"]);
    for (const id of ["project-summary", "budget-vs-actual", "cash-movement"]) {
      await expect(authorizeReportExport(id), id).resolves.toEqual({ allowed: true });
    }
  });

  it("never returns allowed for a user holding nothing", async () => {
    h.user = u([]);
    const decision = await authorizeReportExport("project-summary");
    expect(decision.allowed).toBe(false);
  });
});
