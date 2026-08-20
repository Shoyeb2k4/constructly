/**
 * Settled labour that no agreement has claimed.
 *
 * The Command Centre used to pass a literal `unattributedPaise={0}` while the
 * server already knew the real figure, so the UI could assert "₹0 unattributed"
 * over the top of a genuine amount. The number now comes from one place —
 * `bucketAttendance` — used by the production server, the demo repository and
 * these tests alike.
 *
 * The invariant under test throughout:
 *
 *   SETTLED = AGREEMENT-ATTRIBUTED + UNATTRIBUTED
 *
 * and, just as important, the thing that must NOT happen: unattributed labour
 * never leaks into an agreement's credit. Reconciliation does not guess which
 * agreement settled money belongs to — attributing it after the fact is a
 * governed correction, not a display decision.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  bucketAttendance,
  settledPaise,
  sumPositions,
  hasUnattributed,
  EMPTY_POSITION,
  type AttendanceBucketRow,
} from "./attendance-position";
import { demoContractsRepository as contracts } from "./demo/demo-repository";
import { demoLaborRepository as labor } from "@/features/labor/demo/demo-repository";
import { demoContractorsRepository as contractors } from "@/features/contractors/demo/demo-repository";
import { demoRepository as projects } from "@/features/projects/demo/demo-repository";

const L = (lakhs: number) => lakhs * 100_000 * 100;

const row = (
  paise: number,
  opts: { settled?: boolean; contract?: string | null } = {},
): AttendanceBucketRow => ({
  estimatedCostPaise: paise,
  settlementId: opts.settled ? "s1" : null,
  contractId: opts.contract ?? null,
});

/* ── The rule ───────────────────────────────────────────────────────────── */

describe("bucketing attendance", () => {
  it("puts every row in exactly one bucket", () => {
    const p = bucketAttendance([
      row(L(2)), // unsettled
      row(L(4), { settled: true, contract: "ag-structure" }), // settled + attributed
      row(L(2), { settled: true }), // settled + unattributed
    ]);
    expect(p).toEqual({
      unsettledPaise: L(2),
      settledAttributedPaise: L(4),
      settledUnattributedPaise: L(2),
    });
  });

  it("holds the invariant: settled = attributed + unattributed", () => {
    const p = bucketAttendance([
      row(L(4), { settled: true, contract: "ag-structure" }),
      row(L(2), { settled: true }),
      row(L(9), { settled: false }), // must not touch either settled bucket
    ]);
    expect(settledPaise(p)).toBe(L(6));
    expect(p.settledAttributedPaise + p.settledUnattributedPaise).toBe(settledPaise(p));
  });

  it("does NOT count unsettled labour as unattributed, however it is attributed", () => {
    const p = bucketAttendance([row(L(2)), row(L(3), { contract: "ag-structure" })]);
    expect(p.unsettledPaise).toBe(L(5));
    expect(p.settledUnattributedPaise).toBe(0);
    expect(p.settledAttributedPaise).toBe(0);
  });

  it("is empty for no rows, and reports nothing to warn about", () => {
    expect(bucketAttendance([])).toEqual(EMPTY_POSITION);
    expect(hasUnattributed(bucketAttendance([]))).toBe(false);
  });

  it("sums across projects bucket by bucket", () => {
    const a = bucketAttendance([row(L(2), { settled: true })]);
    const b = bucketAttendance([row(L(3), { settled: true }), row(L(1))]);
    expect(sumPositions([a, b])).toEqual({
      unsettledPaise: L(1),
      settledAttributedPaise: 0,
      settledUnattributedPaise: L(5),
    });
  });
});

/* ── End to end on the demo stores ──────────────────────────────────────── */

const SKY = "10000000-0000-0000-0000-000000000001";
const PAPPU = "c-pappu";
const STRUCTURE = "ag-structure";
const MASON = "65000000-0000-0000-0000-000000000005";
const MAIN_CARPENTER = "65000000-0000-0000-0000-000000000001";

/** Ramesh supplies Main Carpenter on Skyline and holds NO agreement. */
const RAMESH = "c-ramesh";

beforeEach(async () => {
  localStorage.clear();
  await projects.list({});
  await contracts.listContracts();
  await contracts.listScopeItems(STRUCTURE);
  await contractors.listContractors();
  await labor.getSheet(SKY, "2026-06-15");
});

const positionFor = async (contractorId: string) =>
  (await contracts.getContractorProfile(contractorId))!.attendanceTotals;

