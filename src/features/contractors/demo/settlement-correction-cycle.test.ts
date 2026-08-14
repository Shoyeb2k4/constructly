import { describe, it, expect, beforeEach } from "vitest";
import { demoContractorsRepository as contractors } from "./demo-repository";
import { demoLaborRepository as labor } from "@/features/labor/demo/demo-repository";
import { demoRepository as projects } from "@/features/projects/demo/demo-repository";

/**
 * The correction cycle, end to end on the demo stores.
 *
 * This is the walkthrough a reviewer clicks through in the browser, pinned as a
 * test so the numbers can't drift: settle → reverse → correct a mistyped
 * headcount → re-settle, with cash out never moving and the agreement-scoped
 * advance never being spent on labour that isn't attributed to it.
 */

const SKY = "10000000-0000-0000-0000-000000000001";
const PAPPU = "c-pappu";
const MASON = "65000000-0000-0000-0000-000000000005";

const L = (lakhs: number) => lakhs * 100_000 * 100; // ₹ lakh → paise

/** The seeded Pappu week: five consecutive days ending two days ago. */
const ymd = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const PERIOD = { periodStart: ymd(-6), periodEnd: ymd(0) };

/**
 * Force the demo stores to re-seed, then read each one so it materialises.
 * Projects matter here: Pappu's attendance is only attributed to him while he is
 * a configured contractor on Skyline.
 */
beforeEach(async () => {
  localStorage.clear();
  await projects.list({});
  await labor.getSheet(SKY, ymd(-2));
  await contractors.getLedger(PAPPU);
});

const balance = async () => (await contractors.getLedger(PAPPU)).contractor.advanceBalancePaise;

describe("settlement correction cycle (demo)", () => {
  it("seeds a ₹6,00,000 week and ₹7,00,000 of differently scoped advances", async () => {
    const preview = await contractors.previewSettlement({
      contractorId: PAPPU,
      projectId: SKY,
      ...PERIOD,
      advanceAdjustmentPaise: 0,
    });
    expect(preview.labourBillPaise).toBe(L(6));
    expect(preview.outstandingAdvancePaise).toBe(L(7));
  });

  it("offers only the project-scoped advance, and says why the rest is untouched", async () => {
    const preview = await contractors.previewSettlement({
      contractorId: PAPPU,
      projectId: SKY,
      ...PERIOD,
      advanceAdjustmentPaise: L(6),
    });
    // ₹5,00,000 is scoped to the Structure agreement, and this period's labour
    // isn't attributed to Structure — so it stays outstanding rather than being
    // spent on work it might have nothing to do with.
    expect(preview.maxAdjustmentPaise).toBe(L(2));
    expect(preview.advanceAdjustmentPaise).toBe(L(2));
    expect(preview.netPaymentPaise).toBe(L(4));

    const structure = preview.unusableAdvances.find((u) => u.contractId === "ag-structure");
    expect(structure?.remainingPaise).toBe(L(5));
    expect(structure?.reason).toMatch(/hasn't been attributed/);
  });

  it("settles, reverses, corrects and re-settles without moving cash out", async () => {
    // 1. Settle ₹6,00,000 — ₹2,00,000 from the advance, ₹4,00,000 in cash.
    const settlement = await contractors.createSettlement({
      contractorId: PAPPU,
      projectId: SKY,
      ...PERIOD,
      advanceAdjustmentPaise: L(2),
    });
    expect(settlement.labourBillPaise).toBe(L(6));
    expect(settlement.advanceAdjustmentPaise).toBe(L(2));
    expect(settlement.netPaymentPaise).toBe(L(4));
    // Only the Structure advance is left.
    expect(await balance()).toBe(L(5));

    // The settled week is now financially immutable.
    await expect(labor.setQuantity({ projectId: SKY, date: ymd(-2), subcategoryId: MASON, quantity: 80, contractorId: PAPPU })).rejects.toThrow(
      "ATTENDANCE_SETTLED",
    );

    // 2. Reverse it. The ₹4,00,000 already paid does NOT come back — it becomes
    // an unapplied advance, because the contractor is still holding it.
    const reversed = await contractors.reverseSettlement(settlement.id, "Wrong headcount on Friday");
    expect(reversed.reversedAt).toBeTruthy();
    expect(reversed.reversalReason).toBe("Wrong headcount on Friday");
    expect(await balance()).toBe(L(11)); // 5 + 2 restored + 4 unapplied

    // The settlement is kept, not deleted.
    const listed = await contractors.listSettlements({ contractorId: PAPPU });
    expect(listed.map((s) => s.id)).toContain(settlement.id);

    // 3. Correct the mistyped headcount: 180 masons recorded, 80 turned up.
    await labor.setQuantity({ projectId: SKY, date: ymd(-2), subcategoryId: MASON, quantity: 80, contractorId: PAPPU });

    // 4. Re-settle. The whole ₹5,00,000 is covered by advances; no new cash.
    const corrected = await contractors.previewSettlement({
      contractorId: PAPPU,
      projectId: SKY,
      ...PERIOD,
      advanceAdjustmentPaise: L(5),
    });
    expect(corrected.labourBillPaise).toBe(L(5));
    expect(corrected.maxAdjustmentPaise).toBe(L(5));

    const resettled = await contractors.createSettlement({
      contractorId: PAPPU,
      projectId: SKY,
      ...PERIOD,
      advanceAdjustmentPaise: L(5),
    });
    expect(resettled.netPaymentPaise).toBe(0);

    // ₹1,00,000 of project money left over, plus the untouched ₹5,00,000
    // Structure advance. Cash out across the whole cycle is still ₹6,00,000.
    expect(await balance()).toBe(L(6));
  });

  it("refuses to settle a period that overlaps a live settlement", async () => {
    await contractors.createSettlement({
      contractorId: PAPPU,
      projectId: SKY,
      ...PERIOD,
      advanceAdjustmentPaise: L(2),
    });
    await expect(
      contractors.createSettlement({
        contractorId: PAPPU,
        projectId: SKY,
        ...PERIOD,
        advanceAdjustmentPaise: 0,
      }),
    ).rejects.toThrow("SETTLEMENT_PERIOD_OVERLAPS");
  });

  it("refuses a reversal without a reason, and refuses to reverse twice", async () => {
    const s = await contractors.createSettlement({
      contractorId: PAPPU,
      projectId: SKY,
      ...PERIOD,
      advanceAdjustmentPaise: L(2),
    });
    await expect(contractors.reverseSettlement(s.id, "   ")).rejects.toThrow(
      "REVERSAL_REASON_REQUIRED",
    );
    await contractors.reverseSettlement(s.id, "Wrong headcount");
    await expect(contractors.reverseSettlement(s.id, "again")).rejects.toThrow(
      "SETTLEMENT_ALREADY_REVERSED",
    );
  });
});
