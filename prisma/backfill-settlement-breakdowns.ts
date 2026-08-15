// Backfill contractor_settlement_breakdowns for settlements created BEFORE the
// contractor-agreements migration.
//
// WHY THIS IS NEEDED
// reverseSettlement() reads the settlement-time breakdown and enforces two
// identities before it will touch any money:
//
//     restored + unapplied === labourBill        unapplied === netPayment
//
// `restored` is the sum of the ADJUSTMENT ledger entries the settlement drew
// from the advance; `unapplied` is the sum of net_payment_paise across the
// settlement's breakdown rows. Settlements written before the migration have no
// breakdown rows at all, so `unapplied` is 0 and any legacy settlement with a
// non-zero net payment fails with REVERSAL_IMBALANCE — it can never be reversed.
//
// WHAT THIS WRITES
// Exactly one row per legacy settlement, in the UNATTRIBUTED bucket
// (contract_id = NULL), carrying that settlement's own stored totals. That is
// the correct source: a pre-agreement settlement recognised attendance that had
// no agreement attribution, so the whole bill belongs in the NULL bucket. It
// deliberately does NOT reconstruct anything from today's labour_attendance —
// attribution can legitimately have changed since, and the settlement must
// reverse against the composition it actually used.
//
// SAFETY
//   • Preview by default. Writes only with --apply.
//   • Idempotent: a settlement that already has any breakdown row is skipped.
//   • Refuses to write a row that would not satisfy the reversal identities,
//     and reports it instead.
//   • Additive only: no UPDATE, no DELETE, no change to any existing row.
//
// Run:  npx tsx prisma/backfill-settlement-breakdowns.ts            # preview
//       npx tsx prisma/backfill-settlement-breakdowns.ts --apply    # write

import { randomUUID } from "node:crypto";
import { PrismaClient } from "../src/generated/prisma";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

type Verdict = "safe exact match" | "ambiguous" | "not eligible" | "already present";

const rupees = (paise: bigint) =>
  "₹" + (Number(paise) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });

async function main() {
  const settlements = await prisma.contractorSettlement.findMany({
    orderBy: { periodStart: "asc" },
    include: {
      contractor: { select: { name: true } },
      project: { select: { name: true } },
      breakdown: { select: { id: true } },
    },
  });

  let willWrite = 0;
  let blocked = 0;
  const rows: string[][] = [];

  for (const s of settlements) {
    // Cash the settlement drew from the contractor's advance.
    const drawdowns = await prisma.contractorLedgerEntry.aggregate({
      where: { settlementId: s.id, type: "ADJUSTMENT" },
      _sum: { amountPaise: true },
    });
    const restored = drawdowns._sum.amountPaise ?? BigInt(0);

    // Attendance that would have backed this settlement, for reporting only.
    const candidates = await prisma.labourAttendance.aggregate({
      where: {
        projectId: s.projectId,
        contractorId: s.contractorId,
        date: { gte: s.periodStart, lte: s.periodEnd },
      },
      _count: { _all: true },
      _sum: { estimatedCostPaise: true },
    });
    const computedBill = BigInt(candidates._sum.estimatedCostPaise ?? 0);

    // The identities reverseSettlement() will enforce once the row exists.
    const unapplied = s.netPaymentPaise;
    const identityA = restored + unapplied === s.labourBillPaise;
    const identityB = unapplied === s.netPaymentPaise; // true by construction
    const billMatches = computedBill === s.labourBillPaise;

    let verdict: Verdict;
    if (s.breakdown.length > 0) verdict = "already present";
    else if (!identityA || !identityB) verdict = "not eligible";
    else if (!billMatches) verdict = "ambiguous";
    else verdict = "safe exact match";

    if (verdict === "not eligible") blocked++;
    if (verdict === "ambiguous" || verdict === "safe exact match") willWrite++;

    rows.push([
      s.id.slice(0, 8),
      s.contractor.name.slice(0, 18),
      s.project.name.slice(0, 18),
      `${s.periodStart.toISOString().slice(0, 10)}→${s.periodEnd.toISOString().slice(0, 10)}`,
      rupees(s.labourBillPaise),
      rupees(computedBill),
      String(candidates._count._all),
      rupees(restored),
      rupees(s.netPaymentPaise),
      verdict,
    ]);

    if (APPLY && (verdict === "safe exact match" || verdict === "ambiguous")) {
      await prisma.contractorSettlementBreakdown.create({
        data: {
          id: randomUUID(),
          companyId: s.companyId,
          projectId: s.projectId,
          settlementId: s.id,
          contractId: null,
          labourBillPaise: s.labourBillPaise,
          advanceAdjustmentPaise: s.advanceAdjustmentPaise,
          netPaymentPaise: s.netPaymentPaise,
        },
      });
    }
  }

  const head = [
    "id", "contractor", "project", "period",
    "stored bill", "computed", "rows", "restored", "net", "verdict",
  ];
  const widths = head.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)),
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i])).join("  ");

  console.log(APPLY ? "\nAPPLYING backfill\n" : "\nPREVIEW ONLY — nothing written\n");
  console.log(line(head));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  rows.forEach((r) => console.log(line(r)));

  console.log(
    `\n${settlements.length} settlement(s): ${willWrite} would be written, ` +
      `${blocked} blocked, ${settlements.length - willWrite - blocked} already present.`,
  );
  if (blocked > 0) {
    console.log(
      "BLOCKED rows fail restored + net === bill. Their ledger drawdowns do not\n" +
        "reconcile with the stored settlement; they need manual review, and were\n" +
        "NOT written.",
    );
  }
  if (!APPLY && willWrite > 0) console.log("Re-run with --apply to write.");
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
