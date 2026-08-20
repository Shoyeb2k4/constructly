/**
 * Governed correction of settled attendance attribution, end to end.
 *
 * The invariant this whole file defends:
 *
 *   ATTRIBUTION MOVES A LABEL, NOT MONEY.
 *
 * Settled labour that carried no agreement gets one. The agreement's attendance
 * credit rises by exactly that amount and the unattributed figure falls by
 * exactly that amount — and NOTHING else moves: not the cash, not the ledger,
 * not a single advance drawdown, not the settlement, not its frozen breakdown,
 * not the rate snapshot on the row.
 *
 * The last of those is the subtle one. Reversal reads the settlement-time
 * breakdown rather than today's attendance, precisely so that a later
 * re-attribution cannot mis-attribute historical cash. So a settlement reversed
 * AFTER a correction must still balance — that is the test that proves the
 * design, and it is at the bottom of this file.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { demoContractsRepository as contracts } from "./demo/demo-repository";
import { demoContractorsRepository as contractors } from "@/features/contractors/demo/demo-repository";
import { demoLaborRepository as labor } from "@/features/labor/demo/demo-repository";
import { demoRepository as projects } from "@/features/projects/demo/demo-repository";

const SKY = "10000000-0000-0000-0000-000000000001";
const PAPPU = "c-pappu";
const STRUCTURE = "ag-structure";
const WALL = "ag-compound-wall";
const MASON = "65000000-0000-0000-0000-000000000005";
const MAIN_CARPENTER = "65000000-0000-0000-0000-000000000001";
const DATE = "2026-06-15";

beforeEach(async () => {
  localStorage.clear();
  await projects.list({});
  await contracts.listContracts();
  await contracts.listScopeItems(STRUCTURE);
  await contractors.listContractors();
  await labor.getSheet(SKY, DATE);
});

const attendance = () =>
  JSON.parse(localStorage.getItem("constructly.demo.labourAttendance.v2") ?? "[]") as Record<
    string,
    unknown
  >[];
const ledger = () => JSON.parse(localStorage.getItem("constructly.demo.contractorLedger.v1") ?? "[]");
const settlements = () =>
  JSON.parse(localStorage.getItem("constructly.demo.contractorSettlements.v1") ?? "[]");

const recon = async (id: string) => (await contracts.getContract(id))!.contract.reconciliation;
const position = async () => (await contracts.getContractorProfile(PAPPU))!.attendanceTotals;

/** Record unattributed labour for Pappu and settle it. */
async function settledUnattributed(quantity = 4, date = DATE) {
  await labor.setQuantity({
    projectId: SKY,
    date,
    subcategoryId: MAIN_CARPENTER,
    quantity,
    contractorId: PAPPU,
    contractId: null,
  });
  await contractors.createSettlement({
    contractorId: PAPPU,
    projectId: SKY,
    periodStart: date,
    periodEnd: date,
    advanceAdjustmentPaise: 0,
  });
  return contracts.listAttributableLabour(PAPPU, SKY);
}

const apply = (ids: string[], contractId = STRUCTURE, reason = "Labour belonged to this agreement") =>
  contracts.attributeSettledLabour({
    contractorId: PAPPU,
    projectId: SKY,
    contractId,
    attendanceIds: ids,
    reason,
  });

/* ── The list ───────────────────────────────────────────────────────────── */

describe("what can be attributed", () => {
  it("lists settled labour that carries no agreement", async () => {
    const rows = await settledUnattributed();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({ labourTypeName: "Main Carpenter" });
    expect(rows[0].settlementPeriod).toContain(DATE);
  });

  it("excludes UNSETTLED labour — that is editable on the attendance sheet", async () => {
    await labor.setQuantity({
      projectId: SKY,
      date: DATE,
      subcategoryId: MAIN_CARPENTER,
      quantity: 3,
      contractorId: PAPPU,
      contractId: null,
    });
    expect(await contracts.listAttributableLabour(PAPPU, SKY)).toEqual([]);
  });

  it("excludes labour already attributed to an agreement", async () => {
    await labor.setQuantity({
      projectId: SKY,
      date: DATE,
      subcategoryId: MASON,
      quantity: 2,
      contractorId: PAPPU,
      contractId: STRUCTURE,
    });
    await contractors.createSettlement({
      contractorId: PAPPU,
      projectId: SKY,
      periodStart: DATE,
      periodEnd: DATE,
      advanceAdjustmentPaise: 0,
    });
    const rows = await contracts.listAttributableLabour(PAPPU, SKY);
    expect(rows.every((r) => r.labourTypeName !== "Mason")).toBe(true);
  });
});

