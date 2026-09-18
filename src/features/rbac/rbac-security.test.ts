import { describe, it, expect, beforeEach } from "vitest";
import { resolvePermissions } from "./resolve";
import { SYSTEM_ROLES, systemRole } from "./roles";
import { ALL_PERMISSIONS, type Permission } from "./permissions";
import { PERMISSION_META, reportsUnlockedBy } from "./permission-meta";
import { demoRolesRepository, resetDemoRoles } from "./demo/demo-repository";
import { canExportReport, canViewReport } from "@/features/reports/report-meta";
import { REPORTS } from "@/features/reports/registry";
import { paymentsVisibilityFor } from "@/features/payments/visibility";
import { assertCanGrantPermissions, assertRoleDeletable, assertRoleEditable } from "@/features/team/authz";
import type { SessionUser } from "@/lib/auth/types";

/**
 * RBAC is where a UI mistake exposes money.
 *
 * These prove BEHAVIOUR, not checkbox state: a permission set is fed to the same
 * resolvers and visibility rules the app actually consults, and the resulting
 * access is asserted. A role editor that saves the right keys but produces the
 * wrong access would pass a persistence test and fail these.
 */

function user(permissions: Permission[], isOwner = false): SessionUser {
  return {
    id: "u1",
    email: "u@example.com",
    fullName: "U",
    role: isOwner ? "OWNER" : "PROJECT_MANAGER",
    permissions,
    isOwner,
    company: { id: "co", name: "Co" },
  };
}
const has = (perms: Permission[]) => (p: Permission) => perms.includes(p);

beforeEach(() => {
  localStorage.clear();
  resetDemoRoles();
});

/* ── Owner ───────────────────────────────────────────────────────────── */

describe("Owner", () => {
  it("holds every permission despite storing none", () => {
    // Production evidence: every Owner row genuinely carries zero permissions.
    const stored = systemRole("owner");
    expect(stored.permissions).toEqual([]);
    expect(stored.isOwner).toBe(true);

    const effective = resolvePermissions({
      roles: [{ isOwner: true, permissions: [] }],
      legacyRole: "OWNER",
    });
    expect(effective.length).toBe(ALL_PERMISSIONS.length);
    expect(effective).toEqual(expect.arrayContaining([...ALL_PERMISSIONS]));
  });

  it("is never presented as having no access", async () => {
    const owner = (await demoRolesRepository.listRoles()).find((r) => r.isOwner)!;
    // The DTO expands Owner to everything, so no surface can render "0 permissions".
    expect(owner.permissions.length).toBe(ALL_PERMISSIONS.length);
  });

  it("cannot be edited or deleted", () => {
    expect(() => assertRoleEditable({ isOwner: true, isSystem: true })).toThrow("PROTECTED_ROLE");
    expect(() => assertRoleDeletable({ isOwner: true, isSystem: true })).toThrow("PROTECTED_ROLE");
  });

  it("gains any permission added in a future release, automatically", () => {
    // Implicit access means the Owner list is derived, never maintained — so a
    // new permission cannot accidentally exclude the Owner.
    const effective = resolvePermissions({ roles: [{ isOwner: true, permissions: [] }], legacyRole: "OWNER" });
    for (const p of ALL_PERMISSIONS) expect(effective).toContain(p);
  });
});

/* ── Admin ───────────────────────────────────────────────────────────── */

describe("Admin", () => {
  const admin = systemRole("admin");

  it("holds everything except the three owner-only permissions", () => {
    expect(admin.permissions.length).toBe(ALL_PERMISSIONS.length - 3);
    for (const ownerOnly of ["company.billing", "company.subscription", "company.api_keys"] as const) {
      expect(admin.permissions).not.toContain(ownerOnly);
    }
  });

  it("matches the 98 permissions production reports", () => {
    // Verified against the live database during the Phase 6 deployment (94),
    // then +4 when the materials master-data module was added. A change here is
    // never incidental: it means the catalogue grew or shrank, and with it the
    // shape of every company's Admin role.
    expect(admin.permissions.length).toBe(98);
  });

  it("includes the advance re-scope permission the reconciliation added", () => {
    expect(admin.permissions).toContain("contractors.advance_rescope");
  });
});

