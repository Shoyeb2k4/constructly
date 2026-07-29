import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "./types";

const h = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("./current-user", () => ({ requireUser: async () => {
  if (!h.user) throw new Error("UNAUTHENTICATED");
  return h.user;
} }));

import {
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  canAccessModule,
  requirePermission,
} from "./permissions";

function userWith(permissions: SessionUser["permissions"]): SessionUser {
  return {
    id: "u1",
    email: "u@x.com",
    fullName: "U",
    role: "PROJECT_MANAGER",
    permissions,
    company: { id: "c1", name: "Co" },
  };
}

beforeEach(() => {
  h.user = null;
});

describe("hasPermission / hasAny / hasAll", () => {
  const u = userWith(["projects.view", "projects.edit", "vendors.view"]);

  it("hasPermission is true only for held permissions", () => {
    expect(hasPermission(u, "projects.edit")).toBe(true);
    expect(hasPermission(u, "projects.delete")).toBe(false);
  });

  it("null/undefined users hold nothing", () => {
    expect(hasPermission(null, "projects.view")).toBe(false);
    expect(hasPermission(userWith(undefined), "projects.view")).toBe(false);
  });

  it("hasAnyPermission / hasAllPermissions", () => {
    expect(hasAnyPermission(u, ["projects.delete", "vendors.view"])).toBe(true);
    expect(hasAnyPermission(u, ["projects.delete", "vendors.delete"])).toBe(false);
    expect(hasAllPermissions(u, ["projects.view", "projects.edit"])).toBe(true);
    expect(hasAllPermissions(u, ["projects.view", "projects.delete"])).toBe(false);
  });
});

describe("canAccessModule", () => {
  const u = userWith(["projects.view", "reports.export"]);
  it("true when the user holds any permission in the module", () => {
    expect(canAccessModule(u, "projects")).toBe(true);
    expect(canAccessModule(u, "reports")).toBe(true);
  });
  it("false when the user holds none in the module", () => {
    expect(canAccessModule(u, "vendors")).toBe(false);
    expect(canAccessModule(u, "company")).toBe(false);
  });
});

describe("requirePermission", () => {
  it("returns the user when the permission is held", async () => {
    h.user = userWith(["projects.delete"]);
    await expect(requirePermission("projects.delete")).resolves.toMatchObject({ id: "u1" });
  });

  it("throws FORBIDDEN when the permission is missing", async () => {
    h.user = userWith(["projects.view"]);
    await expect(requirePermission("projects.delete")).rejects.toThrow("FORBIDDEN");
  });

  it("propagates UNAUTHENTICATED when there is no session", async () => {
    h.user = null;
    await expect(requirePermission("projects.view")).rejects.toThrow("UNAUTHENTICATED");
  });
});