/* ── The correction ─────────────────────────────────────────────────────── */

describe("attributing settled labour", () => {
  it("moves exactly the selected value into the agreement's attendance credit", async () => {
    const rows = await settledUnattributed();
    const value = rows[0].estimatedCostPaise;

    const creditBefore = (await recon(STRUCTURE)).attendanceCreditPaise;
    const unattributedBefore = (await position()).settledUnattributedPaise;

    const res = await apply([rows[0].id]);
    expect("blockers" in res).toBe(false);

    expect((await recon(STRUCTURE)).attendanceCreditPaise).toBe(creditBefore + value);
    expect((await position()).settledUnattributedPaise).toBe(unattributedBefore - value);
  });

  it("keeps total settled labour identical — nothing was created or destroyed", async () => {
    const rows = await settledUnattributed();
    const before = await position();
    await apply([rows[0].id]);
    const after = await position();

    const settledBefore = before.settledAttributedPaise + before.settledUnattributedPaise;
    const settledAfter = after.settledAttributedPaise + after.settledUnattributedPaise;
    expect(settledAfter).toBe(settledBefore);
    expect(after.unsettledPaise).toBe(before.unsettledPaise);
  });

  it("handles several rows at once, all or nothing", async () => {
    await settledUnattributed(4, "2026-06-15");
    await settledUnattributed(2, "2026-06-16");
    const rows = await contracts.listAttributableLabour(PAPPU, SKY);
    expect(rows).toHaveLength(2);

    const total = rows.reduce((t, r) => t + r.estimatedCostPaise, 0);
    const creditBefore = (await recon(STRUCTURE)).attendanceCreditPaise;

    await apply(rows.map((r) => r.id));
    expect((await recon(STRUCTURE)).attendanceCreditPaise).toBe(creditBefore + total);
    expect(await contracts.listAttributableLabour(PAPPU, SKY)).toEqual([]);
  });

  it("does not change ANY other agreement's credit", async () => {
    const rows = await settledUnattributed();
    const wallBefore = (await recon(WALL)).attendanceCreditPaise;
    await apply([rows[0].id]);
    expect((await recon(WALL)).attendanceCreditPaise).toBe(wallBefore);
  });

  it("requires a reason", async () => {
    const rows = await settledUnattributed();
    const res = await apply([rows[0].id], STRUCTURE, "   ");
    expect(res).toMatchObject({ blockers: ["REASON_REQUIRED"] });
  });
});

/* ── Money must not move ────────────────────────────────────────────────── */

