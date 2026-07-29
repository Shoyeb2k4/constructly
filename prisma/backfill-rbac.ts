// One-time RBAC backfill (Phase 1). For every existing company: seed the system
// roles, then assign each user (who has no role yet) to the role matching their
// legacy `role` enum — OWNER → Owner, PROJECT_MANAGER → Project Manager. No data
// is lost and the legacy enum is left untouched. Idempotent: safe to re-run.
//
// Run after applying prisma/migration-rbac.sql:  npx tsx prisma/backfill-rbac.ts

import { PrismaClient } from "../src/generated/prisma";
import { SYSTEM_ROLES, LEGACY_ROLE_TO_KEY, type SystemRoleKey } from "../src/features/rbac/roles";

const prisma = new PrismaClient();

async function syncSystemRoles(companyId: string): Promise<Map<SystemRoleKey, string>> {
  const map = new Map<SystemRoleKey, string>();
  for (const def of SYSTEM_ROLES) {
    const existing = await prisma.companyRole.findFirst({
      where: { companyId, key: def.key },
      select: { id: true },
    });
    const id =
      existing?.id ??
      (
        await prisma.companyRole.create({
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
        })
      ).id;
    map.set(def.key, id);
  }
  return map;
}

async function main() {
  const companies = await prisma.company.findMany({ select: { id: true, name: true } });
  let seeded = 0;
  let assigned = 0;

  for (const company of companies) {
    const roleMap = await syncSystemRoles(company.id);
    seeded += roleMap.size;

    // Assign every user in this company: set the primary role (companyRoleId)
    // and mirror it into the junction (user_roles). Idempotent on both.
    const users = await prisma.user.findMany({
      where: { companyId: company.id },
      select: { id: true, role: true, companyRoleId: true },
    });
    for (const u of users) {
      const key = LEGACY_ROLE_TO_KEY[u.role as "OWNER" | "PROJECT_MANAGER"] ?? "project_manager";
      const roleId = u.companyRoleId ?? roleMap.get(key);
      if (!roleId) continue;
      if (!u.companyRoleId) {
        await prisma.user.update({ where: { id: u.id }, data: { companyRoleId: roleId } });
      }
      const existing = await prisma.userRole.findUnique({
        where: { userId_roleId: { userId: u.id, roleId } },
        select: { id: true },
      });
      if (!existing) {
        await prisma.userRole.create({
          data: { companyId: company.id, userId: u.id, roleId, isPrimary: true },
        });
      }
      assigned += 1;
    }
    console.log(`✓ ${company.name}: ${roleMap.size} roles ensured, ${users.length} users assigned`);
  }

  console.log(`\nDone. Companies: ${companies.length}, roles ensured: ${seeded}, users assigned: ${assigned}.`);
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
