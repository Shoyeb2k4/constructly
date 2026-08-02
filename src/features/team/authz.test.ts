import { describe, it, expect } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import { ALL_PERMISSIONS, type Permission } from "@/features/rbac/permissions";
import { SYSTEM_ROLES } from "@/features/rbac/roles";
import {
  permissionsForLegacyRole,
  assertCanGrantPermissions,
  assertCanAssignRole,
  assertRoleMutable,
} from "./authz";

function actor(permissions: Permission[]): SessionUser {
  return { id: "u1", email: "u@x.com", fullName: "U", role: "PROJECT_MANAGER", permissions, company: { id: "c1", name: "Co" } };
}
const PM_PRESET = SYSTEM_ROLES.find((r) => r.key === "project_manager")!.permissions;

describe("permissionsForLegacyRole", () => {
  it("OWNER maps to every permission", () => {
    expect(permissionsForLegacyRole("OWNER").length).toBe(ALL_PERMISSIONS.length);
  });
  it("PROJECT_MANAGER maps to the PM preset", () => {
    expect(permissionsForLegacyRole("PROJECT_MANAGER")).toEqual(PM_PRESET);
  });
});

describe("no privilege escalation", () => {
  it("cannot grant a permission you don't hold", () => {
    const a = actor(["projects.view"]);
    expect(() => assertCanGrantPermissions(a, ["projects.view", "projects.delete"])).toThrow("FORBIDDEN");
  });
  it("can grant permissions you hold", () => {
    const a = actor(["projects.view", "projects.delete"]);
    expect(() => assertCanGrantPermissions(a, ["projects.view", "projects.delete"])).not.toThrow();
  });
});

describe("assertCanAssignRole — assigning a role hands over its permissions", () => {
  it("an all-permission owner can assign OWNER and PROJECT_MANAGER", () => {
    const owner = actor([...ALL_PERMISSIONS]);
    expect(() => assertCanAssignRole(owner, "OWNER")).not.toThrow();
    expect(() => assertCanAssignRole(owner, "PROJECT_MANAGER")).not.toThrow();
  });

  it("a non-owner (only PM permissions) CANNOT mint an Owner", () => {
    const pm = actor([...PM_PRESET]);
    expect(() => assertCanAssignRole(pm, "OWNER")).toThrow("FORBIDDEN");
  });

  it("a non-owner with the PM permission set can assign PROJECT_MANAGER", () => {
    const pm = actor([...PM_PRESET]);
    expect(() => assertCanAssignRole(pm, "PROJECT_MANAGER")).not.toThrow();
  });
});

describe("assertRoleMutable — the Owner role is protected", () => {
  it("throws for the owner role (never editable/deletable)", () => {
    expect(() => assertRoleMutable({ isOwner: true, isSystem: true })).toThrow("PROTECTED_ROLE");
  });
  it("allows a non-owner role", () => {
    expect(() => assertRoleMutable({ isOwner: false, isSystem: false })).not.toThrow();
  });
});
