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

/**
 * Built-in roles are READ-ONLY templates; only custom roles are editable.
 *
 * They used to be editable, and that was a trap. `prisma/reconcile-rbac.ts`
 * rewrites every `isSystem` role to its code preset whenever Constructly ships
 * a change to the defaults — so a company that tailored Admin would silently
 * lose that work on a future release, with no warning and no way back. Phase 6
 * ran exactly that reconciliation against production; it only did no damage
 * because no customer had edited a built-in role yet.
 *
 * The answer is Duplicate to customise: a copy is `isSystem: false`, belongs to
 * the customer, and reconciliation never touches it. Enforced HERE rather than
 * by hiding the UI, so a direct server call cannot get around it.
 */
export function assertRoleEditable(role: { isOwner: boolean; isSystem?: boolean }): void {
  if (role.isOwner) throw new Error("PROTECTED_ROLE");
  if (role.isSystem) throw new Error("BUILT_IN_ROLE");
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
