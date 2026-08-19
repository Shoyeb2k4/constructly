/**
 * Effective-dated rate revision, end to end on the demo stores.
 *
 * The invariant this whole file exists to defend:
 *
 *   CHANGING A RATE NEVER CHANGES A NUMBER THAT HAS ALREADY BEEN RECORDED.
 *
 * A revision is an APPEND. Attendance carries `dailyRatePaiseSnapshot` taken at
 * the moment it was recorded (ADR-0022), settlement bills from those snapshots,
 * and reconciliation reads settlement — so a rate agreed in April cannot
 * retro-price March, and a rate BACKDATED to July today cannot retro-price the
 * 10 July row that was entered last week.
 *
 * The arithmetic here is the production arithmetic: `effectiveRateOn` and
 * `rateBands` are the same pure functions the server calls. Only persistence
 * differs.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { demoContractsRepository as contracts } from "./demo/demo-repository";
import { demoLaborRepository as labor } from "@/features/labor/demo/demo-repository";
import { demoContractorsRepository as contractors } from "@/features/contractors/demo/demo-repository";
import { demoRepository as projects } from "@/features/projects/demo/demo-repository";
import { rateBands } from "./rates";

const STRUCTURE = "ag-structure";
const MASON_ITEM = "si-mason";
const SKY = "10000000-0000-0000-0000-000000000001";
const PAPPU = "c-pappu";
const MASON = "65000000-0000-0000-0000-000000000005";

/** The seeded Mason history: ₹850 from 10 Jan, ₹900 from 1 Apr. */
const R850 = 85_000;
const R900 = 90_000;

beforeEach(async () => {
  localStorage.clear();
  await projects.list({});
  await contracts.listContracts();
  await contracts.listScopeItems(STRUCTURE);
  await contractors.listContractors();
});

const revisions = () => contracts.listRateRevisions(MASON_ITEM);
const masonItem = async () =>
  (await contracts.listScopeItems(STRUCTURE)).find((i) => i.id === MASON_ITEM)!;

/* ── Creating a revision ────────────────────────────────────────────────── */

describe("revising a rate", () => {
  it("APPENDS — the previous rate is still there afterwards", async () => {
    const before = await revisions();
    await contracts.setScopeRate({
      scopeItemId: MASON_ITEM,
      ratePaise: 95_000,
      rateUnit: "day",
      effectiveFrom: "2026-07-01",
      reason: "Annual rate revision",
    });
    const after = await revisions();

    expect(after).toHaveLength(before.length + 1);
    // Every original revision survives, byte for byte.
    for (const r of before) {
      expect(after.find((x) => x.id === r.id)).toMatchObject({
        ratePaise: r.ratePaise,
        effectiveFrom: r.effectiveFrom,
      });
    }
  });

  it("persists the effective date and the reason the user actually typed", async () => {
    await contracts.setScopeRate({
      scopeItemId: MASON_ITEM,
      ratePaise: 95_000,
      rateUnit: "day",
      effectiveFrom: "2026-07-01",
      reason: "Negotiated rate change",
    });
    const newest = (await revisions()).find((r) => r.effectiveFrom === "2026-07-01")!;
    expect(newest.ratePaise).toBe(95_000);
    expect(newest.reason).toBe("Negotiated rate change");
  });

  it("shows up in the history bands with correct boundaries", async () => {
    await contracts.setScopeRate({
      scopeItemId: MASON_ITEM,
      ratePaise: 95_000,
      rateUnit: "day",
      effectiveFrom: "2026-07-01",
      reason: "Annual rate revision",
    });
    const bands = rateBands(await revisions());

    expect(bands.map((b) => [b.fromDate, b.toDate, b.ratePaise])).toEqual([
      ["2026-01-10", "2026-03-31", R850],
      ["2026-04-01", "2026-06-30", R900],
      ["2026-07-01", null, 95_000],
    ]);
  });

  it("refuses a rate of zero or less, by name", async () => {
    await expect(
      contracts.setScopeRate({
        scopeItemId: MASON_ITEM,
        ratePaise: 0,
        rateUnit: "day",
        effectiveFrom: "2026-07-01",
        reason: "x",
      }),
    ).rejects.toThrow(/INVALID_RATE/);
  });

  it("refuses an effective date before the agreement itself started", async () => {
    await expect(
      contracts.setScopeRate({
        scopeItemId: MASON_ITEM,
        ratePaise: 95_000,
        rateUnit: "day",
        effectiveFrom: "2020-01-01",
        reason: "x",
      }),
    ).rejects.toThrow(/INVALID_RATE/);
  });
});

/* ── Backdating ─────────────────────────────────────────────────────────── */

