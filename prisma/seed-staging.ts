/**
 * Staging fixture for WRITE-PATH acceptance testing.
 *
 * Deliberately separate from `seed.ts`, which exists to make demo mode and a
 * real database agree and seeds only a company and two users. This one exists to
 * make the destructive tests possible, which needs rather more:
 *
 *  - TWO companies, because tenant isolation cannot be tested from inside one.
 *    Everything in Northgate is a control: no test may ever reach it, and any
 *    row that appears there is a leak.
 *  - REAL ROLES from the code catalogue (`SYSTEM_ROLES`), not hand-written
 *    permission lists. `resolveSessionUser` reads roles from the database, so a
 *    fixture that invents its own would test a permission model the application
 *    does not have.
 *  - A RESTRICTED user alongside the owner, because "RBAC enforcement on write
 *    actions" means proving a write is REFUSED, which needs someone to refuse.
 *  - Enough operational scaffolding — projects, contractors, labour groups and
 *    types, project↔contractor assignments and rates — that attendance,
 *    advances and settlements have something to act on.
 *
 * What it deliberately does NOT create: ledger entries, attendance, settlements,
 * payments, purchase orders. Those are what the acceptance tests write. Seeding
 * them would mean testing against numbers this file chose rather than numbers
 * the application produced.
 *
 * NEVER RUN AGAINST PRODUCTION. The guard below refuses any database whose host
 * is the production project ref.
 */
import { PrismaClient } from "../src/generated/prisma";
import { SYSTEM_ROLES } from "../src/features/rbac/roles";

const PRODUCTION_REF = "rbteppevgibwddihqcpf";

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "";
if (url.includes(PRODUCTION_REF)) {
  console.error(
    `\nREFUSING TO RUN.\n\n` +
      `DIRECT_URL/DATABASE_URL points at the PRODUCTION project (${PRODUCTION_REF}).\n` +
      `This fixture creates and destroys data and must only ever touch staging.\n`,
  );
  process.exit(1);
}
if (!url) {
  console.error("No DIRECT_URL/DATABASE_URL set — refusing to guess a target.");
  process.exit(1);
}

const prisma = new PrismaClient();

/* Stable ids so a re-run is idempotent and so the acceptance checklist can name
 * exact rows. Distinct prefixes make a leak obvious at a glance: anything
 * beginning 5efa… belongs to Northgate and must never appear in a Meridian
 * screen. */
/**
 * USER IDS COME FROM SUPABASE AUTH, NOT FROM HERE.
 *
 * `resolveSessionUser(authUserId)` looks the application user up BY THE AUTH
 * ID — `prisma.user.findUnique({ where: { id: authUserId } })`. So an app row
 * whose id does not equal the `auth.users` id resolves to no session at all,
 * and a perfectly valid sign-in lands on NO_WORKSPACE.
 *
 * Supabase's admin API assigns the id when it creates the auth user, so the
 * order is: create auth users → capture their ids → seed with those ids.
 * `scripts/staging-provision.mjs` does that and passes them in here. The
 * fallbacks below exist only so this file can be run standalone against a bare
 * database for schema work; nobody can sign in as those.
 */
function authId(envVar: string, fallback: string): string {
  const value = process.env[envVar];
  if (value && value.trim()) return value.trim();
  return fallback;
}

const A = {
  company: "5aa00000-0000-4000-8000-00000000c0a1",
  owner: authId("STAGING_OWNER_A_ID", "5aa00000-0000-4000-8000-000000000001"),
  engineer: authId("STAGING_ENGINEER_A_ID", "5aa00000-0000-4000-8000-000000000002"),
  projectAlpha: "5aa00000-0000-4000-8000-00000000f001",
  projectBeta: "5aa00000-0000-4000-8000-00000000f002",
  contractorRaju: "5aa00000-0000-4000-8000-00000000c001",
  contractorIqbal: "5aa00000-0000-4000-8000-00000000c002",
  categoryMasonry: "5aa00000-0000-4000-8000-00000000a001",
  categorySteel: "5aa00000-0000-4000-8000-00000000a002",
  subMason: "5aa00000-0000-4000-8000-00000000b001",
  subHelper: "5aa00000-0000-4000-8000-00000000b002",
  subFitter: "5aa00000-0000-4000-8000-00000000b003",
};

const B = {
  company: "5efa0000-0000-4000-8000-00000000c0b1",
  owner: authId("STAGING_OWNER_B_ID", "5efa0000-0000-4000-8000-000000000001"),
  project: "5efa0000-0000-4000-8000-00000000f001",
  contractor: "5efa0000-0000-4000-8000-00000000c001",
  category: "5efa0000-0000-4000-8000-00000000a001",
  sub: "5efa0000-0000-4000-8000-00000000b001",
};

/** Emails are also the staging sign-in identities; see scripts/staging-provision.mjs. */
export const STAGING_USERS = {
  ownerA: "owner@staging.constructly.app",
  engineerA: "engineer@staging.constructly.app",
  ownerB: "owner.northgate@staging.constructly.app",
} as const;

