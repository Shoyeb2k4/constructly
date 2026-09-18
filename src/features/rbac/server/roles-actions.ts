"use server";

import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import { ALL_PERMISSIONS, isPermission, type Permission } from "../permissions";
import { assertCanGrantPermissions, assertRoleEditable, assertRoleDeletable } from "@/features/team/authz";

/**
 * Company role management (Roles & Permissions admin). Every mutation is
 * server-first (requirePermission), company-scoped, and audit-logged. Safety
 * rules from features/team/authz.ts are enforced here:
 *  - no privilege escalation (assertCanGrantPermissions),
 *  - protected system/Owner roles (assertRoleMutable),
 *  - the last active Owner can never be demoted (assignUserRole).
 */

export interface RoleDTO {
  id: string;
  key: string | null;
  name: string;
  description: string | null;
  isSystem: boolean;
  isOwner: boolean;
  permissions: Permission[];
  memberCount: number;
}

function toDTO(r: {
  id: string;
  key: string | null;
  name: string;
  description: string | null;
  isSystem: boolean;
  isOwner: boolean;
  permissions: string[];
  _count: { users: number };
}): RoleDTO {
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    isOwner: r.isOwner,
    // Owner is implicit-all; others expose their stored (valid) permission keys.
    permissions: r.isOwner ? [...ALL_PERMISSIONS] : r.permissions.filter(isPermission),
    memberCount: r._count.users,
  };
}

const roleInclude = { _count: { select: { users: true } } } as const;

async function logRole(
  user: SessionUser,
  action: string,
  roleId: string,
  summary: string,
  meta?: Record<string, unknown>,
) {
  await prisma.activityLog.create({
    data: {
      companyId: user.company.id,
      actorId: user.id,
      action,
      entityType: "role",
      entityId: roleId,
      summary,
      ...(meta ? { meta: meta as never } : {}),
    },
  });
}

const cleanPermissions = (raw: string[]): Permission[] => [...new Set(raw.filter(isPermission))];

// ── Reads ──────────────────────────────────────────────────────────────
export async function listRoles(): Promise<RoleDTO[]> {
  const user = await requirePermission("roles.view");
  const rows = await prisma.companyRole.findMany({
    where: { companyId: user.company.id },
    orderBy: [{ isOwner: "desc" }, { isSystem: "desc" }, { name: "asc" }],
    include: roleInclude,
  });
  return rows.map(toDTO);
}

/** Minimal role list for the "assign role" dropdown — gated by roles.assign
 *  (does not require roles.view / exposing full permission sets). */
export async function listAssignableRoles(): Promise<{ id: string; name: string; isOwner: boolean }[]> {
  const user = await requirePermission("roles.assign");
  return prisma.companyRole.findMany({
    where: { companyId: user.company.id },
    orderBy: [{ isOwner: "desc" }, { isSystem: "desc" }, { name: "asc" }],
    select: { id: true, name: true, isOwner: true },
  });
}

// ── Create / duplicate ─────────────────────────────────────────────────
export async function createRole(input: {
  name: string;
  description?: string | null;
  permissions: string[];
}): Promise<RoleDTO> {
  const user = await requirePermission("roles.create");
  const name = input.name.trim();
  if (name.length < 2) throw new Error("Enter a role name.");
  const permissions = cleanPermissions(input.permissions);
  // No privilege escalation: you can only grant permissions you hold.
  assertCanGrantPermissions(user, permissions);

  const clash = await prisma.companyRole.findFirst({ where: { companyId: user.company.id, name } });
  if (clash) throw new Error("A role with that name already exists.");

  const role = await prisma.companyRole.create({
    data: {
      companyId: user.company.id,
      name,
      description: input.description?.trim() || null,
      isSystem: false,
      isOwner: false,
      permissions,
    },
    include: roleInclude,
  });
  await logRole(user, "role.created", role.id, `Created role ${name}`, { permissions });
  return toDTO(role);
}

export async function duplicateRole(id: string): Promise<RoleDTO> {
  const user = await requirePermission("roles.create");
  const src = await prisma.companyRole.findFirst({ where: { id, companyId: user.company.id } });
  if (!src) throw new Error("NOT_FOUND");
  const permissions = src.isOwner ? [...ALL_PERMISSIONS] : cleanPermissions(src.permissions);
  assertCanGrantPermissions(user, permissions);

  // Ensure a unique "(copy)" name.
  let name = `${src.name} (copy)`;
  for (let n = 2; await prisma.companyRole.findFirst({ where: { companyId: user.company.id, name } }); n++) {
    name = `${src.name} (copy ${n})`;
  }

  const role = await prisma.companyRole.create({
    data: {
      companyId: user.company.id,
      name,
      description: src.description,
      isSystem: false,
      isOwner: false,
      permissions,
    },
    include: roleInclude,
  });
  await logRole(user, "role.duplicated", role.id, `Duplicated ${src.name} → ${name}`);
  return toDTO(role);
}

