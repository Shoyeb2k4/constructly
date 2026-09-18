import { describe, it, expect } from "vitest";
import {
  ALL_PERMISSIONS,
  DANGER_PERMISSIONS,
  PERMISSION_CATALOG,
  PERMISSION_MODULES,
  expandPermissions,
  isPermission,
  moduleOf,
  type Permission,
} from "./permissions";
import { PERMISSION_META } from "./permission-meta";
import { SYSTEM_ROLES, systemRole, type SystemRoleKey } from "./roles";
import { resolvePermissions } from "./resolve";

/**
 * The materials module governs company-wide master data: the catalogue every
 * purchase order is raised against. Getting its grants wrong is not cosmetic —
 * too tight and a site team cannot raise an order, too loose and anyone who can
 * type a PO can withdraw an item from under everyone else.
 *
 * These tests pin the intended shape. A change here should be a decision, not a
 * side effect of editing a nearby line.
 */

const MATERIAL_PERMISSIONS = [
  "materials.view",
  "materials.create",
  "materials.edit",
  "materials.archive",
] as const;

const grants = (key: SystemRoleKey) => new Set<string>(systemRole(key).permissions);
const materialGrants = (key: SystemRoleKey) =>
  systemRole(key)
    .permissions.filter((p) => moduleOf(p) === "materials")
    .sort();

describe("materials permission catalogue", () => {
  it.each(MATERIAL_PERMISSIONS)("%s exists and is recognised", (key) => {
    expect(ALL_PERMISSIONS).toContain(key);
    expect(isPermission(key)).toBe(true);
    expect(moduleOf(key as Permission)).toBe("materials");
  });

  it("declares exactly these four actions — no restore, merge or delete", () => {
    const mod = PERMISSION_CATALOG.find((m) => m.module === "materials");
    expect(mod, "materials module missing from the catalogue").toBeTruthy();
    expect(mod!.actions.map((a) => a.key)).toEqual([...MATERIAL_PERMISSIONS]);
    expect(mod!.label).toBe("Materials");
  });

  it("registers the module so the Roles UI can render it", () => {
    expect(PERMISSION_MODULES).toContain("materials");
  });

  it("introduces no duplicate or colliding key", () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
    const modules = PERMISSION_CATALOG.map((m) => m.module);
    expect(new Set(modules).size).toBe(modules.length);
  });

  it("flags archiving as destructive, and the other three as not", () => {
    expect(DANGER_PERMISSIONS).toContain("materials.archive");
    for (const key of ["materials.view", "materials.create", "materials.edit"] as const) {
      expect(DANGER_PERMISSIONS).not.toContain(key);
    }
  });
});

describe("materials permission metadata", () => {
  it.each(MATERIAL_PERMISSIONS)("%s is explained well enough to grant safely", (key) => {
    const meta = PERMISSION_META[key];
    expect(meta, `${key} has no metadata`).toBeTruthy();
    expect(meta.description).toMatch(/^[A-Z][\s\S]*[.]$/);
    // The description must say something, not echo the key back.
    expect(meta.description.toLowerCase()).not.toContain(key.toLowerCase());
    // Master data is company-wide by definition — never project-scoped.
    expect(meta.scope).toBe("COMPANY");
  });

  it("warns that archiving affects everyone, since it is the one that does", () => {
    expect(PERMISSION_META["materials.archive"].impact).toBe("HIGH");
    expect(PERMISSION_META["materials.archive"].warning).toBeTruthy();
  });
});