describe("backdating a revision", () => {
  it("slots into the middle of the history and re-cuts the bands around it", async () => {
    // A rate agreed verbally in February, entered months later.
    await contracts.setScopeRate({
      scopeItemId: MASON_ITEM,
      ratePaise: 87_000,
      rateUnit: "day",
      effectiveFrom: "2026-02-15",
      reason: "Correction of entered rate",
    });
    const bands = rateBands(await revisions());

    expect(bands.map((b) => [b.fromDate, b.toDate, b.ratePaise])).toEqual([
      ["2026-01-10", "2026-02-14", R850],
      ["2026-02-15", "2026-03-31", 87_000],
      ["2026-04-01", null, R900],
    ]);
  });

  it("does not become the current rate when a later revision already exists", async () => {
    await contracts.setScopeRate({
      scopeItemId: MASON_ITEM,
      ratePaise: 87_000,
      rateUnit: "day",
      effectiveFrom: "2026-02-15",
      reason: "Correction of entered rate",
    });
    // 1 Apr's ₹900 still wins today — currentRatePaise is recomputed from the
    // WHOLE ledger as at today, never simply set to the value just written.
    expect((await masonItem()).currentRatePaise).toBe(R900);
  });

  it("stays append-only — nothing is rewritten to make room", async () => {
    const before = await revisions();
    await contracts.setScopeRate({
      scopeItemId: MASON_ITEM,
      ratePaise: 87_000,
      rateUnit: "day",
      effectiveFrom: "2026-02-15",
      reason: "Correction of entered rate",
    });
    const after = await revisions();
    expect(after.filter((r) => before.some((b) => b.id === r.id))).toHaveLength(before.length);
  });
});

/* ── Same-day revisions ─────────────────────────────────────────────────── */

describe("two revisions on the same effective date", () => {
  it("keeps both on record — a correction never deletes what it corrects", async () => {
    await contracts.setScopeRate({
      scopeItemId: MASON_ITEM,
      ratePaise: 92_000,
      rateUnit: "day",
      effectiveFrom: "2026-04-01",
      reason: "Correction of entered rate",
    });
    const sameDay = (await revisions()).filter((r) => r.effectiveFrom === "2026-04-01");
    expect(sameDay).toHaveLength(2);
    expect(sameDay.map((r) => r.ratePaise).sort()).toEqual([R900, 92_000].sort());
  });

  it("the one created LAST wins, and only it produces a band", async () => {
    await contracts.setScopeRate({
      scopeItemId: MASON_ITEM,
      ratePaise: 92_000,
      rateUnit: "day",
      effectiveFrom: "2026-04-01",
      reason: "Correction of entered rate",
    });
    const bands = rateBands(await revisions());

    // One band per effective date — the timeline a user reads matches exactly
    // what effectiveRateOn would resolve.
    expect(bands.filter((b) => b.fromDate === "2026-04-01")).toHaveLength(2 - 1);
    expect(bands.find((b) => b.fromDate === "2026-04-01")!.ratePaise).toBe(92_000);
    expect((await masonItem()).currentRatePaise).toBe(92_000);
  });
});

/* ── Historical attendance safety — THE invariant ───────────────────────── */

