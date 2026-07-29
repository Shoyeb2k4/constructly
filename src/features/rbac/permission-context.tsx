"use client";

import * as React from "react";
import type { Permission } from "./permissions";

/**
 * Client-side permission context. The session's resolved permission list is
 * provided once (from the server layout) and read by `useCan()` to gate UI.
 *
 * UI gating is convenience only — the server ALWAYS enforces via
 * requirePermission(). Never rely on these checks for security.
 */
const PermissionContext = React.createContext<ReadonlySet<string>>(new Set());

export function PermissionProvider({
  permissions,
  children,
}: {
  permissions: string[];
  children: React.ReactNode;
}) {
  const set = React.useMemo(() => new Set(permissions), [permissions]);
  return <PermissionContext.Provider value={set}>{children}</PermissionContext.Provider>;
}

/** Returns a `can(permission)` predicate bound to the current user's grants. */
export function useCan(): (permission: Permission) => boolean {
  const set = React.useContext(PermissionContext);
  return React.useCallback((permission: Permission) => set.has(permission), [set]);
}
