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

/** Only the Owner role is protected from editing: it holds implicit all-access,
 *  so its permission set is not customisable. Every other role — including the
 *  seeded system templates (Admin, Project Manager, Accountant, …) — is editable,
 *  letting companies tailor the defaults to how they actually operate. */
export function assertRoleEditable(role: { isOwner: boolean; isSystem?: boolean }): void {
  if (role.isOwner) throw new Error("PROTECTED_ROLE");
}

/** System roles are default templates and can't be deleted (the app re-seeds
 *  them per company); the Owner role can never be deleted either. Only bespoke
 *  custom roles are removable. */
export function assertRoleDeletable(role: { isOwner: boolean; isSystem?: boolean }): void {
  if (role.isOwner || role.isSystem) throw new Error("PROTECTED_ROLE");
}

/** @deprecated Use {@link assertRoleEditable} / {@link assertRoleDeletable}. */
export function assertRoleMutable(role: { isOwner: boolean; isSystem?: boolean }): void {
  assertRoleDeletable(role);
}
