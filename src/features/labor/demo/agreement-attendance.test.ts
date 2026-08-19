/**
 * Phase 6 — Project → Contractor → Agreement → Labour Type → Effective Rate →
 * Attendance, exercised end to end on the demo stores.
 *
 * The scenarios here are the ones that go wrong quietly if the wiring is only
 * half right: a contractor holding two agreements, the same labour type priced
 * differently under each, a rate revised mid-project, and a settled day that
 * must refuse to move.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { demoLaborRepository as labor } from "./demo-repository";
import { demoRepository as projects } from "@/features/projects/demo/demo-repository";
import { demoContractsRepository as contracts } from "@/features/contracts/demo/demo-repository";
import { demoContractorsRepository as contractors } from "@/features/contractors/demo/demo-repository";

const SKY = "10000000-0000-0000-0000-000000000001";
const ORION = "10000000-0000-0000-0000-000000000002";
const PAPPU = "c-pappu";
const RAMESH = "c-ramesh";

const STRUCTURE = "ag-structure";
const COMPOUND_WALL = "ag-compound-wall";
const ORION_AGREEMENT = "ag-orion";

const MASON = "65000000-0000-0000-0000-000000000005";
const MASON_HELPER = "65000000-0000-0000-0000-000000000006";
const PAINTER = "65000000-0000-0000-0000-000000000007";
const MAIN_CARPENTER = "65000000-0000-0000-0000-000000000001";

/** A date after every seeded rate revision, and clear of the seeded week. */
const DATE = "2026-06-15";

/** Materialise every demo store (they seed lazily on first read). */
beforeEach(async () => {
  localStorage.clear();
  await projects.list({});
  await contracts.listContracts();
  // Scope and rate history live in their own stores; the sheet reads both.
  await contracts.listScopeItems(STRUCTURE);
  await contracts.listRateRevisions("si-mason");
  await contractors.listContractors();
  await labor.getSheet(SKY, DATE);
});

const groupFor = async (projectId: string, contractorId: string, date = DATE) =>
  (await labor.getSheet(projectId, date)).groups.find((g) => g.contractorId === contractorId)!;

describe("agreement selection", () => {
  it("a contractor with NO agreements keeps the attendance-only flow", async () => {
    const g = await groupFor(SKY, RAMESH);
    expect(g.agreements).toEqual([]);
    expect(g.requiresAgreementChoice).toBe(false);
    // Rows come from the project labour rates, unattributed, exactly as before.
    expect(g.rows.every((r) => r.contractId === null)).toBe(true);
    expect(g.rows.map((r) => r.subcategoryId).sort()).toEqual(
      [MAIN_CARPENTER, "65000000-0000-0000-0000-000000000002"].sort(),
    );
  });

  it("a contractor with EXACTLY ONE agreement gets it auto-selected", async () => {
    const g = await groupFor(ORION, PAPPU);
    expect(g.agreements.map((a) => a.contractId)).toEqual([ORION_AGREEMENT]);
    expect(g.requiresAgreementChoice).toBe(false);
    expect(g.rows.every((r) => r.contractId === ORION_AGREEMENT)).toBe(true);
  });

  it("a contractor with TWO agreements must be asked which one", async () => {
    const g = await groupFor(SKY, PAPPU);
    expect(g.agreements.map((a) => a.title).sort()).toEqual(["Compound Wall", "Structure"]);
    expect(g.requiresAgreementChoice).toBe(true);
  });

  it("never guesses: nothing is attributed without an explicit agreement", async () => {
    // Recording with no agreement on a contractor who holds two lands
    // unattributed — it does NOT get quietly assigned to one of them.
    await labor.setQuantity({ projectId: SKY, date: DATE, subcategoryId: MASON, quantity: 4, contractorId: PAPPU });
    const rows = await labor.listAttendance({ projectId: SKY, from: DATE, to: DATE });
    expect(rows).toHaveLength(1);
    expect(rows[0].contractId).toBeNull();
  });
});