/* ── Project scoping ─────────────────────────────────────────────────── */

describe("a project-scoped role", () => {
  const pm = systemRole("project_manager");

  it("gets no company-wide visibility by default", () => {
    for (const wide of pm.permissions.filter((p) => p.endsWith("_all"))) {
      // If a `_all` grant ever appears in the PM preset it must be deliberate;
      // this catches it being added by accident.
      expect(["reports.view_all"]).toContain(wide);
    }
  });

  it("cannot see company-wide contractor advances without contractors.view_all", () => {
    const scoped = paymentsVisibilityFor(user(["payments.view", "contractors.view"]));
    expect(scoped.contractorLedger).toBe(true);
    expect(scoped.companyWideAdvances).toBe(false);

    const wide = paymentsVisibilityFor(user(["contractors.view", "contractors.view_all"]));
    expect(wide.companyWideAdvances).toBe(true);
  });

  it("labels every company-wide permission as such, so it cannot be granted blind", () => {
    const wideKeys = ALL_PERMISSIONS.filter((p) => p.endsWith("_all"));
    expect(wideKeys.length).toBeGreaterThan(5);
    for (const key of wideKeys) {
      const meta = PERMISSION_META[key];
      // Every `_all` permission must read as company-wide and high impact —
      // this is the grant most likely to be made by mistake.
      expect(meta.scope, `${key} is not marked company-wide`).toBe(
        key.startsWith("reports.") ? "PROJECT" : "COMPANY",
      );
      expect(meta.impact, `${key} is not marked high impact`).toBe("HIGH");
    }
  });
});

/* ── The report class split ──────────────────────────────────────────── */

describe("financial vs operational reports", () => {
  it("hides every financial report from an operational-only role", () => {
    const operational = has(["reports.view", "reports.view_operational", "reports.export"]);
    const financial = REPORTS.filter((r) => reportsUnlockedBy("reports.view_financial").includes(r.name));
    expect(financial.length).toBeGreaterThan(0);
    for (const r of financial) {
      expect(canViewReport(operational, r.id), `${r.id} was viewable`).toBe(false);
      expect(canExportReport(operational, r.id), `${r.id} was exportable`).toBe(false);
    }
  });

  it("shows operational reports to that same role", () => {
    const operational = has(["reports.view", "reports.view_operational"]);
    for (const name of reportsUnlockedBy("reports.view_operational")) {
      const r = REPORTS.find((x) => x.name === name)!;
      expect(canViewReport(operational, r.id), `${r.id} was hidden`).toBe(true);
    }
  });

  it("derives what each class unlocks from the live registry", () => {
    const fin = reportsUnlockedBy("reports.view_financial");
    const ops = reportsUnlockedBy("reports.view_operational");
    // Every report belongs to exactly one class — no report is unreachable, and
    // none is reachable from both.
    expect(new Set([...fin, ...ops]).size).toBe(REPORTS.length);
    expect(fin.filter((n) => ops.includes(n))).toEqual([]);
  });

  it("grants nothing at all without reports.view", () => {
    const noEntry = has(["reports.view_financial", "reports.view_operational", "reports.export"]);
    for (const r of REPORTS) expect(canViewReport(noEntry, r.id)).toBe(false);
  });
});

/* ── Payments permissions do not cascade ─────────────────────────────── */

describe("payments.view does not imply contractor access", () => {
  it("shows vendor money only", () => {
    const v = paymentsVisibilityFor(user(["payments.view"]));
    expect(v.vendorPayments).toBe(true);
    expect(v.contractorLedger).toBe(false);
    expect(v.agreementPayments).toBe(false);
    expect(v.companyWideAdvances).toBe(false);
  });

  it("says so in the permission's own description", () => {
    // The UI must not imply the cascade the domain does not have.
    expect(PERMISSION_META["payments.view"].description).toMatch(/vendor money only/i);
  });
});

/* ── No privilege escalation ─────────────────────────────────────────── */

