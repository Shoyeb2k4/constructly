/**
 * Pure permission resolution — turns a user's assigned role(s) (or, during
 * migration, their legacy enum role) into the effective permission list carried
 * on the session. Kept pure (no I/O) so it's trivially unit-testable and shared
 * by the server session loader and the demo user.
 */

import { ALL_PERMISSIONS, expandPermissions, type Permission } from "./permissions";
import { LEGACY_ROLE_TO_KEY, systemRole } from "./roles";

export interface RoleLike {
  isOwner: boolean;
  permissions: string[];
}

/**
 * Resolve effective permissions for a session.
 *
 * - Any assigned owner role ⇒ every permission (implicit all-access).
 * - Otherwise ⇒ the UNION of every assigned role's permissions (multi-role
 *   ready), with wildcards expanded and unknown keys dropped.
 * - No assigned role yet (pre-backfill / legacy) ⇒ derive from the legacy enum
 *   via the matching seeded preset, so permissions stay correct during the
 *   transition and nothing regresses.
 */
export function resolvePermissions(input: {
  roles?: RoleLike[] | null;
  legacyRole: "OWNER" | "PROJECT_MANAGER";
}): Permission[] {
  const roles = input.roles ?? [];

  if (roles.length > 0) {
    if (roles.some((r) => r.isOwner)) return [...ALL_PERMISSIONS];
    return expandPermissions(roles.flatMap((r) => r.permissions));
  }

  // Fallback: no DB role assigned → mirror the legacy enum.
  if (input.legacyRole === "OWNER") return [...ALL_PERMISSIONS];
  return [...systemRole(LEGACY_ROLE_TO_KEY[input.legacyRole]).permissions];
}

export interface RoleNode {
  id: string;
  permissions: string[];
  isOwner?: boolean;
  parentId?: string | null;
}

/**
 * Flatten a role's effective permissions across its inheritance chain (role
 * hierarchy): the role's own permissions plus every ancestor's, wildcard-
 * expanded. Owner anywhere in the chain ⇒ all permissions. Cycle-safe. Pure —
 * callers pass a map of every role in the company. Ready for the Phase-4 role
 * hierarchy; not yet wired into the session (roles are currently flat).
 */
export function flattenRolePermissions(
  roleId: string,
  byId: Map<string, RoleNode>,
): Permission[] {
  const collected: string[] = [];
  const seen = new Set<string>();
  let current: RoleNode | undefined = byId.get(roleId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.isOwner) return [...ALL_PERMISSIONS];
    collected.push(...current.permissions);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return expandPermissions(collected);
}