describe("labour type filtering", () => {
  it("each agreement exposes only the labour types its own scope covers", async () => {
    const g = await groupFor(SKY, PAPPU);
    const byAgreement = (id: string) =>
      g.rows.filter((r) => r.contractId === id).map((r) => r.subcategoryId).sort();

    expect(byAgreement(STRUCTURE)).toEqual([MAIN_CARPENTER, MASON, MASON_HELPER].sort());
    expect(byAgreement(COMPOUND_WALL)).toEqual([MASON, PAINTER].sort());
    // Painter belongs to the wall, not the tower; Mason Helper the other way.
    expect(byAgreement(STRUCTURE)).not.toContain(PAINTER);
    expect(byAgreement(COMPOUND_WALL)).not.toContain(MASON_HELPER);
  });

  it("refuses labour the chosen agreement does not price", async () => {
    // Painter is Compound Wall's, not Structure's. The demo degrades (matching
    // the offline path) rather than throwing, but it must NOT record the row
    // against Structure.
    await labor.setQuantity({
      projectId: SKY, date: DATE, subcategoryId: PAINTER, quantity: 3,
      contractorId: PAPPU, contractId: STRUCTURE,
    });
    const rows = await labor.listAttendance({ projectId: SKY, from: DATE, to: DATE });
    expect(rows[0].contractId).not.toBe(STRUCTURE);
  });

  it("the agreement's labour types are its scope, not the contractor's name", async () => {
    // The taxonomy stays shared: Mason is one company-wide labour type that two
    // agreements price differently, not two contractor-named groups.
    const g = await groupFor(SKY, PAPPU);
    const masonRows = g.rows.filter((r) => r.subcategoryId === MASON);
    expect(masonRows).toHaveLength(2);
    expect(new Set(masonRows.map((r) => r.name))).toEqual(new Set(["Mason"]));
  });
});

describe("rate resolution", () => {
  it("uses the agreement rate in force on the ROW'S date, not today's", async () => {
    // Structure prices Mason at ₹850 from 10 Jan 2026 and ₹900 from 1 Apr 2026.
    await labor.setQuantity({
      projectId: SKY, date: "2026-02-20", subcategoryId: MASON, quantity: 10,
      contractorId: PAPPU, contractId: STRUCTURE,
    });
    await labor.setQuantity({
      projectId: SKY, date: "2026-05-20", subcategoryId: MASON, quantity: 10,
      contractorId: PAPPU, contractId: STRUCTURE,
    });

    const feb = (await labor.listAttendance({ projectId: SKY, from: "2026-02-20", to: "2026-02-20" }))[0];
    const may = (await labor.listAttendance({ projectId: SKY, from: "2026-05-20", to: "2026-05-20" }))[0];
    expect(feb.dailyRatePaiseSnapshot).toBe(85_000);
    expect(may.dailyRatePaiseSnapshot).toBe(90_000);
    expect(feb.estimatedCostPaise).toBe(10 * 85_000);
  });

  it("a later revision never rewrites what past work was worth", async () => {
    await labor.setQuantity({
      projectId: SKY, date: "2026-02-20", subcategoryId: MASON, quantity: 10,
      contractorId: PAPPU, contractId: STRUCTURE,
    });
    await contracts.setScopeRate({
      scopeItemId: "si-mason",
      ratePaise: 120_000,
      effectiveFrom: "2026-01-10", // back-dated over the existing row
      reason: "Renegotiated",
    });
    const feb = (await labor.listAttendance({ projectId: SKY, from: "2026-02-20", to: "2026-02-20" }))[0];
    expect(feb.dailyRatePaiseSnapshot).toBe(85_000); // untouched
    expect(feb.estimatedCostPaise).toBe(10 * 85_000);
  });

  it("the agreement rate beats the project-contractor rate", async () => {
    // Skyline configures Pappu's Mason at ₹1,000/day; Structure agreed ₹900.
    await labor.setQuantity({
      projectId: SKY, date: DATE, subcategoryId: MASON, quantity: 1,
      contractorId: PAPPU, contractId: STRUCTURE,
    });
    const row = (await labor.listAttendance({ projectId: SKY, from: DATE, to: DATE }))[0];
    expect(row.dailyRatePaiseSnapshot).toBe(90_000);
  });

  it("falls back to the project-contractor rate with no agreement (unchanged)", async () => {
    await labor.setQuantity({
      projectId: SKY, date: DATE, subcategoryId: MAIN_CARPENTER, quantity: 2, contractorId: RAMESH,
    });
    const row = (await labor.listAttendance({ projectId: SKY, from: DATE, to: DATE }))[0];
    expect(row.dailyRatePaiseSnapshot).toBe(90_000); // Ramesh's ₹900/day
    expect(row.contractId).toBeNull();
  });
});

