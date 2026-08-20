/**
 * Governed re-scope of unused advance money, on the real engine and the demo
 * stores.
 *
 * The invariant every test here defends:
 *
 *   A RE-SCOPE MOVES AVAILABILITY, NEVER MONEY.
 *
 * The contractor's total advance balance is unchanged, no cash is paid, and
 * nothing historical moves — the original advance row, the drawdowns taken from
 * it, and the settlements it funded all stay put. Only what the money may fund
 * NEXT changes.
 *
 * The one that would be easiest to get wrong and hardest to notice: transferred
 * money must be SPENDABLE at its new scope. Forget that and the balance still
 * reconciles perfectly while the money is stranded — the exact disease this
 * feature was built to cure.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  advanceBalancePaise,
  allocateAdvanceDrawdown,
  outstandingPerAdvance,
  type ScopedLedgerEntry,
} from "./calc";
import {
  isBroadening,
  isSameScope,
  isTransferSource,
  rescopeBlockers,
  rescopeWarnings,
  scopeKind,
} from "./advance-rescope";
import { demoContractorsRepository as contractors } from "./demo/demo-repository";
import { demoContractsRepository as contracts } from "@/features/contracts/demo/demo-repository";
import { demoRepository as projects } from "@/features/projects/demo/demo-repository";

const L = (lakhs: number) => lakhs * 100_000 * 100;
const SKY = "10000000-0000-0000-0000-000000000001";
const ORION = "10000000-0000-0000-0000-000000000002";
const STRUCTURE = "ag-structure";
const WALL = "ag-compound-wall";
const PAPPU = "c-pappu";

const entry = (
  id: string,
  type: ScopedLedgerEntry["type"],
  amountPaise: number,
  over: Partial<ScopedLedgerEntry> = {},
): ScopedLedgerEntry => ({
  id,
  type,
  amountPaise,
  projectId: null,
  contractId: null,
  drawsFromEntryId: null,
  reversesEntryId: null,
  date: "2026-01-01",
  ...over,
});

/* ── Pure ledger semantics ──────────────────────────────────────────────── */

describe("the transfer pair is balance-neutral", () => {
  it("OUT decreases and IN increases by the same amount", () => {
    const ledger = [
      entry("a", "ADVANCE", L(5), { projectId: SKY, contractId: STRUCTURE }),
      entry("out", "SCOPE_TRANSFER_OUT", L(2), {
        projectId: SKY,
        contractId: STRUCTURE,
        drawsFromEntryId: "a",
      }),
      entry("in", "SCOPE_TRANSFER_IN", L(2), { drawsFromEntryId: "out" }),
    ];
    // ₹5L in, ₹2L out, ₹2L back in — exactly the ₹5L that was paid.
    expect(advanceBalancePaise(ledger)).toBe(L(5));
    expect(advanceBalancePaise([ledger[0]])).toBe(advanceBalancePaise(ledger));
  });

  it("holds for every partial amount", () => {
    for (const amt of [1, L(0.5), L(1), L(3)]) {
      const before = [entry("a", "ADVANCE", L(3))];
      const after = [
        ...before,
        entry("out", "SCOPE_TRANSFER_OUT", amt, { drawsFromEntryId: "a" }),
        entry("in", "SCOPE_TRANSFER_IN", amt, { projectId: SKY, drawsFromEntryId: "out" }),
      ];
      expect(advanceBalancePaise(after)).toBe(advanceBalancePaise(before));
    }
  });
});

