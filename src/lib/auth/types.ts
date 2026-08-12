import type { Permission } from "@/features/rbac/permissions";

export type Role = "OWNER" | "PROJECT_MANAGER";

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  /** Legacy enum role — still authoritative for authorization in Phase 1. */
  role: Role;
  /** RBAC: the assigned company role id/name (undefined until backfilled). */
  roleId?: string | null;
  roleName?: string;
  /** RBAC: resolved permission keys for this session. Loaded in Phase 1 but not
   *  yet enforced anywhere — the legacy `role` checks remain in force. */
  permissions?: Permission[];
  /** True when the session resolves to the protected Owner role (assigned owner
   *  role OR legacy OWNER enum). Gates Owner-exclusive actions like labour Force
   *  Delete; unlike a permission it can never be delegated to another role.
   *  Optional so existing test fixtures need no change — undefined ⇒ not owner. */
  isOwner?: boolean;
  company: {
    id: string;
    name: string;
  };
}
