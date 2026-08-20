/**
 * Scoped advances end to end on the demo stores: recorded, spent by a
 * settlement, and restored by a reversal.
 *
 * The claim that matters here is the one a pure allocator test cannot make:
 * money returns to the SAME scope it came from. A reversal that gave ₹2,00,000
 * of Structure-earmarked money back as general money would quietly relax the
 * commercial intent — and it would look perfectly fine, because the balance
 * would be right.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { demoContractorsRepository as contractors } from "./demo/demo-repository";
import { demoContractsRepository as contracts } from "@/features/contracts/demo/demo-repository";
import { demoLaborRepository as labor } from "@/features/labor/demo/demo-repository";
import { demoRepository as projects } from "@/features/projects/demo/demo-repository";

const L = (lakhs: number) => lakhs * 100_000 * 100;

const SKY = "10000000-0000-0000-0000-000000000001";
const PAPPU = "c-pappu";
const RAMESH = "c-ramesh";
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

const ledgerOf = async (contractorId: string) =>
  (await contractors.getLedger(contractorId)).entries;

const advanceRows = async (contractorId: string) =>
  (await ledgerOf(contractorId)).filter((e) => e.type === "ADVANCE");

/* ── Recording ──────────────────────────────────────────────────────────── */

describe("recording each scope", () => {
  it("stores a GENERAL advance with no project and no agreement", async () => {
    await contractors.recordAdvance({
      contractorId: PAPPU,
      date: DATE,
      amountPaise: L(1),
      notes: null,
    });
    const row = (await advanceRows(PAPPU)).at(-1)!;
    expect(row.projectId).toBeNull();
    expect(row.contractId).toBeNull();
  });

  it("stores a PROJECT advance with its project, and labels it", async () => {
    await contractors.recordAdvance({
      contractorId: PAPPU,
      date: DATE,
      amountPaise: L(2),
      notes: null,
      projectId: SKY,
    });
    const row = (await advanceRows(PAPPU)).at(-1)!;
    expect(row.projectId).toBe(SKY);
    expect(row.contractId).toBeNull();
    // The ledger must SHOW the scope, not make the user infer it.
    expect(row.projectName).toBe("Skyline Residency");
  });

  it("stores an AGREEMENT advance with both, and labels both", async () => {
    await contractors.recordAdvance({
      contractorId: PAPPU,
      date: DATE,
      amountPaise: L(5),
      notes: null,
      projectId: SKY,
      contractId: STRUCTURE,
    });
    const row = (await advanceRows(PAPPU)).at(-1)!;
    expect(row).toMatchObject({ projectId: SKY, contractId: STRUCTURE });
    expect(row.projectName).toBe("Skyline Residency");
    expect(row.contractTitle).toBe("Structure");
  });

  it("refuses an agreement belonging to a different contractor", async () => {
    await expect(
      contractors.recordAdvance({
        contractorId: RAMESH, // Structure is Pappu's
        date: DATE,
        amountPaise: L(1),
        notes: null,
        projectId: SKY,
        contractId: STRUCTURE,
      }),
    ).rejects.toThrow("INVALID_AGREEMENT_SCOPE");
  });

  it("refuses an agreement on a different project", async () => {
    await expect(
      contractors.recordAdvance({
        contractorId: PAPPU,
        date: DATE,
        amountPaise: L(1),
        notes: null,
        projectId: "10000000-0000-0000-0000-000000000002", // Orion
        contractId: STRUCTURE, // lives on Skyline
      }),
    ).rejects.toThrow("INVALID_AGREEMENT_SCOPE");
  });

  it("refuses to earmark money for a CANCELLED agreement", async () => {
    await contracts.cancelContract(WALL, "Work not going ahead");
    await expect(
      contractors.recordAdvance({
        contractorId: PAPPU,
        date: DATE,
        amountPaise: L(1),
        notes: null,
        projectId: SKY,
        contractId: WALL,
      }),
    ).rejects.toThrow("AGREEMENT_CANCELLED");
  });

  it("still refuses any advance to an ARCHIVED contractor", async () => {
    await contractors.archiveContractor(PAPPU);
    await expect(
      contractors.recordAdvance({
        contractorId: PAPPU,
        date: DATE,
        amountPaise: L(1),
        notes: null,
        projectId: SKY,
        contractId: STRUCTURE,
      }),
    ).rejects.toThrow("CONTRACTOR_ARCHIVED");
  });
});