describe("attendance identity includes the agreement", () => {
  it("the same date and labour type coexist under two agreements", async () => {
    await labor.setQuantity({
      projectId: SKY, date: DATE, subcategoryId: MASON, quantity: 6,
      contractorId: PAPPU, contractId: STRUCTURE,
    });
    await labor.setQuantity({
      projectId: SKY, date: DATE, subcategoryId: MASON, quantity: 4,
      contractorId: PAPPU, contractId: COMPOUND_WALL,
    });

    const rows = await labor.listAttendance({ projectId: SKY, from: DATE, to: DATE });
    expect(rows).toHaveLength(2);
    const structure = rows.find((r) => r.contractId === STRUCTURE)!;
    const wall = rows.find((r) => r.contractId === COMPOUND_WALL)!;
    expect(structure.quantityPresent).toBe(6);
    expect(wall.quantityPresent).toBe(4);
    // Same labour type, same day, different agreed rate — so different money.
    expect(structure.dailyRatePaiseSnapshot).toBe(90_000);
    expect(wall.dailyRatePaiseSnapshot).toBe(80_000);
    expect(structure.estimatedCostPaise).toBe(6 * 90_000);
    expect(wall.estimatedCostPaise).toBe(4 * 80_000);
  });

  it("editing one agreement's row leaves the other's untouched", async () => {
    await labor.setQuantity({
      projectId: SKY, date: DATE, subcategoryId: MASON, quantity: 6,
      contractorId: PAPPU, contractId: STRUCTURE,
    });
    await labor.setQuantity({
      projectId: SKY, date: DATE, subcategoryId: MASON, quantity: 4,
      contractorId: PAPPU, contractId: COMPOUND_WALL,
    });
    await labor.setQuantity({
      projectId: SKY, date: DATE, subcategoryId: MASON, quantity: 9,
      contractorId: PAPPU, contractId: STRUCTURE,
    });

    const rows = await labor.listAttendance({ projectId: SKY, from: DATE, to: DATE });
    expect(rows.find((r) => r.contractId === STRUCTURE)!.quantityPresent).toBe(9);
    expect(rows.find((r) => r.contractId === COMPOUND_WALL)!.quantityPresent).toBe(4);
  });

  it("CLEARING one agreement's row leaves the other's alive", async () => {
    // The dangerous one: a delete keyed on anything less than the full identity
    // silently takes the other agreement's day with it.
    await labor.setQuantity({
      projectId: SKY, date: DATE, subcategoryId: MASON, quantity: 6,
      contractorId: PAPPU, contractId: STRUCTURE,
    });
    await labor.setQuantity({
      projectId: SKY, date: DATE, subcategoryId: MASON, quantity: 4,
      contractorId: PAPPU, contractId: COMPOUND_WALL,
    });
    await labor.setQuantity({
      projectId: SKY, date: DATE, subcategoryId: MASON, quantity: 0,
      contractorId: PAPPU, contractId: STRUCTURE,
    });

    const rows = await labor.listAttendance({ projectId: SKY, from: DATE, to: DATE });
    expect(rows).toHaveLength(1);
    expect(rows[0].contractId).toBe(COMPOUND_WALL);
    expect(rows[0].quantityPresent).toBe(4);
  });

  it("copy-yesterday carries each agreement forward independently", async () => {
    await labor.setQuantity({
      projectId: SKY, date: "2026-06-10", subcategoryId: MASON, quantity: 6,
      contractorId: PAPPU, contractId: STRUCTURE,
    });
    await labor.setQuantity({
      projectId: SKY, date: "2026-06-10", subcategoryId: MASON, quantity: 4,
      contractorId: PAPPU, contractId: COMPOUND_WALL,
    });
    await labor.copyPreviousDay(SKY, "2026-06-11");

    const rows = (await labor.listAttendance({ projectId: SKY, from: "2026-06-11", to: "2026-06-11" }))
      .filter((r) => r.contractorId === PAPPU);
    expect(rows.find((r) => r.contractId === STRUCTURE)!.quantityPresent).toBe(6);
    expect(rows.find((r) => r.contractId === COMPOUND_WALL)!.quantityPresent).toBe(4);
  });
});

