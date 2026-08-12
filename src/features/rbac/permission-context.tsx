"use client";

import * as React from "react";
import type { Permission, PermissionModule } from "./permissions";

/**
 * Client-side permission context. The session's resolved permission list is
 * provided once (from the server layout) and read by `useCan()` to gate UI.
 *
 * UI gating is convenience only — the server ALWAYS enforces via
 * requirePermission(). Never rely on these checks for security.
 */
const PermissionContext = React.createContext<ReadonlySet<string>>(new Set());
/** Owner status — resolved server-side, never a permission (can't be delegated).
 *  Gates Owner-exclusive UI like labour Force Delete. */
const OwnerContext = React.createContext<boolean>(false);

export function PermissionProvider({
  permissions,
  isOwner = false,
  children,
}: {
  permissions: string[];
  isOwner?: boolean;
  children: React.ReactNode;
}) {
  const set = React.useMemo(() => new Set(permissions), [permissions]);
  return (
    <OwnerContext.Provider value={isOwner}>
      <PermissionContext.Provider value={set}>{children}</PermissionContext.Provider>
    </OwnerContext.Provider>
  );
}

/** Returns a `can(permission)` predicate bound to the current user's grants. */
export function useCan(): (permission: Permission) => boolean {
  const set = React.useContext(PermissionContext);
  return React.useCallback((permission: Permission) => set.has(permission), [set]);
}

/** True when the current user is the protected Owner. UI convenience only — the
 *  server always re-checks via requireOwner(). */
export function useIsOwner(): boolean {
  return React.useContext(OwnerContext);
}

/**
 * Returns a `canAccessModule(module)` predicate — true when the user holds ANY
 * permission within that module. Drives sidebar/module visibility.
 */
export function useCanAccessModule(): (module: PermissionModule) => boolean {
  const set = React.useContext(PermissionContext);
  return React.useCallback(
    (module: PermissionModule) => {
      const prefix = `${module}.`;
      for (const p of set) if (p.startsWith(prefix)) return true;
      return false;
    },
    [set],
  );
}