describe("what a transfer does to availability", () => {
  const base = [
    entry("a", "ADVANCE", L(5), { projectId: SKY, contractId: STRUCTURE }),
    entry("adj", "ADJUSTMENT", L(2), { drawsFromEntryId: "a" }), // a settlement drew ₹2L
  ];

  it("drains exactly its source, and nothing else", () => {
    const withTransfer = [
      ...base,
      entry("out", "SCOPE_TRANSFER_OUT", L(2), {
        projectId: SKY,
        contractId: STRUCTURE,
        drawsFromEntryId: "a",
      }),
      entry("in", "SCOPE_TRANSFER_IN", L(2), { drawsFromEntryId: "out" }),
    ];
    const remaining = outstandingPerAdvance(withTransfer);
    // ₹5L − ₹2L settled − ₹2L moved = ₹1L still reserved for Structure.
    expect(remaining.find((r) => r.entryId === "a")!.remainingPaise).toBe(L(1));
  });

  it("makes the transferred money a SPENDABLE source at the new scope", () => {
    const withTransfer = [
      ...base,
      entry("out", "SCOPE_TRANSFER_OUT", L(2), { drawsFromEntryId: "a" }),
      entry("in", "SCOPE_TRANSFER_IN", L(2), { drawsFromEntryId: "out" }),
    ];
    const inSource = outstandingPerAdvance(withTransfer).find((r) => r.entryId === "in");
    // If this is ever missing, the balance still reconciles and the money is
    // unspendable — a silent regression. That is why it has its own test.
    expect(inSource).toBeDefined();
    expect(inSource!.remainingPaise).toBe(L(2));
    expect(inSource!.contractId).toBeNull();
  });

  it("lets the allocator actually draw on transferred money", () => {
    const ledger = [
      entry("a", "ADVANCE", L(5), { projectId: SKY, contractId: STRUCTURE }),
      entry("out", "SCOPE_TRANSFER_OUT", L(2), {
        projectId: SKY,
        contractId: STRUCTURE,
        drawsFromEntryId: "a",
      }),
      entry("in", "SCOPE_TRANSFER_IN", L(2), { drawsFromEntryId: "out" }), // now GENERAL
    ];
    const allocations = allocateAdvanceDrawdown({
      outstanding: outstandingPerAdvance(ledger),
      requestedPaise: L(2),
      projectId: SKY,
      composition: new Map([[WALL, L(2)]]), // Compound Wall labour only
    });
    // Structure's remaining ₹3L is still protected; the transferred ₹2L funds it.
    expect(allocations.map((x) => x.entryId)).toEqual(["in"]);
    expect(allocations[0].amountPaise).toBe(L(2));
  });

  it("supports a NESTED transfer — transferred money can be moved again", () => {
    const ledger = [
      entry("a", "ADVANCE", L(5), { projectId: SKY, contractId: STRUCTURE }),
      entry("out1", "SCOPE_TRANSFER_OUT", L(3), { drawsFromEntryId: "a" }),
      entry("in1", "SCOPE_TRANSFER_IN", L(3), { projectId: SKY, drawsFromEntryId: "out1" }),
      entry("out2", "SCOPE_TRANSFER_OUT", L(1), { projectId: SKY, drawsFromEntryId: "in1" }),
      entry("in2", "SCOPE_TRANSFER_IN", L(1), { drawsFromEntryId: "out2" }),
    ];
    const r = outstandingPerAdvance(ledger);
    expect(r.find((x) => x.entryId === "a")!.remainingPaise).toBe(L(2));
    expect(r.find((x) => x.entryId === "in1")!.remainingPaise).toBe(L(2));
    expect(r.find((x) => x.entryId === "in2")!.remainingPaise).toBe(L(1));
    expect(advanceBalancePaise(ledger)).toBe(L(5));
  });

  it("returns reversed settlement money to the SOURCE scope, not the transfer target", () => {
    // The Pass 10A arithmetic: A=₹5L Structure, S1 drew ₹2L, ₹2L moved to
    // General, then S1 reversed.
    const ledger = [
      entry("a", "ADVANCE", L(5), { projectId: SKY, contractId: STRUCTURE }),
      entry("adj", "ADJUSTMENT", L(2), { drawsFromEntryId: "a" }),
      entry("out", "SCOPE_TRANSFER_OUT", L(2), {
        projectId: SKY,
        contractId: STRUCTURE,
        drawsFromEntryId: "a",
      }),
      entry("in", "SCOPE_TRANSFER_IN", L(2), { drawsFromEntryId: "out" }),
      entry("rev", "SETTLEMENT_REVERSAL", L(2), { reversesEntryId: "adj" }),
    ];
    const r = outstandingPerAdvance(ledger);
    // Structure regains the ₹2L S1 spent — S1 consumed Structure money, so that
    // is where it belongs. The transferred ₹2L stays General.
    expect(r.find((x) => x.entryId === "a")!.remainingPaise).toBe(L(3));
    expect(r.find((x) => x.entryId === "in")!.remainingPaise).toBe(L(2));
  });
});

