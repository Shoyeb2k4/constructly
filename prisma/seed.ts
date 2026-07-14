// Demo seed — creates "Meridian Build Co." with an owner and a project manager.
// Run with `npm run db:seed` once a database is connected. IDs match
// src/lib/auth/demo.ts so demo mode and a real DB stay consistent.
// Richer demo data (projects, laborers, POs) is added as each module lands.

import { PrismaClient } from "../src/generated/prisma";

const prisma = new PrismaClient();

const COMPANY_ID = "00000000-0000-0000-0000-0000000000c0";
const OWNER_ID = "00000000-0000-0000-0000-000000000001";
const PM_ID = "00000000-0000-0000-0000-000000000002";

async function main() {
  const company = await prisma.company.upsert({
    where: { id: COMPANY_ID },
    update: {},
    create: {
      id: COMPANY_ID,
      name: "Meridian Build Co.",
      gstin: "29ABCDE1234F1Z5",
      settings: { poApprovalRequired: true, currency: "INR" },
    },
  });

  await prisma.user.upsert({
    where: { id: OWNER_ID },
    update: {},
    create: {
      id: OWNER_ID,
      companyId: company.id,
      email: "owner@demo.constructly.app",
      fullName: "Aarav Mehta",
      role: "OWNER",
      status: "ACTIVE",
    },
  });

  await prisma.user.upsert({
    where: { id: PM_ID },
    update: {},
    create: {
      id: PM_ID,
      companyId: company.id,
      email: "pm@demo.constructly.app",
      fullName: "Priya Nair",
      role: "PROJECT_MANAGER",
      status: "ACTIVE",
    },
  });

  console.log(`Seeded company "${company.name}" with 2 users.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