describe("settled attendance", () => {
  /** Record a Structure day, then settle the week that contains it. */
  async function settleStructureDay() {
    await labor.setQuantity({
      projectId: SKY, date: DATE, subcategoryId: MASON, quantity: 6,
      contractorId: PAPPU, contractId: STRUCTURE,
    });
    return contractors.createSettlement({
      contractorId: PAPPU,
      projectId: SKY,
      periodStart: "2026-06-15",
      periodEnd: "2026-06-15",
      advanceAdjustmentPaise: 0,
    });
  }

  it("refuses a quantity change", async () => {
    await settleStructureDay();
    await expect(
      labor.setQuantity({
        projectId: SKY, date: DATE, subcategoryId: MASON, quantity: 8,
        contractorId: PAPPU, contractId: STRUCTURE,
      }),
    ).rejects.toThrow("ATTENDANCE_SETTLED");
  });

  it("refuses a delete", async () => {
    await settleStructureDay();
    await expect(
      labor.setQuantity({
        projectId: SKY, date: DATE, subcategoryId: MASON, quantity: 0,
        contractorId: PAPPU, contractId: STRUCTURE,
      }),
    ).rejects.toThrow("ATTENDANCE_SETTLED");
  });

  it("refuses RE-ATTRIBUTION to another agreement", async () => {
    await settleStructureDay();
    // Writing the same day and labour type under Compound Wall would leave the
    // settled Structure row in place and count the work twice.
    await expect(
      labor.setQuantity({
        projectId: SKY, date: DATE, subcategoryId: MASON, quantity: 6,
        contractorId: PAPPU, contractId: COMPOUND_WALL,
      }),
    ).rejects.toThrow("ATTENDANCE_SETTLED");
  });

  it("becomes editable again once the settlement is reversed", async () => {
    const s = await settleStructureDay();
    await contractors.reverseSettlement(s.id, "Wrong headcount");
    await labor.setQuantity({
      projectId: SKY, date: DATE, subcategoryId: MASON, quantity: 8,
      contractorId: PAPPU, contractId: STRUCTURE,
    });
    const row = (await labor.listAttendance({ projectId: SKY, from: DATE, to: DATE }))[0];
    expect(row.quantityPresent).toBe(8);
  });
});