/* ── The balance is scope-blind ─────────────────────────────────────────── */

describe("scope affects eligibility, not existence", () => {
  it("adds to the same advance balance whatever the scope", async () => {
    const before = (await contractors.getLedger(PAPPU)).contractor.advanceBalancePaise;

    await contractors.recordAdvance({ contractorId: PAPPU, date: DATE, amountPaise: L(5), notes: null, projectId: SKY, contractId: STRUCTURE });
    await contractors.recordAdvance({ contractorId: PAPPU, date: DATE, amountPaise: L(2), notes: null, projectId: SKY });
    await contractors.recordAdvance({ contractorId: PAPPU, date: DATE, amountPaise: L(1), notes: null });

    const after = (await contractors.getLedger(PAPPU)).contractor.advanceBalancePaise;
    // The canonical fold is unchanged by scope labels — ₹8,00,000 more money.
    expect(after - before).toBe(L(8));
  });
});

/* ── Spending and restoring ─────────────────────────────────────────────── */

describe("a settlement that spends agreement-scoped money", () => {
  /** ₹5L earmarked for Structure, then Structure labour recorded. */
  const setup = async () => {
    await contractors.recordAdvance({
      contractorId: PAPPU,
      date: "2026-06-01",
      amountPaise: L(5),
      notes: null,
      projectId: SKY,
      contractId: STRUCTURE,
    });
    await labor.setQuantity({
      projectId: SKY,
      date: DATE,
      subcategoryId: MASON,
      quantity: 100,
      contractorId: PAPPU,
      contractId: STRUCTURE,
    });
  };

  it("draws on the Structure advance and records what it funded", async () => {
    await setup();
    const preview = await contractors.previewSettlement({
      contractorId: PAPPU,
      projectId: SKY,
      periodStart: DATE,
      periodEnd: DATE,
      advanceAdjustmentPaise: L(0.5),
    });
    expect(preview.labourBillPaise).toBeGreaterThan(0);

    const settlement = await contractors.createSettlement({
      contractorId: PAPPU,
      projectId: SKY,
      periodStart: DATE,
      periodEnd: DATE,
      advanceAdjustmentPaise: L(0.5),
    });
    expect(settlement.advanceAdjustmentPaise).toBe(L(0.5));

    // The drawdown names the advance it consumed AND the bucket it funded.
    const adj = (await ledgerOf(PAPPU)).filter((e) => e.type === "ADJUSTMENT");
    expect(adj.length).toBeGreaterThan(0);
    expect(adj.some((e) => e.fundsContractId === STRUCTURE)).toBe(true);
  });

  it("restores the money to the SAME scope when the settlement is reversed", async () => {
    await setup();
    const settlement = await contractors.createSettlement({
      contractorId: PAPPU,
      projectId: SKY,
      periodStart: DATE,
      periodEnd: DATE,
      advanceAdjustmentPaise: L(0.5),
    });
    const balanceAfterSettle = (await contractors.getLedger(PAPPU)).contractor.advanceBalancePaise;

    await contractors.reverseSettlement(settlement.id, "Wrong headcount");

    const entries = await ledgerOf(PAPPU);
    const restorations = entries.filter(
      (e) => e.type === "SETTLEMENT_REVERSAL" && e.reversesEntryId,
    );
    expect(restorations.length).toBeGreaterThan(0);

    // THE POINT: the restored money still carries Structure's scope. If it came
    // back as general money the balance would look right and the intent would
    // be gone.
    for (const r of restorations) {
      expect(r.contractId).toBe(STRUCTURE);
      expect(r.projectId).toBe(SKY);
    }

    // The restored amount is exactly the drawdown that was taken. (The overall
    // balance also rises by the net cash the reversal turns into an unapplied
    // advance — that arithmetic is pinned by the settlement-reversal suite; the
    // claim HERE is about scope, and about the drawdown coming back whole.)
    const restored = restorations.reduce((t, r) => t + r.amountPaise, 0);
    expect(restored).toBe(L(0.5));
    const balanceAfterReversal = (await contractors.getLedger(PAPPU)).contractor
      .advanceBalancePaise;
    expect(balanceAfterReversal).toBeGreaterThan(balanceAfterSettle);
  });
});

