import { describe, it, expect } from "vitest";
import {
  PERMISSION_CATALOG,
  ALL_PERMISSIONS,
  isPermission,
  moduleOf,
  isWildcard,
  expandPermissions,
  DANGER_PERMISSIONS,
} from "./permissions";
import { SYSTEM_ROLES, LEGACY_ROLE_TO_KEY } from "./roles";
import { resolvePermissions, flattenRolePermissions, type RoleNode } from "./resolve";

describe("permission catalog", () => {
  it("has no duplicate permission keys", () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
  });

  it("keys are well-formed module.action and moduleOf agrees with the catalog", () => {
    for (const mod of PERMISSION_CATALOG) {
      for (const a of mod.actions) {
        expect(a.key.startsWith(`${mod.module}.`)).toBe(true);
        expect(moduleOf(a.key)).toBe(mod.module);
      }
    }
  });

  it("isPermission recognises catalog keys and rejects others", () => {
    expect(isPermission("projects.delete")).toBe(true);
    expect(isPermission("projects.nuke")).toBe(false);
    expect(isPermission("")).toBe(false);
  });
});

describe("system roles", () => {
  it("every preset permission exists in the catalog", () => {
    const known = new Set<string>(ALL_PERMISSIONS);
    for (const role of SYSTEM_ROLES) {
      for (const p of role.permissions) expect(known.has(p)).toBe(true);
    }
  });

  it("owner is the protected all-access role with an implicit (empty) list", () => {
    const owner = SYSTEM_ROLES.find((r) => r.key === "owner")!;
    expect(owner.isOwner).toBe(true);
    expect(owner.permissions).toEqual([]);
  });

  it("admin has broad access but not owner-only commercial controls", () => {
    const admin = SYSTEM_ROLES.find((r) => r.key === "admin")!;
    expect(admin.permissions).toContain("projects.delete");
    expect(admin.permissions).not.toContain("company.billing");
    expect(admin.permissions).not.toContain("company.subscription");
    expect(admin.permissions).not.toContain("company.api_keys");
  });

  it("role names and keys are unique", () => {
    const keys = SYSTEM_ROLES.map((r) => r.key);
    const names = SYSTEM_ROLES.map((r) => r.name);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it("reflects the spec matrix for the example roles", () => {
    const perms = (key: string) => new Set(SYSTEM_ROLES.find((r) => r.key === key)!.permissions);
    const pm = perms("purchase_manager");
    expect(pm.has("purchase_orders.create")).toBe(true);
    expect(pm.has("purchase_orders.approve")).toBe(false);
    expect(pm.has("projects.delete")).toBe(false);
    const acct = perms("accountant");
    expect(acct.has("payments.create")).toBe(true);
    expect(acct.has("reports.view")).toBe(true);
    expect(acct.has("attendance.mark")).toBe(false);
    const eng = perms("site_engineer");
    expect(eng.has("attendance.mark")).toBe(true);
    expect(eng.has("purchase_orders.create")).toBe(false);
  });
});

describe("resolvePermissions", () => {
  it("an assigned owner role grants every permission", () => {
    const out = resolvePermissions({
      roles: [{ isOwner: true, permissions: [] }],
      legacyRole: "PROJECT_MANAGER",
    });
    expect(out.length).toBe(ALL_PERMISSIONS.length);
  });

  it("a non-owner role grants exactly its stored permissions", () => {
    const out = resolvePermissions({
      roles: [{ isOwner: false, permissions: ["projects.view", "vendors.view"] }],
      legacyRole: "PROJECT_MANAGER",
    });
    expect(out.sort()).toEqual(["projects.view", "vendors.view"].sort());
  });

  it("unions permissions across multiple assigned roles (multi-role)", () => {
    const out = resolvePermissions({
      roles: [
        { isOwner: false, permissions: ["projects.view"] },
        { isOwner: false, permissions: ["vendors.view", "projects.view"] },
      ],
      legacyRole: "PROJECT_MANAGER",
    });
    expect(new Set(out)).toEqual(new Set(["projects.view", "vendors.view"]));
  });

  it("owner among several roles short-circuits to all permissions", () => {
    const out = resolvePermissions({
      roles: [
        { isOwner: false, permissions: ["projects.view"] },
        { isOwner: true, permissions: [] },
      ],
      legacyRole: "PROJECT_MANAGER",
    });
    expect(out.length).toBe(ALL_PERMISSIONS.length);
  });

  it("expands wildcards in a role's stored permissions", () => {
    const out = resolvePermissions({
      roles: [{ isOwner: false, permissions: ["projects.*"] }],
      legacyRole: "PROJECT_MANAGER",
    });
    const projectPerms = ALL_PERMISSIONS.filter((p) => moduleOf(p) === "projects");
    expect(new Set(out)).toEqual(new Set(projectPerms));
  });

  it("filters out unknown permission keys defensively", () => {
    const out = resolvePermissions({
      roles: [{ isOwner: false, permissions: ["projects.view", "bogus.key"] }],
      legacyRole: "PROJECT_MANAGER",
    });
    expect(out).toEqual(["projects.view"]);
  });

  it("falls back to the legacy enum when no role is assigned (OWNER → all)", () => {
    expect(resolvePermissions({ roles: [], legacyRole: "OWNER" }).length).toBe(ALL_PERMISSIONS.length);
    expect(resolvePermissions({ roles: null, legacyRole: "OWNER" }).length).toBe(ALL_PERMISSIONS.length);
  });

  it("falls back to the Project Manager preset for a legacy PM with no role", () => {
    const out = resolvePermissions({ roles: [], legacyRole: "PROJECT_MANAGER" });
    const preset = SYSTEM_ROLES.find((r) => r.key === LEGACY_ROLE_TO_KEY.PROJECT_MANAGER)!;
    expect(out).toEqual(preset.permissions);
  });
});

describe("wildcards + metadata", () => {
  it("isWildcard recognises '*' and '<module>.*' only", () => {
    expect(isWildcard("*")).toBe(true);
    expect(isWildcard("projects.*")).toBe(true);
    expect(isWildcard("projects.view")).toBe(false);
  });

  it("expandPermissions resolves '*' to everything and drops unknowns", () => {
    expect(new Set(expandPermissions(["*"]))).toEqual(new Set(ALL_PERMISSIONS));
    expect(expandPermissions(["nope.nope"])).toEqual([]);
    expect(expandPermissions(["projects.view", "projects.view"])).toEqual(["projects.view"]);
  });

  it("DANGER_PERMISSIONS flags destructive actions as metadata", () => {
    expect(DANGER_PERMISSIONS).toContain("projects.delete");
    expect(DANGER_PERMISSIONS).toContain("payments.delete");
    expect(DANGER_PERMISSIONS).not.toContain("projects.view");
  });
});

describe("flattenRolePermissions (role inheritance)", () => {
  const byId = new Map<string, RoleNode>([
    ["base", { id: "base", permissions: ["projects.view"] }],
    ["mid", { id: "mid", permissions: ["vendors.view"], parentId: "base" }],
    ["leaf", { id: "leaf", permissions: ["reports.view"], parentId: "mid" }],
  ]);

  it("collects the role's own permissions plus every ancestor's", () => {
    expect(new Set(flattenRolePermissions("leaf", byId))).toEqual(
      new Set(["reports.view", "vendors.view", "projects.view"]),
    );
  });

  it("owner anywhere in the chain grants all permissions", () => {
    const m = new Map<string, RoleNode>([
      ["root", { id: "root", permissions: [], isOwner: true }],
      ["child", { id: "child", permissions: ["projects.view"], parentId: "root" }],
    ]);
    expect(flattenRolePermissions("child", m).length).toBe(ALL_PERMISSIONS.length);
  });

  it("is cycle-safe", () => {
    const m = new Map<string, RoleNode>([
      ["a", { id: "a", permissions: ["projects.view"], parentId: "b" }],
      ["b", { id: "b", permissions: ["vendors.view"], parentId: "a" }],
    ]);
    expect(new Set(flattenRolePermissions("a", m))).toEqual(
      new Set(["projects.view", "vendors.view"]),
    );
  });
});