/* ── Direction rules ────────────────────────────────────────────────────── */

describe("scope directions", () => {
  const GENERAL = { projectId: null, contractId: null };
  const PROJECT = { projectId: SKY, contractId: null };
  const AGREEMENT = { projectId: SKY, contractId: STRUCTURE };

  it("classifies each scope", () => {
    expect(scopeKind(GENERAL)).toBe("GENERAL");
    expect(scopeKind(PROJECT)).toBe("PROJECT");
    expect(scopeKind(AGREEMENT)).toBe("AGREEMENT");
  });

  it("warns on the three broadening directions and no others", () => {
    expect(rescopeWarnings(AGREEMENT, PROJECT)).toEqual(["BROADENING_SCOPE"]);
    expect(rescopeWarnings(AGREEMENT, GENERAL)).toEqual(["BROADENING_SCOPE"]);
    expect(rescopeWarnings(PROJECT, GENERAL)).toEqual(["BROADENING_SCOPE"]);
    expect(rescopeWarnings(GENERAL, PROJECT)).toEqual([]);
    expect(rescopeWarnings(GENERAL, AGREEMENT)).toEqual([]);
    expect(rescopeWarnings(PROJECT, AGREEMENT)).toEqual([]);
  });

  it("treats a different project as neither broader nor narrower", () => {
    expect(isBroadening(PROJECT, { projectId: ORION, contractId: null })).toBe(false);
    expect(isSameScope(PROJECT, { projectId: ORION, contractId: null })).toBe(false);
  });
});

describe("what may be a transfer source", () => {
  it("accepts real advances and transferred-in money", () => {
    expect(isTransferSource("ADVANCE", null)).toBe(true);
    expect(isTransferSource("OPENING_ADVANCE", null)).toBe(true);
    expect(isTransferSource("SCOPE_TRANSFER_IN", null)).toBe(true);
    // Unapplied cash from a reversal is a genuine advance.
    expect(isTransferSource("SETTLEMENT_REVERSAL", null)).toBe(true);
  });

  it("rejects everything that is not money you hold", () => {
    // A restoring reversal corrects another advance; it is not one itself.
    expect(isTransferSource("SETTLEMENT_REVERSAL", "adj-1")).toBe(false);
    expect(isTransferSource("ADJUSTMENT", null)).toBe(false);
    expect(isTransferSource("LABOUR_BILL", null)).toBe(false);
    expect(isTransferSource("PAYMENT", null)).toBe(false);
    expect(isTransferSource("SCOPE_TRANSFER_OUT", null)).toBe(false);
  });
});

describe("blockers", () => {
  const from = { projectId: SKY, contractId: STRUCTURE };
  const to = { projectId: null, contractId: null };
  const check = (over = {}) => ({ remainingPaise: L(3), transferPaise: L(2), from, to, ...over });

  it("passes a clean transfer", () => {
    expect(rescopeBlockers(check())).toEqual([]);
  });

  it("refuses more than remains — never silently clamps", () => {
    // Clamping would leave the user believing money is somewhere it is not.
    expect(rescopeBlockers(check({ transferPaise: L(4) }))).toContain("OVER_TRANSFER");
  });

  it("refuses an exhausted source, zero and negative amounts", () => {
    expect(rescopeBlockers(check({ remainingPaise: 0 }))).toContain("SOURCE_EXHAUSTED");
    expect(rescopeBlockers(check({ transferPaise: 0 }))).toContain("INVALID_AMOUNT");
    expect(rescopeBlockers(check({ transferPaise: -1 }))).toContain("INVALID_AMOUNT");
  });

  it("refuses a move that changes nothing", () => {
    expect(rescopeBlockers(check({ to: from }))).toContain("NO_SCOPE_CHANGE");
  });

  it("refuses an agreement target with no project — unrepresentable", () => {
    expect(rescopeBlockers(check({ to: { projectId: null, contractId: STRUCTURE } }))).toContain(
      "TARGET_AGREEMENT_INVALID",
    );
  });
});

/* ── End to end on the demo stores ──────────────────────────────────────── */

const ledgerOf = async () => (await contractors.getLedger(PAPPU)).entries;
const balanceOf = async () => (await contractors.getLedger(PAPPU)).contractor.advanceBalancePaise;

