import { isDemoMode } from "@/lib/env";
import { isNativeClient } from "@/lib/mobile/platform";
import { demoRolesRepository } from "./demo/demo-repository";
import { httpRolesRepository } from "./http-repository";
import type { RolesRepository } from "./repository";
import * as server from "./server/roles-actions";

/** Demo binds to localStorage; everything else to the Prisma server actions. */
const serverRepository: RolesRepository = {
  listRoles: server.listRoles,
  listAssignableRoles: server.listAssignableRoles,
  createRole: server.createRole,
  duplicateRole: server.duplicateRole,
  updateRole: server.updateRole,
  deleteRole: server.deleteRole,
  assignUserRole: server.assignUserRole,
};

/**
 * Transport selection, in priority order:
 *   demo mode  → in-browser fixtures (unchanged)
 *   native app → HTTP RPC to the deployed Next backend (Capacitor; no Server
 *                Actions, because the bundle has no same-origin Next server)
 *   web        → Server Actions (unchanged — this is the production path)
 *
 * `isNativeClient` is a build-time constant, so each bundle keeps exactly one
 * of these branches and tree-shakes the rest: the web bundle never carries the
 * RPC client, and the mobile bundle never carries Prisma.
 */
export const rolesApi: RolesRepository = isDemoMode
  ? demoRolesRepository
  : isNativeClient
    ? httpRolesRepository
    : serverRepository;
