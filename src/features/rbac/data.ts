import { isDemoMode } from "@/lib/env";
import { demoRolesRepository } from "./demo/demo-repository";
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

export const rolesApi: RolesRepository = isDemoMode ? demoRolesRepository : serverRepository;