describe("nothing financial moves", () => {
  it("leaves the ledger, the settlement and the rate snapshot byte-identical", async () => {
    const rows = await settledUnattributed();
    const id = rows[0].id;

    const ledgerBefore = JSON.stringify(ledger());
    const settlementsBefore = JSON.stringify(settlements());
    const rowBefore = attendance().find((a) => a.id === id)!;
    const balanceBefore = (await contractors.getLedger(PAPPU)).contractor.advanceBalancePaise;

    await apply([id]);

    expect(JSON.stringify(ledger())).toBe(ledgerBefore);
    expect(JSON.stringify(settlements())).toBe(settlementsBefore);
    expect((await contractors.getLedger(PAPPU)).contractor.advanceBalancePaise).toBe(balanceBefore);

    const rowAfter = attendance().find((a) => a.id === id)!;
    // ONE field differs. Everything that carries money is untouched.
    expect(rowAfter.contractId).toBe(STRUCTURE);
    expect(rowAfter.quantityPresent).toBe(rowBefore.quantityPresent);
    expect(rowAfter.dailyRatePaiseSnapshot).toBe(rowBefore.dailyRatePaiseSnapshot);
    expect(rowAfter.estimatedCostPaise).toBe(rowBefore.estimatedCostPaise);
    expect(rowAfter.settlementId).toBe(rowBefore.settlementId);
  });

  it("does not retroactively consume an agreement-scoped advance", async () => {
    // ₹5,000 earmarked for Structure. It was NOT drawn, because the labour it
    // would have funded carried no agreement at settlement time.
    await contractors.recordAdvance({
      contractorId: PAPPU,
      date: "2026-06-01",
      amountPaise: 500_000,
      notes: null,
      projectId: SKY,
      contractId: STRUCTURE,
    });
    const rows = await settledUnattributed();
    const adjustmentsBefore = ledger().filter((e: { type: string }) => e.type === "ADJUSTMENT").length;
    const balanceBefore = (await contractors.getLedger(PAPPU)).contractor.advanceBalancePaise;

    await apply([rows[0].id]);

    // The allocator decided at settlement time, from the composition that
    // existed then. Attributing later means the money SHOULD have been drawn,
    // not that it WAS. It stays outstanding for a future settlement.
    expect(ledger().filter((e: { type: string }) => e.type === "ADJUSTMENT").length).toBe(
      adjustmentsBefore,
    );
    expect((await contractors.getLedger(PAPPU)).contractor.advanceBalancePaise).toBe(balanceBefore);
  });
});

/* ── Reconciliation ─────────────────────────────────────────────────────── */

describe("agreement reconciliation after attribution", () => {
  it("reduces Due by the attributed amount when the agreement was owed money", async () => {
    const rows = await settledUnattributed();
    const value = rows[0].estimatedCostPaise;
    const before = await recon(STRUCTURE);

    await apply([rows[0].id]);
    const after = await recon(STRUCTURE);

    expect(after.totalCreditedPaise).toBe(before.totalCreditedPaise + value);
    expect(after.earnedValuePaise).toBe(before.earnedValuePaise);
    expect(after.currentContractValuePaise).toBe(before.currentContractValuePaise);
    // Due falls by the credit, floored at zero; anything past that becomes Ahead.
    const expectedDue = Math.max(0, before.currentDuePaise - value);
    expect(after.currentDuePaise).toBe(expectedDue);
  });

  it("may create Ahead, and says so rather than refusing", async () => {
    // Enough labour to overshoot what the agreement has earned.
    const rows = await settledUnattributed(400);
    const preview = await contracts.previewAttribution({
      contractorId: PAPPU,
      projectId: SKY,
      contractId: STRUCTURE,
      attendanceIds: [rows[0].id],
    });
    if ("rowCount" in preview) {
      expect(preview.blockers).toEqual([]);
      if (preview.after.advanceCreditPaise > preview.before.advanceCreditPaise) {
        expect(preview.warnings).toContain("CREATES_AHEAD");
      }
    }
    // Never blocked on Ahead alone — settlement itself credits with no ceiling.
    const res = await apply([rows[0].id]);
    expect("blockers" in res).toBe(false);
  });
});

/* ── The preview ────────────────────────────────────────────────────────── */

describe("the preview", () => {
  it("states cash and advance impact as exactly zero", async () => {
    const rows = await settledUnattributed();
    const preview = await contracts.previewAttribution({
      contractorId: PAPPU,
      projectId: SKY,
      contractId: STRUCTURE,
      attendanceIds: [rows[0].id],
    });
    expect(preview).toMatchObject({ cashImpactPaise: 0, advanceDrawdownImpactPaise: 0 });
  });

  it("matches what the write actually does", async () => {
    const rows = await settledUnattributed();
    const preview = await contracts.previewAttribution({
      contractorId: PAPPU,
      projectId: SKY,
      contractId: STRUCTURE,
      attendanceIds: [rows[0].id],
    });
    if (!("rowCount" in preview)) throw new Error("expected a preview");

    await apply([rows[0].id]);
    const after = await recon(STRUCTURE);
    expect(after.attendanceCreditPaise).toBe(preview.after.attendanceCreditPaise);
    expect(after.currentDuePaise).toBe(preview.after.currentDuePaise);
    expect((await position()).settledUnattributedPaise).toBe(preview.unattributedAfterPaise);
  });
});