describe("commercial linkage", () => {
  it("settled agreement labour becomes that agreement's Attendance Credit", async () => {
    const before = (await contracts.getContract(STRUCTURE))!.contract.reconciliation;

    await labor.setQuantity({
      projectId: SKY, date: DATE, subcategoryId: MASON, quantity: 6,
      contractorId: PAPPU, contractId: STRUCTURE,
    });
    // Recorded but unsettled: informational only, never credit.
    const recorded = (await contracts.getContract(STRUCTURE))!.contract.reconciliation;
    expect(recorded.attendanceCreditPaise).toBe(before.attendanceCreditPaise);

    await contractors.createSettlement({
      contractorId: PAPPU,
      projectId: SKY,
      periodStart: DATE,
      periodEnd: DATE,
      advanceAdjustmentPaise: 0,
    });
    const after = (await contracts.getContract(STRUCTURE))!.contract.reconciliation;
    expect(after.attendanceCreditPaise).toBe(before.attendanceCreditPaise + 6 * 90_000);
  });

  it("a labour advance changes settlement cash-out, never agreement credit", async () => {
    await labor.setQuantity({
      projectId: SKY, date: DATE, subcategoryId: MASON, quantity: 6,
      contractorId: PAPPU, contractId: STRUCTURE,
    });
    const bill = 6 * 90_000;
    const before = (await contracts.getContract(STRUCTURE))!.contract.reconciliation;

    // The seeded ₹2,00,000 project-scoped advance covers this bill entirely.
    const settlement = await contractors.createSettlement({
      contractorId: PAPPU,
      projectId: SKY,
      periodStart: DATE,
      periodEnd: DATE,
      advanceAdjustmentPaise: bill,
    });
    expect(settlement.netPaymentPaise).toBe(0); // no new cash left the bank

    const after = (await contracts.getContract(STRUCTURE))!.contract.reconciliation;
    // Credit is the SETTLED LABOUR, not the labour plus the advance that
    // pre-paid it — the advance is a cash-timing instrument, not a second credit.
    expect(after.attendanceCreditPaise).toBe(before.attendanceCreditPaise + bill);
  });
});

describe("configuring scope from the UI reaches the attendance sheet", () => {
  it("adding labour types to a new agreement exposes exactly those, at their agreed rates", async () => {
    // Ramesh holds no agreements — the attendance-only contractor.
    const before = await groupFor(SKY, RAMESH);
    expect(before.agreements).toEqual([]);

    const agreement = await contracts.createContract({
      contractorId: RAMESH,
      projectId: SKY,
      title: "Complete Exterior",
      contractAmountPaise: 15_00_000 * 100,
      startDate: "2026-01-01",
    });

    // An agreement with no scope is not yet offerable — there is nothing to
    // record against it.
    expect((await groupFor(SKY, RAMESH)).agreements).toEqual([]);

    await contracts.addScopeItem({
      contractId: agreement.id,
      labourSubcategoryId: MASON,
      ratePaise: 110_000,
      effectiveFrom: "2026-01-01",
    });
    await contracts.addScopeItem({
      contractId: agreement.id,
      labourSubcategoryId: MASON_HELPER,
      ratePaise: 55_000,
      effectiveFrom: "2026-01-01",
    });

    // Scope & Labour and Rates both read the same items.
    const scope = await contracts.listScopeItems(agreement.id);
    expect(scope.map((s) => s.subcategoryName).sort()).toEqual(["Mason", "Mason Helper"]);
    // Names resolve from the shared taxonomy, not a contractor-specific copy.
    expect(scope.every((s) => s.categoryName === "Mason")).toBe(true);
    expect((await contracts.listRateRevisions(scope[0].id))[0].ratePaise).toBe(
      scope[0].currentRatePaise,
    );

    // The attendance sheet now offers exactly those two, at the agreed rates —
    // NOT Ramesh's project-level Carpenter rates.
    const g = await groupFor(SKY, RAMESH);
    expect(g.agreements.map((a) => a.title)).toEqual(["Complete Exterior"]);
    expect(g.requiresAgreementChoice).toBe(false); // one agreement → auto-selected
    expect(g.rows.map((r) => r.subcategoryId).sort()).toEqual([MASON, MASON_HELPER].sort());
    expect(g.rows.every((r) => r.contractId === agreement.id)).toBe(true);
    expect(g.rows.find((r) => r.subcategoryId === MASON)!.dailyRatePaise).toBe(110_000);
    expect(g.rows.find((r) => r.subcategoryId === MASON_HELPER)!.dailyRatePaise).toBe(55_000);
  });

  it("the labour type stays shared — two agreements price the same Mason differently", async () => {
    const agreement = await contracts.createContract({
      contractorId: RAMESH,
      projectId: SKY,
      title: "Complete Exterior",
      contractAmountPaise: 15_00_000 * 100,
      startDate: "2026-01-01",
    });
    await contracts.addScopeItem({
      contractId: agreement.id,
      labourSubcategoryId: MASON,
      ratePaise: 110_000,
      effectiveFrom: "2026-01-01",
    });

    // Pappu's Structure already prices the SAME subcategory at ₹900.
    const structure = await contracts.listScopeItems(STRUCTURE);
    expect(structure.find((s) => s.labourSubcategoryId === MASON)!.currentRatePaise).toBe(90_000);
    // One company-wide labour type, two agreement-specific prices.
    const ramesh = await contracts.listScopeItems(agreement.id);
    expect(ramesh[0].labourSubcategoryId).toBe(MASON);
    expect(ramesh[0].currentRatePaise).toBe(110_000);
  });

  it("removing a scope item is refused once attendance has used it", async () => {
    const agreement = await contracts.createContract({
      contractorId: RAMESH,
      projectId: SKY,
      title: "Complete Exterior",
      contractAmountPaise: 15_00_000 * 100,
      startDate: "2026-01-01",
    });
    const item = await contracts.addScopeItem({
      contractId: agreement.id,
      labourSubcategoryId: MASON,
      ratePaise: 110_000,
      effectiveFrom: "2026-01-01",
    });

    // Unused → removable.
    await contracts.removeScopeItem(item.id);
    expect(await contracts.listScopeItems(agreement.id)).toEqual([]);

    // Re-add, record labour against it, and it is pinned: that row resolves its
    // rate through this item's history, so the history has to stay resolvable.
    const again = await contracts.addScopeItem({
      contractId: agreement.id,
      labourSubcategoryId: MASON,
      ratePaise: 110_000,
      effectiveFrom: "2026-01-01",
    });
    await labor.setQuantity({
      projectId: SKY, date: DATE, subcategoryId: MASON, quantity: 3,
      contractorId: RAMESH, contractId: agreement.id,
    });
    await expect(contracts.removeScopeItem(again.id)).rejects.toThrow("SCOPE_IN_USE");
    expect(await contracts.listScopeItems(agreement.id)).toHaveLength(1);
  });
});

