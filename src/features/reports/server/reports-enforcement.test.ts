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

describe("authorizeReportExport — view != export", () => {
  it("refuses export when the user can view but lacks reports.export", async () => {
    h.user = u(["reports.view", "reports.view_operational"]);
    await expect(authorizeReportExport("project-summary")).rejects.toThrow("FORBIDDEN");
  });

  it("allows export only with both visibility and reports.export", async () => {
    h.user = u(["reports.view", "reports.view_operational", "reports.export"]);
    await expect(authorizeReportExport("project-summary")).resolves.toBeUndefined();
    // financial report still blocked — no financial visibility
    await expect(authorizeReportExport("budget-vs-actual")).rejects.toThrow("FORBIDDEN");
  });
});
