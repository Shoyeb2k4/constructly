import { requireUser } from "./current-user";
import type { SessionUser } from "./types";
import { moduleOf, type Permission, type PermissionModule } from "@/features/rbac/permissions";

/**
 * Permission checks over a resolved session. These are the Phase-1 building
 * blocks for enforcement; they are defined and unit-tested now but NOT yet wired
 * into server actions / UI (that is the Phase 2 swap). The legacy `role` checks
 * remain authoritative until then.
 */

/** Does this user hold the given permission? */
export function hasPermission(
  user: SessionUser | null | undefined,
  permission: Permission,
): boolean {
  if (!user) return false;
  return (user.permissions ?? []).includes(permission);
}

/** Does the user hold at least one of the given permissions? */
export function hasAnyPermission(
  user: SessionUser | null | undefined,
  permissions: Permission[],
): boolean {
  if (!user) return false;
  const held = user.permissions ?? [];
  return permissions.some((p) => held.includes(p));
}

/** Does the user hold every one of the given permissions? */
export function hasAllPermissions(
  user: SessionUser | null | undefined,
  permissions: Permission[],
): boolean {
  if (!user) return false;
  const held = user.permissions ?? [];
  return permissions.every((p) => held.includes(p));
}

/** Can the user see/use a module at all (holds any permission within it)?
 *  Drives sidebar/module visibility in a later phase. */
export function canAccessModule(
  user: SessionUser | null | undefined,
  module: PermissionModule,
): boolean {
  if (!user) return false;
  return (user.permissions ?? []).some((p) => moduleOf(p) === module);
}

/**
 * Guard for server actions/routes: resolve the session and require a permission,
 * throwing "FORBIDDEN" if absent. Not yet called anywhere (Phase 2), but ready.
 */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasPermission(user, permission)) throw new Error("FORBIDDEN");
  return user;
}