/* ── Refusals ───────────────────────────────────────────────────────────── */

describe("refusals", () => {
  it("refuses a CANCELLED target", async () => {
    const rows = await settledUnattributed();
    await contracts.cancelContract(WALL, "Not going ahead");
    const res = await apply([rows[0].id], WALL);
    expect(res).toMatchObject({ blockers: ["TARGET_AGREEMENT_CANCELLED"] });
    expect((await position()).settledUnattributedPaise).toBeGreaterThan(0);
  });

  it("refuses an agreement belonging to another contractor or project", async () => {
    const rows = await settledUnattributed();
    const res = await contracts.attributeSettledLabour({
      contractorId: PAPPU,
      projectId: "10000000-0000-0000-0000-000000000002", // Orion
      contractId: STRUCTURE, // lives on Skyline
      attendanceIds: [rows[0].id],
      reason: "x",
    });
    expect(res).toMatchObject({ blockers: ["INVALID_TARGET"] });
  });

  it("refuses a row that is already attributed — no Agreement A → B in v1", async () => {
    const rows = await settledUnattributed();
    await apply([rows[0].id]);
    const res = await apply([rows[0].id], WALL);
    expect("blockers" in res && res.blockers).toContain("ROW_ALREADY_ATTRIBUTED");
  });

  it("REFUSES a five-field identity collision instead of merging rows", async () => {
    // Structure already has Mason on this date…
    await labor.setQuantity({
      projectId: SKY,
      date: DATE,
      subcategoryId: MASON,
      quantity: 2,
      contractorId: PAPPU,
      contractId: STRUCTURE,
    });
    // …and an unattributed Mason row exists for the SAME date.
    await labor.setQuantity({
      projectId: SKY,
      date: DATE,
      subcategoryId: MASON,
      quantity: 3,
      contractorId: PAPPU,
      contractId: null,
    });
    await contractors.createSettlement({
      contractorId: PAPPU,
      projectId: SKY,
      periodStart: DATE,
      periodEnd: DATE,
      advanceAdjustmentPaise: 0,
    });

    const rows = await contracts.listAttributableLabour(PAPPU, SKY);
    const mason = rows.find((r) => r.labourTypeName === "Mason")!;
    const res = await apply([mason.id]);

    expect("blockers" in res && res.blockers).toContain("IDENTITY_COLLISION");
    // Nothing was written — merging settled rows would change recognised value.
    expect(attendance().find((a) => a.id === mason.id)!.contractId).toBeNull();
  });

  it("refuses a selection that collides with ITSELF", async () => {
    // Two unattributed rows, same day and labour type, are legal today; making
    // them one agreement's rows would make them one identity.
    const rows = await settledUnattributed();
    const dup = attendance().find((a) => a.id === rows[0].id)!;
    const clone = { ...dup, id: "clone-row" };
    localStorage.setItem(
      "constructly.demo.labourAttendance.v2",
      JSON.stringify([...attendance(), clone]),
    );
    const res = await apply([rows[0].id, "clone-row"]);
    expect("blockers" in res && res.blockers).toContain("IDENTITY_COLLISION");
  });
});

/* ── Reversal ───────────────────────────────────────────────────────────── */