describe("system role defaults", () => {
  it("Owner holds them implicitly, storing nothing", () => {
    const owner = systemRole("owner");
    expect(owner.isOwner).toBe(true);
    expect(owner.permissions).toEqual([]);
    // Implicit all-access is resolved, not stored.
    const resolved = resolvePermissions({
      roles: [{ isOwner: true, permissions: [] }],
      legacyRole: "OWNER",
    });
    for (const key of MATERIAL_PERMISSIONS) expect(resolved).toContain(key);
  });

  it("Admin picks all four up automatically, because it is computed", () => {
    expect(materialGrants("admin")).toEqual([...MATERIAL_PERMISSIONS].sort());
  });

  it("Project Manager may view and add, but not reshape the catalogue", () => {
    expect(materialGrants("project_manager")).toEqual(["materials.create", "materials.view"]);
    // Mirrors the fact that a PM gets vendors.view but never vendors.edit.
    expect(grants("project_manager").has("vendors.edit")).toBe(false);
  });

  it("Purchase Manager curates the catalogue exactly as it curates vendors", () => {
    const g = grants("purchase_manager");
    expect(materialGrants("purchase_manager")).toEqual([
      "materials.create",
      "materials.edit",
      "materials.view",
    ]);
    // The mirror, stated as the invariant it is: same three verbs as vendors,
    // and no archive on either.
    for (const verb of ["view", "create", "edit"] as const) {
      expect(g.has(`materials.${verb}` as Permission)).toBe(g.has(`vendors.${verb}` as Permission));
    }
    expect(g.has("materials.archive")).toBe(false);
    expect(g.has("vendors.archive")).toBe(false);
  });

  it("Accountant reads the catalogue and cannot change it", () => {
    expect(materialGrants("accountant")).toEqual(["materials.view"]);
  });

  it("roles with no procurement surface get no material access at all", () => {
    for (const key of ["site_engineer", "supervisor"] as const) {
      expect(materialGrants(key)).toEqual([]);
      // Consistent: neither role can see vendors or purchase orders either.
      expect(grants(key).has("vendors.view")).toBe(false);
      expect(grants(key).has("purchase_orders.view")).toBe(false);
    }
  });

  it("every preset key it grants is a real catalogue permission", () => {
    for (const role of SYSTEM_ROLES) {
      for (const p of role.permissions) expect(isPermission(p)).toBe(true);
    }
  });
});

describe("no accidental privilege", () => {
  it("creating a material does not imply editing or archiving one", () => {
    const held = expandPermissions(["materials.create"]);
    expect(held).toEqual(["materials.create"]);
  });

  it("editing does not imply archiving", () => {
    expect(expandPermissions(["materials.edit"])).toEqual(["materials.edit"]);
  });

  it("being able to raise a purchase order grants no material management", () => {
    const poRaiser = expandPermissions([
      "purchase_orders.view",
      "purchase_orders.create",
      "purchase_orders.edit",
    ]);
    for (const key of MATERIAL_PERMISSIONS) expect(poRaiser).not.toContain(key);
  });

  it("holding every material permission grants nothing in procurement", () => {
    const curator = expandPermissions([...MATERIAL_PERMISSIONS]);
    for (const key of ["purchase_orders.create", "vendors.edit", "company.edit"] as const) {
      expect(curator).not.toContain(key);
    }
  });
});

describe("existing roles are not silently broadened", () => {
  it("leaves every unrelated grant on every system role untouched", () => {
    // A full non-materials snapshot: if adding the module perturbed anything
    // else, these counts move.
    const nonMaterial = Object.fromEntries(
      SYSTEM_ROLES.map((r) => [r.key, r.permissions.filter((p) => moduleOf(p) !== "materials").length]),
    );
    // These are the counts from `git show HEAD:src/features/rbac/roles.ts`
    // BEFORE the materials module was added — i.e. the numbers this change was
    // required to leave alone. Admin's 94 is also the figure production
    // reported at the Phase 6 deployment.
    expect(nonMaterial).toEqual({
      owner: 0,
      admin: 94,
      project_manager: 28,
      purchase_manager: 8,
      site_engineer: 5,
      accountant: 15,
      supervisor: 4,
    });
  });

  it("a custom role gains nothing from the catalogue growing", () => {
    // Custom roles store concrete keys (createRole/updateRole run the list
    // through isPermission), so a new module cannot leak into one.
    const custom = [{ isOwner: false, permissions: ["projects.view", "purchase_orders.create"] }];
    const resolved = resolvePermissions({ roles: custom, legacyRole: "PROJECT_MANAGER" });
    expect(resolved.sort()).toEqual(["projects.view", "purchase_orders.create"]);
  });

  it("a wildcard role WOULD pick them up — the one broadening path, by design", () => {
    // Not reachable through the app (wildcards are filtered out on write), but
    // it is how expandPermissions behaves, so it is stated rather than assumed.
    expect(expandPermissions(["materials.*"]).sort()).toEqual([...MATERIAL_PERMISSIONS].sort());
    for (const key of MATERIAL_PERMISSIONS) expect(expandPermissions(["*"])).toContain(key);
  });

  it("a legacy PM with no assigned role resolves to the updated preset", () => {
    // No migration reaches these users: their permissions come from the code
    // preset at session time.
    const resolved = resolvePermissions({ roles: [], legacyRole: "PROJECT_MANAGER" });
    expect(resolved).toContain("materials.view");
    expect(resolved).toContain("materials.create");
    expect(resolved).not.toContain("materials.edit");
    expect(resolved).not.toContain("materials.archive");
  });
});
