/**
 * P0 regression — a REVERSED settlement must contribute to nothing.
 *
 * The contractor cost summary is an authoritative aggregate: it drives the
 * Reports menu on the Contractors page and both the Excel and PDF "Cost summary"
 * exports that leave the building. It previously summed EVERY settlement,
 * reversed ones included, so a single governed correction permanently overstated
 * a contractor's lifetime labour bill, advance adjustment and cash paid.
 *
 * Exercised through the demo repository because that runs the real create →
 * reverse cycle (the server's arithmetic lives in the same shared calc module),
 * so this pins BEHAVIOUR rather than a query shape. The companion test in
 * server/cost-summary.test.ts pins the server's filter itself.
 *
 * Figures are asserted as DELTAS against the seeded baseline, so the test says
 * what the cycle does rather than what the fixture happens to contain.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { demoContractorsRepository as contractors } from "./demo/demo-repository";
import { demoLaborRepository as labor } from "@/features/labor/demo/demo-repository";
import { demoRepository as projects } from "@/features/projects/demo/demo-repository";

const SKY = "10000000-0000-0000-0000-000000000001";
const PAPPU = "c-pappu";

const L = (lakhs: number) => lakhs * 100_000 * 100;

const ymd = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const PERIOD = { periodStart: ymd(-6), periodEnd: ymd(0) };

beforeEach(async () => {
  localStorage.clear();
  await projects.list({});
  await labor.getSheet(SKY, ymd(-2));
  await contractors.getLedger(PAPPU);
});

/** Pappu's row in the cost summary. */
async function row() {
  const rows = await contractors.contractorCostSummary();
  const mine = rows.find((r) => r.contractorId === PAPPU);
  if (!mine) throw new Error("Pappu missing from the cost summary");
  return mine;
}

describe("contractor cost summary — reversed settlements", () => {
  it("counts a live settlement, then stops counting it once reversed", async () => {
    const before = await row();

    // 1. An ACTIVE settlement contributes to every aggregate.
    const settlement = await contractors.createSettlement({
      contractorId: PAPPU,
      projectId: SKY,
      ...PERIOD,
      advanceAdjustmentPaise: L(2),
    });
    expect(settlement.labourBillPaise).toBe(L(6));
    expect(settlement.advanceAdjustmentPaise).toBe(L(2));
    expect(settlement.netPaymentPaise).toBe(L(4));

    const live = await row();
    expect(live.totalBillPaise - before.totalBillPaise).toBe(L(6));
    expect(live.totalAdjustedPaise - before.totalAdjustedPaise).toBe(L(2));
    expect(live.totalPaidPaise - before.totalPaidPaise).toBe(L(4));
    expect(live.settlementCount - before.settlementCount).toBe(1);

    // 2. Reverse it — a governed correction, not a deletion.
    await contractors.reverseSettlement(settlement.id, "Wrong headcount on Friday");

    // 3. It now contributes to NOTHING: the aggregates return to the baseline.
    const after = await row();
    expect(after.totalBillPaise).toBe(before.totalBillPaise);
    expect(after.totalAdjustedPaise).toBe(before.totalAdjustedPaise);
    expect(after.totalPaidPaise).toBe(before.totalPaidPaise);
    expect(after.settlementCount).toBe(before.settlementCount);
  });

  it("keeps the reversed settlement itself intact and auditable", async () => {
    const settlement = await contractors.createSettlement({
      contractorId: PAPPU,
      projectId: SKY,
      ...PERIOD,
      advanceAdjustmentPaise: L(2),
    });
    await contractors.reverseSettlement(settlement.id, "Wrong headcount on Friday");

    const listed = await contractors.listSettlements({ contractorId: PAPPU });
    const kept = listed.find((s) => s.id === settlement.id);

    // The record survives with its ORIGINAL figures — excluding it from an
    // aggregate must never mean editing or deleting the history.
    expect(kept).toBeDefined();
    expect(kept!.labourBillPaise).toBe(L(6));
    expect(kept!.advanceAdjustmentPaise).toBe(L(2));
    expect(kept!.netPaymentPaise).toBe(L(4));
    expect(kept!.reversedAt).toBeTruthy();
    expect(kept!.reversalReason).toBe("Wrong headcount on Friday");
  });

  it("still counts a re-settlement recorded after the reversal", async () => {
    const before = await row();

    const first = await contractors.createSettlement({
      contractorId: PAPPU,
      projectId: SKY,
      ...PERIOD,
      advanceAdjustmentPaise: L(2),
    });
    await contractors.reverseSettlement(first.id, "Wrong headcount on Friday");

    // The corrected settlement is live, so it counts — exactly once.
    const second = await contractors.createSettlement({
      contractorId: PAPPU,
      projectId: SKY,
      ...PERIOD,
      advanceAdjustmentPaise: L(6),
    });

    const after = await row();
    expect(after.totalBillPaise - before.totalBillPaise).toBe(second.labourBillPaise);
    expect(after.totalPaidPaise - before.totalPaidPaise).toBe(second.netPaymentPaise);
    expect(after.settlementCount - before.settlementCount).toBe(1);
  });
});
