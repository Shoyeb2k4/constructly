import "server-only";
import type { Prisma, PrismaClient } from "@/generated/prisma";
import { SYSTEM_ROLES, type SystemRoleKey } from "../roles";

/** A Prisma client or an interactive-transaction client — either can seed roles. */
type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Ensure a company has all seeded system roles, creating any that are missing.
 * Idempotent and non-destructive: an existing role is left exactly as-is (its
 * permissions may have been customised by the Owner), so re-running never
 * clobbers company edits. Returns a map of system-role key → role id, so callers
 * (onboarding, backfill) can assign users to the right role.
 *
 * Each company gets its own independent copy of the roles — multi-tenant safe.
 */
export async function syncSystemRoles(
  client: DbClient,
  companyId: string,
): Promise<Map<SystemRoleKey, string>> {
  const map = new Map<SystemRoleKey, string>();
  for (const def of SYSTEM_ROLES) {
    const existing = await client.companyRole.findFirst({
      where: { companyId, key: def.key },
      select: { id: true },
    });
    if (existing) {
      map.set(def.key, existing.id);
      continue;
    }
    const created = await client.companyRole.create({
      data: {
        companyId,
        key: def.key,
        name: def.name,
        description: def.description,
        isSystem: true,
        isOwner: def.isOwner ?? false,
        permissions: def.isOwner ? [] : def.permissions,
      },
      select: { id: true },
    });
    map.set(def.key, created.id);
  }
  return map;
}

/**
 * Assign a role to a user via the junction table. Idempotent — a repeated
 * (user, role) assignment is a no-op. Returns the junction row id. This is the
 * multi-role-ready primitive: assigning a second role is just another call.
 */
export async function assignRole(
  client: DbClient,
  params: {
    companyId: string;
    userId: string;
    roleId: string;
    isPrimary?: boolean;
    assignedById?: string | null;
  },
): Promise<string> {
  const existing = await client.userRole.findUnique({
    where: { userId_roleId: { userId: params.userId, roleId: params.roleId } },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await client.userRole.create({
    data: {
      companyId: params.companyId,
      userId: params.userId,
      roleId: params.roleId,
      isPrimary: params.isPrimary ?? false,
      assignedById: params.assignedById ?? null,
    },
    select: { id: true },
  });
  return created.id;
}