describe("creating a labour type from where it is needed", () => {
  it("lands in the SHARED taxonomy and links to the agreement that needed it", async () => {
    // Pappu → Structure → create "Tile Mason", company default ₹900, agreement
    // rate ₹1,050 — the worked example.
    const masonry = (await labor.listCategories()).find((c) => c.name === "Mason")!;
    const tileMason = await labor.createSubcategory({
      categoryId: masonry.id,
      name: "Tile Mason",
      dailyRatePaise: 90_000,
    });

    // Shared company master data, not a contractor-specific record.
    const shared = (await labor.listCategories()).find((c) => c.id === masonry.id)!;
    expect(shared.subcategories.map((s) => s.name)).toContain("Tile Mason");
    expect(shared.subcategories.find((s) => s.id === tileMason.id)!.dailyRatePaise).toBe(90_000);

    await contracts.addScopeItem({
      contractId: STRUCTURE,
      labourSubcategoryId: tileMason.id,
      ratePaise: 105_000,
      effectiveFrom: "2026-01-10",
    });

    // Linked to the agreement at ITS rate, with the real taxonomy names.
    const scope = await contracts.listScopeItems(STRUCTURE);
    const item = scope.find((s) => s.labourSubcategoryId === tileMason.id)!;
    expect(item.subcategoryName).toBe("Tile Mason");
    expect(item.categoryName).toBe("Mason");
    expect(item.currentRatePaise).toBe(105_000);
    // The company default is untouched by the agreement's price.
    expect(
      (await labor.listCategories())
        .flatMap((c) => c.subcategories)
        .find((s) => s.id === tileMason.id)!.dailyRatePaise,
    ).toBe(90_000);

    // And the attendance sheet offers it under Structure at ₹1,050.
    const g = await groupFor(SKY, PAPPU);
    const row = g.rows.find(
      (r) => r.contractId === STRUCTURE && r.subcategoryId === tileMason.id,
    )!;
    expect(row.name).toBe("Tile Mason");
    expect(row.dailyRatePaise).toBe(105_000);
  });

  it("another contractor reuses the same type at their own rate", async () => {
    const masonry = (await labor.listCategories()).find((c) => c.name === "Mason")!;
    const tileMason = await labor.createSubcategory({
      categoryId: masonry.id,
      name: "Tile Mason",
      dailyRatePaise: 90_000,
    });
    await contracts.addScopeItem({
      contractId: STRUCTURE,
      labourSubcategoryId: tileMason.id,
      ratePaise: 105_000,
      effectiveFrom: "2026-01-10",
    });

    const rameshAgreement = await contracts.createContract({
      contractorId: RAMESH,
      projectId: SKY,
      title: "Complete Exterior",
      contractAmountPaise: 15_00_000 * 100,
      startDate: "2026-01-01",
    });
    await contracts.addScopeItem({
      contractId: rameshAgreement.id,
      labourSubcategoryId: tileMason.id,
      ratePaise: 98_000,
      effectiveFrom: "2026-01-01",
    });

    // ONE shared labour type; two agreements; two prices.
    const all = (await labor.listCategories()).flatMap((c) => c.subcategories);
    expect(all.filter((s) => s.name === "Tile Mason")).toHaveLength(1);
    expect(
      (await contracts.listScopeItems(STRUCTURE)).find(
        (s) => s.labourSubcategoryId === tileMason.id,
      )!.currentRatePaise,
    ).toBe(105_000);
    expect(
      (await contracts.listScopeItems(rameshAgreement.id)).find(
        (s) => s.labourSubcategoryId === tileMason.id,
      )!.currentRatePaise,
    ).toBe(98_000);
  });

  it("an attendance-only contractor gets one without any agreement", async () => {
    const masonry = (await labor.listCategories()).find((c) => c.name === "Mason")!;
    const tiler = await labor.createSubcategory({
      categoryId: masonry.id,
      name: "Tile Mason",
      dailyRatePaise: 90_000,
    });

    // Ramesh holds no agreements — the type joins his project labour rates.
    const current = (await projects.listProjectContractors(SKY)).map((pc) => ({
      contractorId: pc.contractorId,
      contractRatePaise: pc.contractRatePaise,
      contractRateUnit: pc.contractRateUnit,
      labourRates: [
        ...pc.labourRates.map((lr) => ({
          labourSubcategoryId: lr.labourSubcategoryId,
          ratePaise: lr.ratePaise,
          rateUnit: lr.rateUnit,
        })),
        ...(pc.contractorId === RAMESH
          ? [{ labourSubcategoryId: tiler.id, ratePaise: 95_000, rateUnit: "day" }]
          : []),
      ],
    }));
    await projects.setProjectContractors(SKY, current);

    const g = await groupFor(SKY, RAMESH);
    expect(g.agreements).toEqual([]); // still attendance-only
    const row = g.rows.find((r) => r.subcategoryId === tiler.id)!;
    expect(row.name).toBe("Tile Mason");
    expect(row.contractId).toBeNull();
    expect(row.dailyRatePaise).toBe(95_000);
  });
});