beforeEach(async () => {
  localStorage.clear();
  await projects.list({});
  await contracts.listContracts();
  await contractors.listContractors();
});

/** Record a scoped advance and return its ledger entry id. */
async function advance(amountPaise: number, scope: { projectId?: string; contractId?: string }) {
  await contractors.recordAdvance({
    contractorId: PAPPU,
    date: "2026-06-01",
    amountPaise,
    notes: null,
    ...scope,
  });
  return (await ledgerOf()).filter((e) => e.type === "ADVANCE").at(-1)!.id;
}

describe("re-scoping end to end", () => {
  it("moves availability and leaves the balance exactly where it was", async () => {
    const id = await advance(L(5), { projectId: SKY, contractId: STRUCTURE });
    const balanceBefore = await balanceOf();

    const res = await contractors.rescopeAdvance({
      contractorId: PAPPU,
      advanceId: id,
      target: { projectId: null, contractId: null },
      transferPaise: L(2),
      reason: "Agreement scope corrected",
    });
    expect("blockers" in res).toBe(false);

    expect(await balanceOf()).toBe(balanceBefore);
    const rows = await ledgerOf();
    expect(rows.some((e) => e.type === "SCOPE_TRANSFER_OUT")).toBe(true);
    expect(rows.some((e) => e.type === "SCOPE_TRANSFER_IN")).toBe(true);
    // The original advance row is untouched.
    const original = rows.find((e) => e.id === id)!;
    expect(original.amountPaise).toBe(L(5));
    expect(original.contractId).toBe(STRUCTURE);
  });

  it("previews the exact figures the write produces", async () => {
    const id = await advance(L(5), { projectId: SKY, contractId: STRUCTURE });
    const preview = await contractors.previewAdvanceRescope({
      contractorId: PAPPU,
      advanceId: id,
      target: { projectId: null, contractId: null },
      transferPaise: L(2),
    });
    if (!("source" in preview)) throw new Error("expected a preview");

    expect(preview.cashImpactPaise).toBe(0);
    expect(preview.historicalSettlementImpactPaise).toBe(0);
    expect(preview.before.contractorBalancePaise).toBe(preview.after.contractorBalancePaise);
    expect(preview.after.sourceAvailablePaise).toBe(L(3));
    expect(preview.warnings).toContain("BROADENING_SCOPE");

    await contractors.rescopeAdvance({
      contractorId: PAPPU,
      advanceId: id,
      target: { projectId: null, contractId: null },
      transferPaise: L(2),
      reason: "x",
    });
    expect(await balanceOf()).toBe(preview.after.contractorBalancePaise);
  });

  it("supports a partial transfer, leaving the rest at the original scope", async () => {
    const id = await advance(L(5), { projectId: SKY, contractId: STRUCTURE });
    await contractors.rescopeAdvance({
      contractorId: PAPPU,
      advanceId: id,
      target: { projectId: SKY, contractId: null },
      transferPaise: L(1),
      reason: "Project allocation corrected",
    });
    const preview = await contractors.previewAdvanceRescope({
      contractorId: PAPPU,
      advanceId: id,
      target: { projectId: null, contractId: null },
      transferPaise: 1,
    });
    if (!("source" in preview)) throw new Error("expected a preview");
    expect(preview.source.remainingPaise).toBe(L(4));
    expect(preview.source.transferredOutPaise).toBe(L(1));
  });

  it("refuses to move more than remains", async () => {
    const id = await advance(L(2), { projectId: SKY, contractId: STRUCTURE });
    const res = await contractors.rescopeAdvance({
      contractorId: PAPPU,
      advanceId: id,
      target: { projectId: null, contractId: null },
      transferPaise: L(3),
      reason: "x",
    });
    expect("blockers" in res && res.blockers).toContain("OVER_TRANSFER");
  });

  it("requires a reason", async () => {
    const id = await advance(L(2), { projectId: SKY, contractId: STRUCTURE });
    const res = await contractors.rescopeAdvance({
      contractorId: PAPPU,
      advanceId: id,
      target: { projectId: null, contractId: null },
      transferPaise: L(1),
      reason: "   ",
    });
    expect(res).toMatchObject({ blockers: ["REASON_REQUIRED"] });
  });

  it("refuses a cancelled or settled TARGET agreement", async () => {
    const id = await advance(L(3), {});
    await contracts.cancelContract(WALL, "Not going ahead");
    const res = await contractors.rescopeAdvance({
      contractorId: PAPPU,
      advanceId: id,
      target: { projectId: SKY, contractId: WALL },
      transferPaise: L(1),
      reason: "x",
    });
    expect("blockers" in res && res.blockers).toContain("TARGET_AGREEMENT_CANCELLED");
  });

  it("ALLOWS moving money OUT of a cancelled agreement — that is the point", async () => {
    const id = await advance(L(3), { projectId: SKY, contractId: WALL });
    await contracts.cancelContract(WALL, "Not going ahead");
    const res = await contractors.rescopeAdvance({
      contractorId: PAPPU,
      advanceId: id,
      target: { projectId: null, contractId: null },
      transferPaise: L(3),
      reason: "Agreement cancelled",
    });
    expect("blockers" in res).toBe(false);
  });
});