describe("attendance already recorded is never repriced", () => {
  /** Record a Mason day under Structure and return its stored row. */
  const recordDay = async (date: string, quantity: number) => {
    await labor.setQuantity({
      projectId: SKY,
      date,
      subcategoryId: MASON,
      quantity,
      contractorId: PAPPU,
      contractId: STRUCTURE,
    });
    return (await labor.listAttendance({ projectId: SKY, from: date, to: date })).find(
      (a) => a.contractId === STRUCTURE && a.subcategoryId === MASON,
    )!;
  };

  it("keeps its snapshot and its cost when a LATER rate is agreed", async () => {
    // March labour, valued at the rate in force in March.
    const march = await recordDay("2026-03-20", 4);
    expect(march.dailyRatePaiseSnapshot).toBe(R850);
    expect(march.estimatedCostPaise).toBe(R850 * 4);

    await contracts.setScopeRate({
      scopeItemId: MASON_ITEM,
      ratePaise: 95_000,
      rateUnit: "day",
      effectiveFrom: "2026-05-01",
      reason: "Annual rate revision",
    });

    const after = (await labor.listAttendance({
      projectId: SKY,
      from: "2026-03-20",
      to: "2026-03-20",
    })).find((a) => a.contractId === STRUCTURE)!;
    expect(after.dailyRatePaiseSnapshot).toBe(R850);
    expect(after.estimatedCostPaise).toBe(R850 * 4);
  });

  it("keeps its snapshot when a revision is BACKDATED over its own date", async () => {
    // Recorded on 10 July at the rate then in force (₹900, from 1 Apr).
    const july = await recordDay("2026-07-10", 3);
    expect(july.dailyRatePaiseSnapshot).toBe(R900);

    // Today someone discovers the real rate from 1 July was ₹950.
    await contracts.setScopeRate({
      scopeItemId: MASON_ITEM,
      ratePaise: 95_000,
      rateUnit: "day",
      effectiveFrom: "2026-07-01",
      reason: "Revised labour agreement",
    });

    // The 10 July row does NOT move. Rate history changed; recorded value did not.
    const after = (await labor.listAttendance({
      projectId: SKY,
      from: "2026-07-10",
      to: "2026-07-10",
    })).find((a) => a.contractId === STRUCTURE)!;
    expect(after.dailyRatePaiseSnapshot).toBe(R900);
    expect(after.estimatedCostPaise).toBe(R900 * 3);
  });

  it("prices NEWLY recorded attendance at the revised rate", async () => {
    await contracts.setScopeRate({
      scopeItemId: MASON_ITEM,
      ratePaise: 95_000,
      rateUnit: "day",
      effectiveFrom: "2026-07-01",
      reason: "Revised labour agreement",
    });
    // 15 July had no row yet, so it resolves against the history as it stands.
    const fresh = await recordDay("2026-07-15", 2);
    expect(fresh.dailyRatePaiseSnapshot).toBe(95_000);
    expect(fresh.estimatedCostPaise).toBe(95_000 * 2);
  });

  it("still prices a row dated BEFORE the revision at the older rate", async () => {
    await contracts.setScopeRate({
      scopeItemId: MASON_ITEM,
      ratePaise: 95_000,
      rateUnit: "day",
      effectiveFrom: "2026-07-01",
      reason: "Revised labour agreement",
    });
    // Resolution is by the ROW's own date, never today's.
    const feb = await recordDay("2026-02-10", 1);
    expect(feb.dailyRatePaiseSnapshot).toBe(R850);
  });
});

/* ── Settlement safety ──────────────────────────────────────────────────── */

describe("settlement bills from snapshots, not from today's rate", () => {
  it("a settlement created AFTER a revision still uses the old snapshot", async () => {
    await labor.setQuantity({
      projectId: SKY,
      date: "2026-03-20",
      subcategoryId: MASON,
      quantity: 4,
      contractorId: PAPPU,
      contractId: STRUCTURE,
    });
    const expected = R850 * 4; // ₹3,400

    // Rate goes up before anyone gets round to settling March.
    await contracts.setScopeRate({
      scopeItemId: MASON_ITEM,
      ratePaise: 95_000,
      rateUnit: "day",
      effectiveFrom: "2026-04-01",
      reason: "Annual rate revision",
    });

    const settlement = await contractors.createSettlement({
      contractorId: PAPPU,
      projectId: SKY,
      periodStart: "2026-03-16",
      periodEnd: "2026-03-22",
      advanceAdjustmentPaise: 0,
    });

    // ₹3,400, not 4 × ₹950. The revision moved nothing.
    expect(settlement.labourBillPaise).toBe(expected);
  });
});

/* ── Reconciliation ─────────────────────────────────────────────────────── */

describe("a rate revision moves no commercial figure by itself", () => {
  it("leaves agreement value, earned value and credit exactly as they were", async () => {
    const before = (await contracts.getContract(STRUCTURE))!.contract.reconciliation;

    await contracts.setScopeRate({
      scopeItemId: MASON_ITEM,
      ratePaise: 95_000,
      rateUnit: "day",
      effectiveFrom: "2026-07-01",
      reason: "Annual rate revision",
    });

    const after = (await contracts.getContract(STRUCTURE))!.contract.reconciliation;
    expect(after.currentContractValuePaise).toBe(before.currentContractValuePaise);
    expect(after.earnedValuePaise).toBe(before.earnedValuePaise);
    expect(after.totalCreditedPaise).toBe(before.totalCreditedPaise);
    expect(after.currentDuePaise).toBe(before.currentDuePaise);
    expect(after.overallBalancePaise).toBe(before.overallBalancePaise);
  });
});

/* ── Scope creation still establishes an opening rate ───────────────────── */

describe("adding a labour type to scope", () => {
  it("creates the item AND its opening revision — a rate nobody agreed to is not a rate", async () => {
    const item = await contracts.addScopeItem({
      contractId: STRUCTURE,
      labourSubcategoryId: "65000000-0000-0000-0000-000000000007", // Painter
      ratePaise: 70_000,
      effectiveFrom: "2026-02-01",
    });
    expect(item.currentRatePaise).toBe(70_000);

    const history = await contracts.listRateRevisions(item.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ ratePaise: 70_000, effectiveFrom: "2026-02-01" });
  });
});