describe("backward compatibility", () => {
  it("attendance recorded before agreements still reads and edits", async () => {
    // The seeded Pappu week carries contractId null — a legitimate legacy state.
    const legacy = (await labor.listAttendance({ projectId: SKY }))
      .filter((r) => r.contractorId === PAPPU && r.contractId === null);
    expect(legacy.length).toBeGreaterThan(0);

    const first = legacy[0];
    await labor.setQuantity({
      projectId: SKY, date: first.date, subcategoryId: first.subcategoryId,
      quantity: first.quantityPresent + 1, contractorId: PAPPU,
    });
    const updated = (await labor.listAttendance({ projectId: SKY, from: first.date, to: first.date }))
      .find(
        (r) =>
          r.contractorId === PAPPU && r.subcategoryId === first.subcategoryId && r.contractId === null,
      )!;
    expect(updated.quantityPresent).toBe(first.quantityPresent + 1);
  });

  it("an agreement is never required just to record attendance", async () => {
    const sheet = await labor.getSheet(SKY, DATE);
    const ramesh = sheet.groups.find((g) => g.contractorId === RAMESH)!;
    await labor.setQuantity({
      projectId: SKY, date: DATE, subcategoryId: ramesh.rows[0].subcategoryId,
      quantity: 5, contractorId: RAMESH,
    });
    const row = (await labor.listAttendance({ projectId: SKY, from: DATE, to: DATE }))[0];
    expect(row.quantityPresent).toBe(5);
    expect(row.contractId).toBeNull();
  });
});

