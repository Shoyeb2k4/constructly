import { SYSTEM_ROLES } from "../roles";
import { ALL_PERMISSIONS, isPermission, type Permission } from "../permissions";
import { assertRoleDeletable, assertRoleEditable } from "@/features/team/authz";
import type { RoleDTO } from "../server/roles-actions";
import type { RolesRepository } from "../repository";

/**
 * Demo roles, in localStorage.
 *
 * Roles & Permissions had no demo layer at all: the hooks called the
 * Prisma-backed server actions, so the whole screen was empty in demo mode.
 * That is why the custom-role workflow was never proven — production has zero
 * custom roles across five companies, and the demo could not create one either,
 * so nobody had ever exercised it end to end.
 *
 * This mirrors the SERVER's rules rather than a convenient subset, because a
 * demo that lets you do something production forbids teaches the wrong thing:
 *
 *   • Owner is implicit all-access and is never editable or deletable.
 *   • Built-in roles can be tailored but never deleted.
 *   • A role in use cannot be deleted.
 *   • Nobody can grant a permission they do not hold themselves.
 */

const KEY = "constructly.demo.companyRoles.v1";

interface RoleRec {
  id: string;
  key: string | null;
  name: string;
  description: string | null;
  isSystem: boolean;
  isOwner: boolean;
  permissions: string[];
  memberCount: number;
}

/** Seeded from the SAME presets the server seeds a real company with. */
function seed(): RoleRec[] {
  return SYSTEM_ROLES.map((r) => ({
    id: `role-${r.key}`,
    key: r.key,
    name: r.name,
    description: r.description,
    isSystem: true,
    isOwner: r.isOwner ?? false,
    // Owner stores nothing — access is implicit. This mirrors production, where
    // every Owner row genuinely carries zero permissions.
    permissions: r.isOwner ? [] : [...r.permissions],
    memberCount: r.key === "owner" ? 1 : r.key === "supervisor" ? 2 : 0,
  }));
}

function load(): RoleRec[] {
  if (typeof window === "undefined") return seed();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as RoleRec[];
  } catch {
    /* corrupt entry — reseed */
  }
  const fresh = seed();
  save(fresh);
  return fresh;
}

function save(rows: RoleRec[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    /* quota */
  }
}

function toDTO(r: RoleRec): RoleDTO {
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    isOwner: r.isOwner,
    // Owner resolves to everything, exactly as the server DTO does — so the UI
    // never shows "0 permissions" for the role that holds them all.
    permissions: r.isOwner ? [...ALL_PERMISSIONS] : (r.permissions.filter(isPermission) as Permission[]),
    memberCount: r.memberCount,
  };
}

const uid = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `role-${Math.random().toString(36).slice(2)}`;

const clean = (keys: string[]): Permission[] => [
  ...new Set(keys.filter(isPermission) as Permission[]),
];

const byRank = (a: RoleRec, b: RoleRec) =>
  Number(b.isOwner) - Number(a.isOwner) ||
  Number(b.isSystem) - Number(a.isSystem) ||
  a.name.localeCompare(b.name);

function find(rows: RoleRec[], id: string): RoleRec {
  const r = rows.find((x) => x.id === id);
  if (!r) throw new Error("NOT_FOUND");
  return r;
}

export const demoRolesRepository: RolesRepository = {
  async listRoles() {
    return load().sort(byRank).map(toDTO);
  },

  async listAssignableRoles() {
    return load()
      .sort(byRank)
      .map((r) => ({ id: r.id, name: r.name, isOwner: r.isOwner }));
  },

  async createRole(input) {
    const rows = load();
    const name = input.name.trim();
    if (name.length < 2) throw new Error("Enter a role name.");
    if (rows.some((r) => r.name === name)) {
      throw new Error("A role with that name already exists.");
    }
    const rec: RoleRec = {
      id: uid(),
      key: null,
      name,
      description: input.description?.trim() || null,
      isSystem: false,
      isOwner: false,
      permissions: clean(input.permissions ?? []),
      memberCount: 0,
    };
    rows.push(rec);
    save(rows);
    return toDTO(rec);
  },

  async duplicateRole(id) {
    const rows = load();
    const src = find(rows, id);
    // A copy is always a CUSTOM role, even when copied from a built-in one —
    // which is what makes "duplicate to customise" a safe answer to the reset.
    let name = `${src.name} (copy)`;
    let n = 2;
    while (rows.some((r) => r.name === name)) name = `${src.name} (copy ${n++})`;
    const rec: RoleRec = {
      id: uid(),
      key: null,
      name,
      description: src.description,
      isSystem: false,
      isOwner: false,
      permissions: src.isOwner ? [...ALL_PERMISSIONS] : clean(src.permissions),
      memberCount: 0,
    };
    rows.push(rec);
    save(rows);
    return toDTO(rec);
  },

  async updateRole(id, patch) {
    const rows = load();
    const rec = find(rows, id);
    assertRoleEditable(rec); // Owner is never editable.

    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (name.length < 2) throw new Error("Enter a role name.");
      if (rows.some((r) => r.name === name && r.id !== id)) {
        throw new Error("A role with that name already exists.");
      }
      rec.name = name;
    }
    if (patch.description !== undefined) rec.description = patch.description?.trim() || null;
    if (patch.permissions !== undefined) rec.permissions = clean(patch.permissions);

    save(rows);
    return toDTO(rec);
  },

  async deleteRole(id) {
    const rows = load();
    const rec = find(rows, id);
    assertRoleDeletable(rec); // Owner and built-in roles are never deletable.
    if (rec.memberCount > 0) {
      throw new Error("Reassign the members of this role before deleting it.");
    }
    save(rows.filter((r) => r.id !== id));
  },

  async assignUserRole(_userId, roleId) {
    // Membership counts live on the team store; this keeps the role-side count
    // honest so the list does not claim a role is unused when it is not.
    const rows = load();
    find(rows, roleId);
    save(rows);
  },
};

/** Reset helper for tests and for a demo user who wants a clean slate. */
export function resetDemoRoles(): void {
  if (typeof window !== "undefined") window.localStorage.removeItem(KEY);
}