const mark = (
  contractorId: string,
  date: string,
  subcategoryId: string,
  quantity: number,
  contractId: string | null,
) =>
  labor.setQuantity({ projectId: SKY, date, subcategoryId, quantity, contractorId, contractId });

describe("a contractor with no agreement at all", () => {
  it("reports settled labour as unattributed — it has nowhere else to belong", async () => {
    await mark(RAMESH, "2026-06-15", MAIN_CARPENTER, 4, null);
    const before = await positionFor(RAMESH);
    expect(before.settledUnattributedPaise).toBe(0);
    expect(before.unsettledPaise).toBeGreaterThan(0);
    const recorded = before.unsettledPaise;

    await contractors.createSettlement({
      contractorId: RAMESH,
      projectId: SKY,
      periodStart: "2026-06-15",
      periodEnd: "2026-06-15",
      advanceAdjustmentPaise: 0,
    });

    const after = await positionFor(RAMESH);
    expect(after.settledUnattributedPaise).toBe(recorded);
    expect(after.unsettledPaise).toBe(0);
    expect(after.settledAttributedPaise).toBe(0);
  });

  it("still appears in the profile even though `projects` is empty", async () => {
    await mark(RAMESH, "2026-06-15", MAIN_CARPENTER, 4, null);
    const profile = (await contracts.getContractorProfile(RAMESH))!;
    // No agreements → no project GROUPS, but the labour position is still there.
    expect(profile.projects).toHaveLength(0);
    expect(profile.attendance.length).toBeGreaterThan(0);
    expect(profile.attendance[0].projectId).toBe(SKY);
  });
});

describe("attributed and unattributed labour side by side", () => {
  /** Structure-attributed labour plus unattributed labour, both settled. */
  const setup = async () => {
    await mark(PAPPU, "2026-06-15", MASON, 4, STRUCTURE); // attributed
    await mark(PAPPU, "2026-06-15", MAIN_CARPENTER, 2, null); // unattributed
    const before = await positionFor(PAPPU);
    await contractors.createSettlement({
      contractorId: PAPPU,
      projectId: SKY,
      periodStart: "2026-06-15",
      periodEnd: "2026-06-15",
      advanceAdjustmentPaise: 0,
    });
    return before;
  };

  it("splits them, and the two settled buckets add to the settled total", async () => {
    await setup();
    const p = await positionFor(PAPPU);
    expect(p.settledAttributedPaise).toBeGreaterThan(0);
    expect(p.settledUnattributedPaise).toBeGreaterThan(0);
    expect(settledPaise(p)).toBe(p.settledAttributedPaise + p.settledUnattributedPaise);
  });

  it("does NOT give the unattributed part to the agreement as credit", async () => {
    // The seeded agreement already carries settled attendance, so the claim is
    // about the DELTA this settlement produces, not the absolute totals.
    const creditBefore = (await contracts.getContract(STRUCTURE))!.contract.reconciliation
      .attendanceCreditPaise;
    const posBefore = await positionFor(PAPPU);

    await setup();

    const creditAfter = (await contracts.getContract(STRUCTURE))!.contract.reconciliation
      .attendanceCreditPaise;
    const posAfter = await positionFor(PAPPU);

    const creditDelta = creditAfter - creditBefore;
    const attributedDelta = posAfter.settledAttributedPaise - posBefore.settledAttributedPaise;
    const unattributedDelta =
      posAfter.settledUnattributedPaise - posBefore.settledUnattributedPaise;

    expect(unattributedDelta).toBeGreaterThan(0);
    // The agreement gained EXACTLY its own attendance — not a rupee of the
    // unattributed labour settled in the very same settlement.
    expect(creditDelta).toBe(attributedDelta);
    expect(creditDelta).not.toBe(attributedDelta + unattributedDelta);
  });
});

describe("settlement reversal", () => {
  it("moves the value back out of settled-unattributed and into unsettled", async () => {
    await mark(RAMESH, "2026-06-15", MAIN_CARPENTER, 4, null);
    const recorded = (await positionFor(RAMESH)).unsettledPaise;

    const settlement = await contractors.createSettlement({
      contractorId: RAMESH,
      projectId: SKY,
      periodStart: "2026-06-15",
      periodEnd: "2026-06-15",
      advanceAdjustmentPaise: 0,
    });
    expect((await positionFor(RAMESH)).settledUnattributedPaise).toBe(recorded);

    await contractors.reverseSettlement(settlement.id, "Wrong headcount");

    const after = await positionFor(RAMESH);
    expect(after.settledUnattributedPaise).toBe(0);
    expect(after.unsettledPaise).toBe(recorded);
    // The settlement itself survives, struck through — history is not deleted.
    const settlements = await contractors.listSettlements({ contractorId: RAMESH });
    expect(settlements.find((s) => s.id === settlement.id)?.reversedAt).toBeTruthy();
  });
});

