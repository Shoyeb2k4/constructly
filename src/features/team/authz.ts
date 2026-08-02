import { ALL_PERMISSIONS, type Permission } from "@/features/rbac/permissions";
import { SYSTEM_ROLES, LEGACY_ROLE_TO_KEY } from "@/features/rbac/roles";
import type { Role, SessionUser } from "@/lib/auth/types";

/**
 * Users & Roles authorization helpers. Pure and unit-tested so the core admin
 * safety rules are provable independent of the DB:
 *  - No privilege escalation: you can never grant a permission you don't hold.
 *  - Assigning a role grants that role's permissions → same rule applies.
 *  - The Owner system role is protected (never editable/deletable).
 */

/** Effective permissions a legacy enum role grants (owner ⇒ everything). */
export function permissionsForLegacyRole(role: Role): Permission[] {
  if (role === "OWNER") return [...ALL_PERMISSIONS];
  const preset = SYSTEM_ROLES.find((r) => r.key === LEGACY_ROLE_TO_KEY[role]);
  return preset ? [...preset.permissions] : [];
}

/** No privilege escalation: every permission being granted must be one the actor
 *  already holds. Throws FORBIDDEN otherwise. */
export function assertCanGrantPermissions(actor: SessionUser, permissions: Permission[]): void {
  const held = new Set<string>(actor.permissions ?? []);
  if (!permissions.every((p) => held.has(p))) throw new Error("FORBIDDEN");
}

/** Assigning a role hands its permission set to the target — the actor must
 *  possess all of them (so a non-owner can't mint an Owner). */
export function assertCanAssignRole(actor: SessionUser, role: Role): void {
  assertCanGrantPermissions(actor, permissionsForLegacyRole(role));
}

/** System roles (incl. the all-access Owner) are protected: they can't be edited
 *  or deleted — clone one to customise. Only company-created custom roles are
 *  mutable. */
export function assertRoleMutable(role: { isOwner: boolean; isSystem?: boolean }): void {
  if (role.isOwner || role.isSystem) throw new Error("PROTECTED_ROLE");
}