/**
 * Create the company's system roles from the code catalogue, exactly as the
 * application's own reconciler does. Returns the role ids by key.
 */
async function seedRoles(companyId: string): Promise<Record<string, string>> {
  const byKey: Record<string, string> = {};
  for (const def of SYSTEM_ROLES) {
    const role = await prisma.companyRole.upsert({
      where: { companyId_name: { companyId, name: def.name } },
      update: { permissions: def.permissions, isOwner: def.isOwner ?? false, isSystem: true },
      create: {
        companyId,
        key: def.key,
        name: def.name,
        description: def.description,
        isSystem: true,
        isOwner: def.isOwner ?? false,
        permissions: def.permissions,
      },
    });
    byKey[def.key] = role.id;
  }
  return byKey;
}

async function seedUser(opts: {
  id: string;
  companyId: string;
  email: string;
  fullName: string;
  legacyRole: "OWNER" | "PROJECT_MANAGER";
  roleId: string;
}) {
  await prisma.user.upsert({
    where: { id: opts.id },
    update: { companyRoleId: opts.roleId, status: "ACTIVE" },
    create: {
      id: opts.id,
      companyId: opts.companyId,
      email: opts.email,
      fullName: opts.fullName,
      role: opts.legacyRole,
      status: "ACTIVE",
      companyRoleId: opts.roleId,
    },
  });
  // The junction is what resolveSessionUser reads first.
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: opts.id, roleId: opts.roleId } },
    update: { isPrimary: true },
    create: {
      companyId: opts.companyId,
      userId: opts.id,
      roleId: opts.roleId,
      isPrimary: true,
    },
  });
}