describe("reversing a re-scope", () => {
  it("returns the money to its original scope while it is untouched", async () => {
    const id = await advance(L(5), { projectId: SKY, contractId: STRUCTURE });
    const balanceBefore = await balanceOf();
    const applied = await contractors.rescopeAdvance({
      contractorId: PAPPU,
      advanceId: id,
      target: { projectId: null, contractId: null },
      transferPaise: L(2),
      reason: "Wrong scope",
    });
    if ("blockers" in applied) throw new Error("expected success");

    const res = await contractors.reverseAdvanceRescope({
      transferId: applied.transferId,
      reason: "Re-scoped in error",
    });
    expect("blockers" in res).toBe(false);
    expect(await balanceOf()).toBe(balanceBefore);

    const preview = await contractors.previewAdvanceRescope({
      contractorId: PAPPU,
      advanceId: id,
      target: { projectId: SKY, contractId: null },
      transferPaise: 1,
    });
    if (!("source" in preview)) throw new Error("expected a preview");
    // Structure is whole again.
    expect(preview.source.remainingPaise).toBe(L(5) - L(2));
  });

  it("cannot be reversed twice", async () => {
    const id = await advance(L(3), { projectId: SKY, contractId: STRUCTURE });
    const applied = await contractors.rescopeAdvance({
      contractorId: PAPPU,
      advanceId: id,
      target: { projectId: null, contractId: null },
      transferPaise: L(1),
      reason: "x",
    });
    if ("blockers" in applied) throw new Error("expected success");
    await contractors.reverseAdvanceRescope({ transferId: applied.transferId, reason: "x" });
    expect(
      await contractors.reverseAdvanceRescope({ transferId: applied.transferId, reason: "x" }),
    ).toMatchObject({ blockers: ["TRANSFER_ALREADY_REVERSED"] });
  });

  it("REFUSES once part of the transferred money has been spent", async () => {
    const id = await advance(L(3), { projectId: SKY, contractId: STRUCTURE });
    const applied = await contractors.rescopeAdvance({
      contractorId: PAPPU,
      advanceId: id,
      target: { projectId: null, contractId: null },
      transferPaise: L(2),
      reason: "x",
    });
    if ("blockers" in applied) throw new Error("expected success");

    // Spend part of the transferred-in money by hand-stamping a drawdown, which
    // is what a settlement would do.
    const rows = JSON.parse(localStorage.getItem("constructly.demo.contractorLedger.v1")!);
    const inRow = rows.find(
      (e: { type: string; drawsFromEntryId: string }) =>
        e.type === "SCOPE_TRANSFER_IN" && e.drawsFromEntryId === applied.transferId,
    );
    rows.push({
      ...inRow,
      id: "spend-1",
      type: "ADJUSTMENT",
      amountPaise: L(0.5),
      drawsFromEntryId: inRow.id,
    });
    localStorage.setItem("constructly.demo.contractorLedger.v1", JSON.stringify(rows));

    const res = await contractors.reverseAdvanceRescope({
      transferId: applied.transferId,
      reason: "x",
    });
    // Partially unwinding would have to invent which half came back.
    expect(res).toMatchObject({ blockers: ["TRANSFER_ALREADY_CONSUMED"] });
  });
});