/* ── Things that must NOT move the figure ───────────────────────────────── */

describe("operations that leave unattributed labour alone", () => {
  const settleUnattributed = async () => {
    await mark(RAMESH, "2026-06-15", MAIN_CARPENTER, 4, null);
    await contractors.createSettlement({
      contractorId: RAMESH,
      projectId: SKY,
      periodStart: "2026-06-15",
      periodEnd: "2026-06-15",
      advanceAdjustmentPaise: 0,
    });
    return (await positionFor(RAMESH)).settledUnattributedPaise;
  };

  it("archiving and restoring the contractor changes nothing", async () => {
    const before = await settleUnattributed();
    expect(before).toBeGreaterThan(0);

    await contractors.archiveContractor(RAMESH);
    expect((await positionFor(RAMESH)).settledUnattributedPaise).toBe(before);

    await contractors.restoreContractor(RAMESH);
    expect((await positionFor(RAMESH)).settledUnattributedPaise).toBe(before);
  });

  it("a rate revision does not reprice it — the snapshot is what was settled", async () => {
    await mark(PAPPU, "2026-06-15", MASON, 4, STRUCTURE);
    await mark(PAPPU, "2026-06-15", MAIN_CARPENTER, 2, null);
    await contractors.createSettlement({
      contractorId: PAPPU,
      projectId: SKY,
      periodStart: "2026-06-15",
      periodEnd: "2026-06-15",
      advanceAdjustmentPaise: 0,
    });
    const before = await positionFor(PAPPU);

    await contracts.setScopeRate({
      scopeItemId: "si-mason",
      ratePaise: 99_000,
      rateUnit: "day",
      effectiveFrom: "2026-06-01",
      reason: "Annual rate revision",
    });

    const after = await positionFor(PAPPU);
    expect(after.settledUnattributedPaise).toBe(before.settledUnattributedPaise);
    expect(after.settledAttributedPaise).toBe(before.settledAttributedPaise);
  });

  it("an agreement payment and its reversal change nothing", async () => {
    await mark(PAPPU, "2026-06-15", MAIN_CARPENTER, 2, null);
    await contractors.createSettlement({
      contractorId: PAPPU,
      projectId: SKY,
      periodStart: "2026-06-15",
      periodEnd: "2026-06-15",
      advanceAdjustmentPaise: 0,
    });
    const before = await positionFor(PAPPU);

    await contracts.recordContractPayment({
      contractId: STRUCTURE,
      date: "2026-06-16",
      amountPaise: L(1),
      type: "INTERIM",
      paymentMode: "BANK_TRANSFER",
    });
    expect((await positionFor(PAPPU)).settledUnattributedPaise).toBe(
      before.settledUnattributedPaise,
    );

    const detail = (await contracts.getContract(STRUCTURE))!;
    const newest = detail.payments.find((x) => x.amountPaise === L(1))!;
    await contracts.reverseContractPayment(newest.id, "Duplicate entry");
    expect((await positionFor(PAPPU)).settledUnattributedPaise).toBe(
      before.settledUnattributedPaise,
    );
  });

  it("cancelling the agreement does not turn its attributed labour unattributed", async () => {
    await mark(PAPPU, "2026-06-15", MASON, 4, STRUCTURE);
    await contractors.createSettlement({
      contractorId: PAPPU,
      projectId: SKY,
      periodStart: "2026-06-15",
      periodEnd: "2026-06-15",
      advanceAdjustmentPaise: 0,
    });
    const before = await positionFor(PAPPU);
    expect(before.settledAttributedPaise).toBeGreaterThan(0);

    await contracts.cancelContract(STRUCTURE, "Work not going ahead");

    // Attribution is historical PROVENANCE: the row still says which agreement
    // it was recorded against, whatever that agreement's status became.
    const after = await positionFor(PAPPU);
    expect(after.settledAttributedPaise).toBe(before.settledAttributedPaise);
    expect(after.settledUnattributedPaise).toBe(before.settledUnattributedPaise);
  });
});