// ── Update ─────────────────────────────────────────────────────────────
export async function updateRole(
  id: string,
  patch: { name?: string; description?: string | null; permissions?: string[] },
): Promise<RoleDTO> {
  const user = await requirePermission("roles.edit");
  const role = await prisma.companyRole.findFirst({ where: { id, companyId: user.company.id } });
  if (!role) throw new Error("NOT_FOUND");
  // Owner is implicit all-access; built-in system roles are READ-ONLY templates
  // (Duplicate to customise) so prisma/reconcile-rbac.ts can never discard a
  // company's work. Only custom roles get past here — see features/team/authz.
  assertRoleEditable(role);

  const data: { name?: string; description?: string | null; permissions?: Permission[] } = {};

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (name.length < 2) throw new Error("Enter a role name.");
    const clash = await prisma.companyRole.findFirst({
      where: { companyId: user.company.id, name, NOT: { id } },
    });
    if (clash) throw new Error("A role with that name already exists.");
    data.name = name;
  }
  if (patch.description !== undefined) data.description = patch.description?.trim() || null;

  if (patch.permissions !== undefined) {
    // Editing the grant set requires the dedicated permission + no escalation.
    await requirePermission("roles.manage_permissions");
    const permissions = cleanPermissions(patch.permissions);
    assertCanGrantPermissions(user, permissions);
    data.permissions = permissions;
  }

  const updated = await prisma.companyRole.update({ where: { id }, data, include: roleInclude });
  await logRole(user, "role.updated", id, `Updated role ${updated.name}`, {
    fields: Object.keys(data),
  });
  return toDTO(updated);
}

// ── Delete ─────────────────────────────────────────────────────────────
export async function deleteRole(id: string): Promise<void> {
  const user = await requirePermission("roles.delete");
  const role = await prisma.companyRole.findFirst({
    where: { id, companyId: user.company.id },
    include: roleInclude,
  });
  if (!role) throw new Error("NOT_FOUND");
  assertRoleDeletable(role); // system + Owner templates can't be deleted
  if (role._count.users > 0) {
    throw new Error("Reassign the members of this role before deleting it.");
  }
  await prisma.companyRole.delete({ where: { id } });
  await logRole(user, "role.deleted", id, `Deleted role ${role.name}`);
}

// ── Assign a role to a user ────────────────────────────────────────────
export async function assignUserRole(userId: string, roleId: string): Promise<void> {
  const user = await requirePermission("roles.assign");
  const role = await prisma.companyRole.findFirst({ where: { id: roleId, companyId: user.company.id } });
  if (!role) throw new Error("NOT_FOUND");
  const target = await prisma.user.findFirst({ where: { id: userId, companyId: user.company.id } });
  if (!target) throw new Error("NOT_FOUND");

  // No privilege escalation: only assign a role whose permissions you hold.
  const permissions = role.isOwner ? [...ALL_PERMISSIONS] : cleanPermissions(role.permissions);
  assertCanGrantPermissions(user, permissions);

  // Last active Owner can't be demoted (enum stays in sync with role.isOwner).
  if (target.role === "OWNER" && !role.isOwner) {
    const owners = await prisma.user.count({
      where: { companyId: user.company.id, role: "OWNER", status: "ACTIVE" },
    });
    if (owners <= 1) throw new Error("You can't remove the last owner. Assign another owner first.");
  }

  const enumRole = role.isOwner ? "OWNER" : "PROJECT_MANAGER";
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { companyRoleId: roleId, role: enumRole } }),
    prisma.userRole.deleteMany({ where: { userId } }),
    prisma.userRole.create({
      data: { companyId: user.company.id, userId, roleId, isPrimary: true, assignedById: user.id },
    }),
    prisma.activityLog.create({
      data: {
        companyId: user.company.id,
        actorId: user.id,
        action: "role.assigned",
        entityType: "user",
        entityId: userId,
        summary: `Assigned ${target.email} the ${role.name} role`,
        meta: { roleId, roleName: role.name },
      },
    }),
  ]);
}
