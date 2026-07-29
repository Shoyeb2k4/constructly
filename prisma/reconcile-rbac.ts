// Reconcile seeded SYSTEM roles to the code presets. Needed when a preset
// changes (e.g. Phase 2 corrected the Project Manager role to match the legacy
// PROJECT_MANAGER exactly — no projects.create/assign). Only touches system
// roles (is_system = true); custom roles are never modified. Idempotent.
//
// Run:  npx tsx prisma/reconcile-rbac.ts

import { PrismaClient } from "../src/generated/prisma";
import { SYSTEM_ROLES } from "../src/features/rbac/roles";

const prisma = new PrismaClient();

async function main() {
  const companies = await prisma.company.findMany({ select: { id: true, name: true } });
  let updated = 0;
  for (const company of companies) {
    for (const def of SYSTEM_ROLES) {
      const res = await prisma.companyRole.updateMany({
        where: { companyId: company.id, key: def.key, isSystem: true },
        data: {
          name: def.name,
          description: def.description,
          isOwner: def.isOwner ?? false,
          permissions: def.isOwner ? [] : def.permissions,
        },
      });
      updated += res.count;
    }
    console.log(`✓ ${company.name}: system roles reconciled`);
  }
  console.log(`\nDone. Companies: ${companies.length}, system roles updated: ${updated}.`);
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