describe("nobody can grant what they do not hold", () => {
  it("refuses a grant beyond the actor's own permissions", () => {
    const actor = user(["projects.view", "contractors.view"]);
    expect(() => assertCanGrantPermissions(actor, ["projects.view"])).not.toThrow();
    expect(() => assertCanGrantPermissions(actor, ["payments.delete"])).toThrow("FORBIDDEN");
  });

  it("lets an Owner grant anything", () => {
    const owner = user([...ALL_PERMISSIONS], true);
    expect(() => assertCanGrantPermissions(owner, [...ALL_PERMISSIONS])).not.toThrow();
  });
});

/* ── Custom roles ────────────────────────────────────────────────────── */

describe("the custom-role workflow", () => {
  it("creates a custom role that is never a system role", async () => {
    const role = await demoRolesRepository.createRole({
      name: "Project Accounts Reviewer",
      permissions: ["projects.view", "contractors.view", "payments.view", "reports.view", "reports.view_financial"],
    });
    expect(role.isSystem).toBe(false);
    expect(role.isOwner).toBe(false);
    expect(role.permissions).toHaveLength(5);
  });

  it("produces exactly the access its permissions describe", async () => {
    const role = await demoRolesRepository.createRole({
      name: "Project Accounts Reviewer",
      permissions: ["projects.view", "contractors.view", "payments.view", "reports.view", "reports.view_financial"],
    });
    const effective = resolvePermissions({
      roles: [{ isOwner: false, permissions: role.permissions }],
      legacyRole: "PROJECT_MANAGER",
    });
    const can = has(effective);

    // Can review financial reports…
    expect(canViewReport(can, "payments")).toBe(true);
    expect(canViewReport(can, "contractor-position")).toBe(true);
    // …but cannot export them, having no reports.export.
    expect(canExportReport(can, "payments")).toBe(false);
    // …sees vendor payments and contractor positions on its own projects…
    const v = paymentsVisibilityFor(user(effective));
    expect(v.vendorPayments).toBe(true);
    expect(v.contractorLedger).toBe(true);
    // …but not company-wide advances, nor agreement payments.
    expect(v.companyWideAdvances).toBe(false);
    expect(v.agreementPayments).toBe(false);
    // …and can do none of the money-moving actions.
    for (const denied of [
      "payments.create",
      "contractors.settle",
      "contractors.settle_reverse",
      "contracts.pay",
      "users.invite",
      "roles.manage_permissions",
    ] as const) {
      expect(effective, `custom role wrongly holds ${denied}`).not.toContain(denied);
    }
  });

  it("refuses a duplicate name, and a name too short to mean anything", async () => {
    await demoRolesRepository.createRole({ name: "Reviewer" });
    await expect(demoRolesRepository.createRole({ name: "Reviewer" })).rejects.toThrow(/already exists/);
    await expect(demoRolesRepository.createRole({ name: "R" })).rejects.toThrow(/role name/i);
  });

  it("duplicating a built-in role produces a CUSTOM copy", async () => {
    const roles = await demoRolesRepository.listRoles();
    const admin = roles.find((r) => r.key === "admin")!;
    const copy = await demoRolesRepository.duplicateRole(admin.id);
    expect(copy.isSystem).toBe(false);
    expect(copy.permissions.length).toBe(admin.permissions.length);
    // This is what makes "duplicate to customise" a real answer to the reset.
    expect(copy.name).not.toBe(admin.name);
  });

  it("duplicating Owner yields a full-access CUSTOM role, not another Owner", async () => {
    const roles = await demoRolesRepository.listRoles();
    const owner = roles.find((r) => r.isOwner)!;
    const copy = await demoRolesRepository.duplicateRole(owner.id);
    expect(copy.isOwner).toBe(false);
    expect(copy.isSystem).toBe(false);
    expect(copy.permissions.length).toBe(ALL_PERMISSIONS.length);
  });

  it("deletes a custom role, but never a built-in or in-use one", async () => {
    const custom = await demoRolesRepository.createRole({ name: "Temporary" });
    await expect(demoRolesRepository.deleteRole(custom.id)).resolves.toBeUndefined();

    const roles = await demoRolesRepository.listRoles();
    const admin = roles.find((r) => r.key === "admin")!;
    await expect(demoRolesRepository.deleteRole(admin.id)).rejects.toThrow("PROTECTED_ROLE");

    const supervisor = roles.find((r) => r.key === "supervisor")!;
    expect(supervisor.memberCount).toBeGreaterThan(0);
    await expect(demoRolesRepository.deleteRole(supervisor.id)).rejects.toThrow("PROTECTED_ROLE");
  });

  it("edits a custom role's permissions and reads them back", async () => {
    const role = await demoRolesRepository.createRole({ name: "Reviewer", permissions: ["projects.view"] });
    await demoRolesRepository.updateRole(role.id, {
      permissions: ["projects.view", "reports.view", "reports.view_operational"],
    });
    const again = (await demoRolesRepository.listRoles()).find((r) => r.id === role.id)!;
    expect(again.permissions.sort()).toEqual(
      ["projects.view", "reports.view", "reports.view_operational"].sort(),
    );
  });

  it("drops keys that are not real permissions", async () => {
    const role = await demoRolesRepository.createRole({
      name: "Reviewer",
      permissions: ["projects.view", "not.a.permission", "payments.view"],
    });
    expect(role.permissions).toEqual(expect.arrayContaining(["projects.view", "payments.view"]));
    expect(role.permissions).toHaveLength(2);
  });
});