describe("reversing an attribution", () => {
  it("returns the labour to unattributed and the credit to where it was", async () => {
    const rows = await settledUnattributed();
    const value = rows[0].estimatedCostPaise;
    const creditBefore = (await recon(STRUCTURE)).attendanceCreditPaise;
    const unattributedBefore = (await position()).settledUnattributedPaise;

    const applied = await apply([rows[0].id]);
    if ("blockers" in applied) throw new Error("expected success");

    const res = await contracts.reverseAttribution({
      correctionId: applied.correctionId,
      reason: "Attributed to the wrong agreement",
    });
    expect("blockers" in res).toBe(false);

    expect((await recon(STRUCTURE)).attendanceCreditPaise).toBe(creditBefore);
    expect((await position()).settledUnattributedPaise).toBe(unattributedBefore);
    expect(value).toBeGreaterThan(0);
  });

  it("cannot be reversed twice", async () => {
    const rows = await settledUnattributed();
    const applied = await apply([rows[0].id]);
    if ("blockers" in applied) throw new Error("expected success");
    await contracts.reverseAttribution({ correctionId: applied.correctionId, reason: "x" });
    const again = await contracts.reverseAttribution({
      correctionId: applied.correctionId,
      reason: "x",
    });
    expect(again).toMatchObject({ blockers: ["ALREADY_REVERSED"] });
  });

  it("refuses when the rows have moved on, rather than restoring some of them", async () => {
    const rows = await settledUnattributed();
    const applied = await apply([rows[0].id]);
    if ("blockers" in applied) throw new Error("expected success");

    // Something else freed the row — the correction no longer describes reality.
    const all = attendance();
    for (const a of all) if (a.id === rows[0].id) a.settlementId = null;
    localStorage.setItem("constructly.demo.labourAttendance.v2", JSON.stringify(all));

    const res = await contracts.reverseAttribution({
      correctionId: applied.correctionId,
      reason: "x",
    });
    expect(res).toMatchObject({ blockers: ["STALE_SELECTION"] });
  });

  it("requires a reason", async () => {
    const rows = await settledUnattributed();
    const applied = await apply([rows[0].id]);
    if ("blockers" in applied) throw new Error("expected success");
    expect(
      await contracts.reverseAttribution({ correctionId: applied.correctionId, reason: " " }),
    ).toMatchObject({ blockers: ["REASON_REQUIRED"] });
  });
});

/* ── History ────────────────────────────────────────────────────────────── */

describe("history", () => {
  it("records the correction and its reversal, keeping both", async () => {
    const rows = await settledUnattributed();
    const applied = await apply([rows[0].id]);
    if ("blockers" in applied) throw new Error("expected success");

    let events = await contracts.listHistory(PAPPU);
    const forward = events.find((e) => e.action === "contractor.attendance_attributed")!;
    expect(forward).toBeDefined();
    expect(forward.attributionReversedAt).toBeNull();

    await contracts.reverseAttribution({ correctionId: applied.correctionId, reason: "Wrong one" });

    events = await contracts.listHistory(PAPPU);
    // The original stays listed — history records what happened, not only what
    // still stands — and is now marked reversed so the action is withdrawn.
    expect(events.find((e) => e.action === "contractor.attendance_attributed")!.attributionReversedAt)
      .toBeTruthy();
    expect(events.some((e) => e.action === "contractor.attendance_attribution_reversed")).toBe(true);
  });
});

/* ── The design's load-bearing test ─────────────────────────────────────── */

describe("settlement reversal AFTER an attribution correction", () => {
  it("still balances, because reversal reads the settlement-time breakdown", async () => {
    const rows = await settledUnattributed();
    const applied = await apply([rows[0].id]);
    if ("blockers" in applied) throw new Error("expected success");

    const settlementId = rows[0].settlementId;
    const balanceBefore = (await contractors.getLedger(PAPPU)).contractor.advanceBalancePaise;

    // The settlement recorded this labour in the UNATTRIBUTED bucket. The
    // correction moved the row to Structure. Reversal must still un-apply the
    // cash the way the settlement actually applied it.
    await expect(
      contractors.reverseSettlement(settlementId, "Correcting the period"),
    ).resolves.toBeDefined();

    const after = (await contractors.getLedger(PAPPU)).contractor.advanceBalancePaise;
    expect(after).toBeGreaterThan(balanceBefore); // cash came back as unapplied advance

    // The rows are freed, so they leave BOTH settled buckets entirely.
    const pos = await position();
    expect(pos.settledUnattributedPaise).toBe(0);
    expect(pos.unsettledPaise).toBeGreaterThan(0);
  });
});