/* ── The archived-contractor boundary (Pass 5.1) ─────────────────────────── */

/**
 * Demo parity for the rule the server enforces: an archived contractor takes on
 * NO new attendance, but everything already recorded stays visible, stays
 * correctable, and stays settleable. Exercised here because the demo store is
 * what the browser walkthrough drives.
 */
describe("archiving a contractor stops new attendance, not closure", () => {
  it("records attendance while ACTIVE, then refuses a new day once archived", async () => {
    await labor.setQuantity({
      projectId: SKY,
      date: DATE,
      subcategoryId: MASON,
      quantity: 6,
      contractorId: PAPPU,
      contractId: STRUCTURE,
    });

    await contractors.archiveContractor(PAPPU);

    await expect(
      labor.setQuantity({
        projectId: SKY,
        date: "2026-06-16",
        subcategoryId: MASON,
        quantity: 4,
        contractorId: PAPPU,
        contractId: STRUCTURE,
      }),
    ).rejects.toThrow("CONTRACTOR_ARCHIVED");
  });

  it("offers no blank rows while archived, but keeps the recorded one", async () => {
    await labor.setQuantity({
      projectId: SKY,
      date: DATE,
      subcategoryId: MASON,
      quantity: 6,
      contractorId: PAPPU,
      contractId: STRUCTURE,
    });
    const before = await groupFor(SKY, PAPPU);
    expect(before.archived).toBe(false);
    expect(before.rows.length).toBeGreaterThan(1);

    await contractors.archiveContractor(PAPPU);

    const after = await groupFor(SKY, PAPPU);
    expect(after.archived).toBe(true);
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0].quantity).toBe(6);
    // The value is untouched — archiving moves no money.
    expect(after.estimatedCostPaise).toBe(before.estimatedCostPaise);
  });

  it("still allows CORRECTING and CLEARING the row recorded before archiving", async () => {
    await labor.setQuantity({
      projectId: SKY,
      date: DATE,
      subcategoryId: MASON,
      quantity: 6,
      contractorId: PAPPU,
      contractId: STRUCTURE,
    });
    await contractors.archiveContractor(PAPPU);

    await labor.setQuantity({
      projectId: SKY,
      date: DATE,
      subcategoryId: MASON,
      quantity: 7,
      contractorId: PAPPU,
      contractId: STRUCTURE,
    });
    expect((await groupFor(SKY, PAPPU)).rows[0].quantity).toBe(7);

    await labor.setQuantity({
      projectId: SKY,
      date: DATE,
      subcategoryId: MASON,
      quantity: 0,
      contractorId: PAPPU,
      contractId: STRUCTURE,
    });
    // The group survives (they are still assigned to the project), but with no
    // rows at all — nothing recorded, and nothing offered while archived.
    const cleared = await groupFor(SKY, PAPPU);
    expect(cleared.rows).toEqual([]);
    expect(cleared.estimatedCostPaise).toBe(0);
  });

  it("RESTORING brings the blank rows and new attendance back", async () => {
    await contractors.archiveContractor(PAPPU);
    await contractors.restoreContractor(PAPPU);

    await labor.setQuantity({
      projectId: SKY,
      date: DATE,
      subcategoryId: MASON,
      quantity: 3,
      contractorId: PAPPU,
      contractId: STRUCTURE,
    });
    const g = await groupFor(SKY, PAPPU);
    expect(g.archived).toBe(false);
    expect(g.rows.find((r) => r.subcategoryId === MASON)!.quantity).toBe(3);
  });
});