/* ── Reconciliation safety ───────────────────────────────────────────── */

describe("built-in roles are read-only templates", () => {
  it("refuses an edit to a built-in role", async () => {
    const roles = await demoRolesRepository.listRoles();
    const admin = roles.find((r) => r.key === "admin")!;
    // Previously allowed, and that was the trap: reconciliation would discard
    // the edit on the next Constructly update, silently.
    await expect(
      demoRolesRepository.updateRole(admin.id, { permissions: ["projects.view"] }),
    ).rejects.toThrow("BUILT_IN_ROLE");

    const after = (await demoRolesRepository.listRoles()).find((r) => r.key === "admin")!;
    expect(after.permissions).toHaveLength(ALL_PERMISSIONS.length - 3);
  });

  it("refuses a rename of a built-in role too", async () => {
    const roles = await demoRolesRepository.listRoles();
    const pm = roles.find((r) => r.key === "project_manager")!;
    await expect(
      demoRolesRepository.updateRole(pm.id, { name: "Site Lead" }),
    ).rejects.toThrow("BUILT_IN_ROLE");
  });

  it("offers Duplicate as the way to customise, and the copy IS editable", async () => {
    const roles = await demoRolesRepository.listRoles();
    const admin = roles.find((r) => r.key === "admin")!;
    const copy = await demoRolesRepository.duplicateRole(admin.id);

    expect(copy.isSystem).toBe(false);
    await expect(
      demoRolesRepository.updateRole(copy.id, { permissions: ["projects.view"] }),
    ).resolves.toBeTruthy();
    const edited = (await demoRolesRepository.listRoles()).find((r) => r.id === copy.id)!;
    expect(edited.permissions).toEqual(["projects.view"]);
  });

  it("never turns a duplicate of Owner into another implicit Owner", async () => {
    const roles = await demoRolesRepository.listRoles();
    const owner = roles.find((r) => r.isOwner)!;
    const copy = await demoRolesRepository.duplicateRole(owner.id);
    // It carries today's full permission list, but is NOT an owner role — so it
    // will not silently gain permissions added by a future release, and it can
    // be edited and deleted like any other custom role.
    expect(copy.isOwner).toBe(false);
    expect(copy.isSystem).toBe(false);
    expect(copy.permissions.length).toBe(ALL_PERMISSIONS.length);
    await expect(demoRolesRepository.updateRole(copy.id, { name: "Deputy" })).resolves.toBeTruthy();
  });
});

