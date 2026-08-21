import type { RoleDTO } from "./server/roles-actions";

/**
 * Company role management contract.
 *
 * Split out for the same reason branding was: the hooks called the Prisma-backed
 * server actions directly, so Roles & Permissions was an empty screen in demo
 * mode — which is why the custom-role workflow had never been exercised
 * anywhere, by anyone.
 *
 * The demo implementation enforces the SAME safety rules the server does
 * (protected Owner, non-deletable built-ins, in-use roles blocked), so the demo
 * cannot teach a rule production does not have.
 */
export interface RolesRepository {
  listRoles(): Promise<RoleDTO[]>;
  listAssignableRoles(): Promise<{ id: string; name: string; isOwner: boolean }[]>;
  createRole(input: {
    name: string;
    description?: string | null;
    permissions?: string[];
  }): Promise<RoleDTO>;
  duplicateRole(id: string): Promise<RoleDTO>;
  updateRole(
    id: string,
    patch: { name?: string; description?: string | null; permissions?: string[] },
  ): Promise<RoleDTO>;
  deleteRole(id: string): Promise<void>;
  assignUserRole(userId: string, roleId: string): Promise<void>;
}