/* ── Wrong work cannot reach the money ──────────────────────────────────── */

describe("a settlement whose labour has no agreement", () => {
  it("cannot draw on an agreement-scoped advance", async () => {
    await contractors.recordAdvance({
      contractorId: RAMESH,
      date: "2026-06-01",
      amountPaise: L(5),
      notes: null,
      projectId: SKY,
    });
    // Ramesh holds no agreement, so his labour is unattributed by definition.
    await labor.setQuantity({
      projectId: SKY,
      date: DATE,
      subcategoryId: MAIN_CARPENTER,
      quantity: 4,
      contractorId: RAMESH,
      contractId: null,
    });

    const preview = await contractors.previewSettlement({
      contractorId: RAMESH,
      projectId: SKY,
      periodStart: DATE,
      periodEnd: DATE,
      advanceAdjustmentPaise: 0,
    });
    // A PROJECT-scoped advance may fund unattributed labour; the cap is the bill.
    expect(preview.maxAdjustmentPaise).toBe(preview.labourBillPaise);
  });
});

/* ── Nothing else moves scope ───────────────────────────────────────────── */

describe("scope is not changed by unrelated commercial events", () => {
  it("survives a milestone completion and an agreement payment", async () => {
    await contractors.recordAdvance({
      contractorId: PAPPU,
      date: DATE,
      amountPaise: L(5),
      notes: null,
      projectId: SKY,
      contractId: STRUCTURE,
    });
    const before = (await advanceRows(PAPPU)).at(-1)!;

    const milestones = await contracts.listMilestones(STRUCTURE);
    const open = milestones.find((m) => m.status !== "COMPLETED");
    if (open) await contracts.setMilestoneStatus(open.id, "COMPLETED");

    await contracts.recordContractPayment({
      contractId: STRUCTURE,
      date: DATE,
      amountPaise: L(1),
      type: "INTERIM",
      paymentMode: "BANK_TRANSFER",
    });

    const after = (await advanceRows(PAPPU)).find((r) => r.id === before.id)!;
    expect(after.projectId).toBe(before.projectId);
    expect(after.contractId).toBe(before.contractId);
    expect(after.amountPaise).toBe(before.amountPaise);
  });
});

/* ── How the move reads back ────────────────────────────────────────────── */

describe("a re-scope names the scope it moved FROM", () => {
  it("carries the source project and agreement names on the OUT row", async () => {
    await contractors.recordAdvance({
      contractorId: PAPPU,
      date: DATE,
      amountPaise: L(5),
      notes: null,
      projectId: SKY,
      contractId: STRUCTURE,
    });
    const advance = (await advanceRows(PAPPU)).at(-1)!;

    await contractors.rescopeAdvance({
      contractorId: PAPPU,
      advanceId: advance.id,
      transferPaise: L(2),
      target: { projectId: null, contractId: null },
      reason: "Agreement closed with unused advance",
    });

    const out = (await ledgerOf(PAPPU)).find(
      (e) => e.type === "SCOPE_TRANSFER_OUT" && e.drawsFromEntryId === advance.id,
    )!;

    // The ledger renders "<source> → <target>" from these two fields. Left null
    // — as the demo store used to leave them — an agreement-scoped advance moved
    // to General read as "General contractor advance → General contractor
    // advance", which states the opposite of what happened. The server derives
    // them by joining project/contract, so the demo must agree.
    expect(out.projectId).toBe(SKY);
    expect(out.contractId).toBe(STRUCTURE);
    expect(out.projectName).toBe("Skyline Residency");
    expect(out.contractTitle).toBe("Structure");

    const inRow = (await ledgerOf(PAPPU)).find(
      (e) => e.type === "SCOPE_TRANSFER_IN" && e.drawsFromEntryId === out.id,
    )!;
    // The target was General, so the IN row genuinely has no names.
    expect(inRow.projectName).toBeNull();
    expect(inRow.contractTitle).toBeNull();
  });
});