describe("reconciliation only touches built-in roles", () => {
  /**
   * What `prisma/reconcile-rbac.ts` actually does: `updateMany` where
   * `isSystem: true`, writing the code preset. It goes straight to the database
   * and does NOT pass through `updateRole`, so the read-only guard does not
   * apply to it — which is the whole point. Custom roles are excluded by that
   * where-clause, and this proves it.
   */
  const reconcile = () => {
    const KEY = "constructly.demo.companyRoles.v1";
    const rows = JSON.parse(localStorage.getItem(KEY) ?? "[]") as {
      key: string | null;
      isSystem: boolean;
      isOwner: boolean;
      name: string;
      description: string | null;
      permissions: string[];
    }[];
    for (const def of SYSTEM_ROLES) {
      const target = rows.find((r) => r.key === def.key && r.isSystem);
      if (!target) continue;
      target.name = def.name;
      target.description = def.description;
      target.permissions = def.isOwner ? [] : [...def.permissions];
    }
    localStorage.setItem(KEY, JSON.stringify(rows));
  };

  it("leaves a custom role byte-for-byte unchanged", async () => {
    const custom = await demoRolesRepository.createRole({
      name: "Project Accounts Reviewer",
      description: "Reads money, changes nothing.",
      permissions: ["projects.view", "payments.view"],
    });
    const before = JSON.stringify(custom);

    reconcile();

    const after = (await demoRolesRepository.listRoles()).find((r) => r.id === custom.id)!;
    expect(JSON.stringify(after)).toBe(before);
    expect(after.name).toBe("Project Accounts Reviewer");
    expect(after.description).toBe("Reads money, changes nothing.");
    expect(after.permissions.sort()).toEqual(["payments.view", "projects.view"]);
    expect(after.isSystem).toBe(false);
  });

  it("returns a built-in role to its canonical template", async () => {
    // Simulate drift arriving from anywhere (an older release, a direct write)
    // and confirm reconciliation restores the preset.
    const KEY = "constructly.demo.companyRoles.v1";
    await demoRolesRepository.listRoles();
    const rows = JSON.parse(localStorage.getItem(KEY)!);
    const admin = rows.find((r: { key: string }) => r.key === "admin");
    admin.permissions = ["projects.view"];
    localStorage.setItem(KEY, JSON.stringify(rows));

    reconcile();

    const after = (await demoRolesRepository.listRoles()).find((r) => r.key === "admin")!;
    expect(after.permissions).toHaveLength(ALL_PERMISSIONS.length - 3);
  });

  it("keeps a custom role safe across a reload", async () => {
    const custom = await demoRolesRepository.createRole({
      name: "Reviewer",
      permissions: ["reports.view", "reports.view_operational"],
    });
    reconcile();
    // A fresh read, as a page reload would do.
    const after = (await demoRolesRepository.listRoles()).find((r) => r.id === custom.id)!;
    expect(after.permissions.sort()).toEqual(["reports.view", "reports.view_operational"]);
  });
});

/* ── Metadata completeness ───────────────────────────────────────────── */

describe("every permission is explained", () => {
  it("has a description, a scope and an impact", () => {
    for (const p of ALL_PERMISSIONS) {
      const meta = PERMISSION_META[p];
      expect(meta, `${p} has no metadata`).toBeTruthy();
      // A real sentence, not a placeholder and not the key echoed back. Length
      // is a poor proxy — "Add a supplier." is short and complete.
      expect(meta.description, `${p} has no description`).toMatch(/^[A-Z][\s\S]*[.]$/);
      expect(meta.description.toLowerCase()).not.toContain(p.toLowerCase());
      expect(["PROJECT", "COMPANY", "NONE"]).toContain(meta.scope);
      expect(["NORMAL", "HIGH"]).toContain(meta.impact);
    }
  });

  it("marks every money-moving or history-rewriting permission high impact", () => {
    for (const p of [
      "payments.create",
      "payments.delete",
      "contractors.advance",
      "contractors.settle",
      "contractors.settle_reverse",
      "contractors.attribute_history",
      "contractors.advance_rescope",
      "contracts.pay",
      "contracts.pay_delete",
      "roles.manage_permissions",
      "roles.assign",
      "users.disable",
    ] as const) {
      expect(PERMISSION_META[p].impact, `${p} is not marked high impact`).toBe("HIGH");
    }
  });
});