async function main() {
  console.log(`Seeding STAGING fixtures…\n`);

  if (!process.env.STAGING_OWNER_A_ID) {
    console.warn(
      "WARNING: no STAGING_*_ID supplied, so placeholder user ids are being used.\n" +
        "         Nobody will be able to SIGN IN to this data — run through\n" +
        "         scripts/staging-provision.mjs to create real auth users.\n",
    );
  }

  /* ── Company A: Meridian Build Co. — the system under test ───────────── */

  await prisma.company.upsert({
    where: { id: A.company },
    update: {},
    create: {
      id: A.company,
      name: "Meridian Build Co.",
      gstin: "29ABCDE1234F1Z5",
      settings: { poApprovalRequired: true, currency: "INR" },
    },
  });

  const rolesA = await seedRoles(A.company);

  await seedUser({
    id: A.owner,
    companyId: A.company,
    email: STAGING_USERS.ownerA,
    fullName: "Aarav Mehta",
    legacyRole: "OWNER",
    roleId: rolesA.owner,
  });

  // Site Engineer: 5 permissions. The point of this user is what it CANNOT do —
  // no settlements, no advances, no PO approval.
  await seedUser({
    id: A.engineer,
    companyId: A.company,
    email: STAGING_USERS.engineerA,
    fullName: "Rohit Kulkarni",
    legacyRole: "PROJECT_MANAGER",
    roleId: rolesA.site_engineer,
  });

  for (const [id, code, name, budgetCr] of [
    [A.projectAlpha, "MB-ALPHA", "Alpha Residency", 12],
    [A.projectBeta, "MB-BETA", "Beta Commercial Park", 8],
  ] as const) {
    await prisma.project.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId: A.company,
        code,
        name,
        type: "RESIDENTIAL",
        stage: "CONSTRUCTION",
        // Rupees → paise. Written with BigInt() rather than a `1n` literal
        // because tsconfig targets ES2017, where BigInt literals are a syntax
        // error even though the runtime supports them.
        budgetPaise: BigInt(budgetCr) * BigInt(10_000_000) * BigInt(100),
        createdById: A.owner,
        pmId: A.owner,
      },
    });
  }

  for (const [id, name, phone] of [
    [A.contractorRaju, "Raju Masonry Works", "+91 98200 11111"],
    [A.contractorIqbal, "Iqbal Steel Fitters", "+91 98200 22222"],
  ] as const) {
    await prisma.contractor.upsert({
      where: { id },
      update: {},
      create: { id, companyId: A.company, name, phone, status: "ACTIVE" },
    });
  }

  for (const [id, name, order] of [
    [A.categoryMasonry, "Masonry", 0],
    [A.categorySteel, "Steel", 1],
  ] as const) {
    await prisma.labourCategory.upsert({
      where: { id },
      update: {},
      create: { id, companyId: A.company, name, displayOrder: order },
    });
  }

  for (const [id, categoryId, name, rate, order] of [
    [A.subMason, A.categoryMasonry, "Mason", 90_000, 0],
    [A.subHelper, A.categoryMasonry, "Helper", 55_000, 1],
    [A.subFitter, A.categorySteel, "Fitter", 85_000, 0],
  ] as const) {
    await prisma.labourSubcategory.upsert({
      where: { id },
      update: {},
      create: {
        id,
        companyId: A.company,
        categoryId,
        name,
        dailyRatePaise: rate,
        displayOrder: order,
      },
    });
  }

  // Attendance needs a contractor assigned to the project FOR A CATEGORY, plus a
  // per-subcategory rate. Without both, the attendance sheet has no rows to
  // write and the write test cannot start.
  const assignments = [
    { contractorId: A.contractorRaju, projectId: A.projectAlpha, categoryId: A.categoryMasonry },
    { contractorId: A.contractorIqbal, projectId: A.projectAlpha, categoryId: A.categorySteel },
    { contractorId: A.contractorRaju, projectId: A.projectBeta, categoryId: A.categoryMasonry },
  ];

  for (const a of assignments) {
    const existing = await prisma.projectContractorAssignment.findFirst({
      where: {
        projectId: a.projectId,
        contractorId: a.contractorId,
        labourCategoryId: a.categoryId,
      },
    });
    if (!existing) {
      await prisma.projectContractorAssignment.create({
        data: {
          companyId: A.company,
          projectId: a.projectId,
          contractorId: a.contractorId,
          labourCategoryId: a.categoryId,
        },
      });
    }

    let pc = await prisma.projectContractor.findFirst({
      where: { projectId: a.projectId, contractorId: a.contractorId },
    });
    pc ??= await prisma.projectContractor.create({
      data: { companyId: A.company, projectId: a.projectId, contractorId: a.contractorId },
    });

    const subs = a.categoryId === A.categoryMasonry ? [A.subMason, A.subHelper] : [A.subFitter];
    for (const subId of subs) {
      const sub = await prisma.labourSubcategory.findUniqueOrThrow({ where: { id: subId } });
      const rate = await prisma.projectContractorLabourRate.findFirst({
        where: { projectContractorId: pc.id, labourSubcategoryId: subId },
      });
      if (!rate) {
        await prisma.projectContractorLabourRate.create({
          data: {
            companyId: A.company,
            projectContractorId: pc.id,
            labourSubcategoryId: subId,
            ratePaise: sub.dailyRatePaise ?? 80_000,
            rateUnit: "day",
          },
        });
      }
    }
  }

  /* ── Company B: Northgate — the isolation control ────────────────────── */

  await prisma.company.upsert({
    where: { id: B.company },
    update: {},
    create: {
      id: B.company,
      name: "Northgate Infra Pvt Ltd",
      settings: { currency: "INR" },
    },
  });

  const rolesB = await seedRoles(B.company);

  await seedUser({
    id: B.owner,
    companyId: B.company,
    email: STAGING_USERS.ownerB,
    fullName: "Kavita Rao",
    legacyRole: "OWNER",
    roleId: rolesB.owner,
  });

  await prisma.project.upsert({
    where: { id: B.project },
    update: {},
    create: {
      id: B.project,
      companyId: B.company,
      code: "NG-ONE",
      name: "Northgate Tower One",
      type: "COMMERCIAL",
      stage: "CONSTRUCTION",
      budgetPaise: BigInt(50_000_000_00),
      createdById: B.owner,
      pmId: B.owner,
    },
  });

  await prisma.contractor.upsert({
    where: { id: B.contractor },
    update: {},
    create: {
      id: B.contractor,
      companyId: B.company,
      name: "Northgate Civil Crew",
      status: "ACTIVE",
    },
  });

  await prisma.labourCategory.upsert({
    where: { id: B.category },
    update: {},
    create: { id: B.category, companyId: B.company, name: "Civil", displayOrder: 0 },
  });

  await prisma.labourSubcategory.upsert({
    where: { id: B.sub },
    update: {},
    create: {
      id: B.sub,
      companyId: B.company,
      categoryId: B.category,
      name: "Civil Worker",
      dailyRatePaise: 70_000,
      displayOrder: 0,
    },
  });

  /* ── Report ─────────────────────────────────────────────────────────── */

  const counts = {
    companies: await prisma.company.count(),
    roles: await prisma.companyRole.count(),
    users: await prisma.user.count(),
    projects: await prisma.project.count(),
    contractors: await prisma.contractor.count(),
    labourTypes: await prisma.labourSubcategory.count(),
    rates: await prisma.projectContractorLabourRate.count(),
    // Must all be zero: the tests create these, not this file.
    ledger: await prisma.contractorLedgerEntry.count(),
    attendance: await prisma.labourAttendance.count(),
    settlements: await prisma.contractorSettlement.count(),
    purchaseOrders: await prisma.purchaseOrder.count(),
  };

  console.log("Seeded:");
  for (const [k, v] of Object.entries(counts)) {
    console.log(`  ${k.padEnd(16)} ${v}`);
  }
  console.log(
    `\nSign-in identities:\n` +
      `  ${STAGING_USERS.ownerA.padEnd(42)} Owner, Meridian (all permissions)\n` +
      `  ${STAGING_USERS.engineerA.padEnd(42)} Site Engineer, Meridian (restricted)\n` +
      `  ${STAGING_USERS.ownerB.padEnd(42)} Owner, Northgate (isolation control)\n`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
