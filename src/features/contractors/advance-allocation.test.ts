/**
 * Advance allocation — which advances a settlement consumes, and which bucket
 * each drawdown funds.
 *
 * The rule under test is strict-to-broad, and the two failure modes it guards
 * against pull in opposite directions:
 *
 *   • an AGREEMENT-scoped advance must never be spent on labour that hasn't been
 *     attributed to that agreement — the money would be attributed to work it
 *     didn't pay for;
 *   • a PROJECT- or COMPANY-scoped advance must never be stranded just because
 *     attendance *is* attributed — it carries no agreement claim to violate.
 */
import { describe, it, expect } from "vitest";
import {
  allocateAdvanceDrawdown,
  advanceBalanceByScope,
  outstandingPerAdvance,
  unusableAdvances,
  buildSettlementBreakdown,
  type BillComposition,
  type OutstandingAdvance,
  type ScopedLedgerEntry,
} from "./calc";
import { RS_2L, RS_3L, RS_4L, RS_5L, RS_6L, lakhs } from "@/features/contracts/__fixtures__/amounts";

const PROJECT_A = "project-a";
const PROJECT_B = "project-b";
const STRUCTURE = "structure";
const COMPOUND_WALL = "compound-wall";

const advance = (
  entryId: string,
  remainingPaise: number,
  over: Partial<OutstandingAdvance> = {},
): OutstandingAdvance => ({
  entryId,
  projectId: null,
  contractId: null,
  remainingPaise,
  date: "2026-01-01",
  ...over,
});

const composition = (entries: [string | null, number][]): BillComposition => new Map(entries);

const totalOf = (allocations: { amountPaise: number }[]) =>
  allocations.reduce((a, x) => a + x.amountPaise, 0);

/* ── Band A: agreement-scoped is confined to its own bucket ─────────────── */

describe("agreement-scoped advances", () => {
  it("fund only their own agreement's bucket", () => {
    const allocations = allocateAdvanceDrawdown({
      outstanding: [advance("adv-structure", RS_5L, { projectId: PROJECT_A, contractId: STRUCTURE })],
      requestedPaise: RS_5L,
      projectId: PROJECT_A,
      composition: composition([
        [STRUCTURE, RS_4L],
        [COMPOUND_WALL, RS_2L],
      ]),
    });

    expect(allocations).toHaveLength(1);
    expect(allocations[0]).toMatchObject({
      entryId: "adv-structure",
      contractId: STRUCTURE,
      fundsContractId: STRUCTURE,
      // Capped at Structure's ₹4,00,000 share — it cannot spill into Compound Wall.
      amountPaise: RS_4L,
    });
  });

  it("are NOT consumed when their agreement isn't in the composition", () => {
    // The pre-Phase-6 case: attendance is entirely unattributed, so the system
    // cannot know this week's labour was Structure work.
    const allocations = allocateAdvanceDrawdown({
      outstanding: [advance("adv-structure", RS_5L, { projectId: PROJECT_A, contractId: STRUCTURE })],
      requestedPaise: RS_5L,
      projectId: PROJECT_A,
      composition: composition([[null, RS_6L]]),
    });

    expect(allocations).toEqual([]);
  });

  it("stay isolated from each other", () => {
    const allocations = allocateAdvanceDrawdown({
      outstanding: [
        advance("adv-structure", RS_5L, { projectId: PROJECT_A, contractId: STRUCTURE }),
        advance("adv-wall", RS_3L, { projectId: PROJECT_A, contractId: COMPOUND_WALL }),
      ],
      requestedPaise: RS_6L,
      projectId: PROJECT_A,
      composition: composition([
        [STRUCTURE, RS_4L],
        [COMPOUND_WALL, RS_2L],
      ]),
    });

    const byBucket = new Map(allocations.map((a) => [a.fundsContractId, a]));
    expect(byBucket.get(STRUCTURE)!.amountPaise).toBe(RS_4L);
    expect(byBucket.get(COMPOUND_WALL)!.amountPaise).toBe(RS_2L);
    // Neither advance funded the other's bucket.
    expect(allocations.every((a) => a.contractId === a.fundsContractId)).toBe(true);
  });

  it("are refused an agreement on another project", () => {
    const allocations = allocateAdvanceDrawdown({
      outstanding: [advance("adv-b", RS_5L, { projectId: PROJECT_B, contractId: "b-agreement" })],
      requestedPaise: RS_5L,
      projectId: PROJECT_A,
      composition: composition([[STRUCTURE, RS_4L]]),
    });
    expect(allocations).toEqual([]);
  });
});

/* ── Band B: project-scoped is broad, and must not be stranded ──────────── */

describe("project-scoped advances", () => {
  it("fund agreement buckets when nothing is unattributed", () => {
    // The regression this rule exists for: after Phase 6 the unattributed share
    // is zero, and a project advance must still be usable.
    const allocations = allocateAdvanceDrawdown({
      outstanding: [advance("adv-project", RS_3L, { projectId: PROJECT_A })],
      requestedPaise: RS_3L,
      projectId: PROJECT_A,
      composition: composition([
        [COMPOUND_WALL, RS_2L],
        [STRUCTURE, RS_4L],
      ]),
    });

    expect(totalOf(allocations)).toBe(RS_3L);
    // Deterministic fill order, and every rupee attributed to a real bucket.
    expect(allocations.every((a) => a.fundsContractId !== null)).toBe(true);
    expect(allocations.every((a) => a.contractId === null)).toBe(true);
  });

  it("fund the unattributed bucket before Phase 6", () => {
    const allocations = allocateAdvanceDrawdown({
      outstanding: [advance("adv-project", RS_2L, { projectId: PROJECT_A })],
      requestedPaise: RS_2L,
      projectId: PROJECT_A,
      composition: composition([[null, RS_6L]]),
    });

    expect(allocations).toHaveLength(1);
    expect(allocations[0]).toMatchObject({ fundsContractId: null, amountPaise: RS_2L });
  });

  it("split across buckets when larger than the first", () => {
    const allocations = allocateAdvanceDrawdown({
      outstanding: [advance("adv-project", RS_5L, { projectId: PROJECT_A })],
      requestedPaise: RS_5L,
      projectId: PROJECT_A,
      composition: composition([
        [COMPOUND_WALL, RS_2L],
        [STRUCTURE, RS_4L],
      ]),
    });

    expect(totalOf(allocations)).toBe(RS_5L);
    const buckets = new Set(allocations.map((a) => a.fundsContractId));
    expect(buckets.size).toBe(2);
  });

  it("are not consumed by a different project's settlement", () => {
    const allocations = allocateAdvanceDrawdown({
      outstanding: [advance("adv-b", RS_3L, { projectId: PROJECT_B })],
      requestedPaise: RS_3L,
      projectId: PROJECT_A,
      composition: composition([[null, RS_6L]]),
    });
    expect(allocations).toEqual([]);
  });
});

/* ── Band C: legacy company-wide ────────────────────────────────────────── */

describe("legacy company-wide advances", () => {
  it("fund any bucket, recording where the money went", () => {
    const allocations = allocateAdvanceDrawdown({
      outstanding: [advance("adv-legacy", RS_3L)],
      requestedPaise: RS_3L,
      projectId: PROJECT_A,
      composition: composition([[STRUCTURE, RS_4L]]),
    });

    expect(allocations).toHaveLength(1);
    // The advance's own scope and the bucket it funded genuinely differ — which
    // is exactly why both are recorded.
    expect(allocations[0].contractId).toBeNull();
    expect(allocations[0].fundsContractId).toBe(STRUCTURE);
  });

  it("are used only after project- and agreement-scoped money", () => {
    const allocations = allocateAdvanceDrawdown({
      outstanding: [
        advance("adv-legacy", RS_6L, { date: "2026-01-01" }),
        advance("adv-structure", RS_2L, { projectId: PROJECT_A, contractId: STRUCTURE, date: "2026-02-01" }),
      ],
      requestedPaise: RS_4L,
      projectId: PROJECT_A,
      composition: composition([[STRUCTURE, RS_4L]]),
    });

    // Structure's own advance goes first despite being newer.
    expect(allocations[0].entryId).toBe("adv-structure");
    expect(allocations[1].entryId).toBe("adv-legacy");
    expect(totalOf(allocations)).toBe(RS_4L);
  });
});

/* ── Ordering, limits and edges ─────────────────────────────────────────── */

describe("allocation limits", () => {
  it("consumes the oldest advance first within a band", () => {
    const allocations = allocateAdvanceDrawdown({
      outstanding: [
        advance("older", RS_2L, { projectId: PROJECT_A, date: "2026-01-01" }),
        advance("newer", RS_2L, { projectId: PROJECT_A, date: "2026-03-01" }),
      ],
      requestedPaise: RS_3L,
      projectId: PROJECT_A,
      composition: composition([[null, RS_6L]]),
    });
    expect(allocations[0].entryId).toBe("older");
    expect(allocations[0].amountPaise).toBe(RS_2L);
    expect(allocations[1].entryId).toBe("newer");
  });

  it("never allocates more than requested", () => {
    const allocations = allocateAdvanceDrawdown({
      outstanding: [advance("adv", RS_6L, { projectId: PROJECT_A })],
      requestedPaise: RS_2L,
      projectId: PROJECT_A,
      composition: composition([[null, RS_6L]]),
    });
    expect(totalOf(allocations)).toBe(RS_2L);
  });

  it("never allocates more than a bucket's labour cost", () => {
    const allocations = allocateAdvanceDrawdown({
      outstanding: [advance("adv", lakhs(50), { projectId: PROJECT_A })],
      requestedPaise: lakhs(50),
      projectId: PROJECT_A,
      composition: composition([[STRUCTURE, RS_4L]]),
    });
    expect(totalOf(allocations)).toBe(RS_4L);
  });

  it("returns nothing for a zero or negative request", () => {
    const outstanding = [advance("adv", RS_6L, { projectId: PROJECT_A })];
    const base = { outstanding, projectId: PROJECT_A, composition: composition([[null, RS_6L]]) };
    expect(allocateAdvanceDrawdown({ ...base, requestedPaise: 0 })).toEqual([]);
    expect(allocateAdvanceDrawdown({ ...base, requestedPaise: -1 })).toEqual([]);
  });

  it("stops when outstanding advances run out", () => {
    const allocations = allocateAdvanceDrawdown({
      outstanding: [advance("adv", RS_2L, { projectId: PROJECT_A })],
      requestedPaise: RS_6L,
      projectId: PROJECT_A,
      composition: composition([[null, RS_6L]]),
    });
    expect(totalOf(allocations)).toBe(RS_2L);
  });

  it("is deterministic across repeated runs", () => {
    const build = () =>
      allocateAdvanceDrawdown({
        outstanding: [
          advance("a", RS_2L, { projectId: PROJECT_A }),
          advance("b", RS_3L),
          advance("c", RS_2L, { projectId: PROJECT_A, contractId: STRUCTURE }),
        ],
        requestedPaise: RS_5L,
        projectId: PROJECT_A,
        composition: composition([
          [STRUCTURE, RS_4L],
          [COMPOUND_WALL, RS_2L],
        ]),
      });
    expect(build()).toEqual(build());
  });
});

/* ── Explaining what was not consumed ───────────────────────────────────── */

describe("unusable advances are explained", () => {
  it("names the agreement-attribution reason", () => {
    const outstanding = [advance("adv-structure", RS_5L, { projectId: PROJECT_A, contractId: STRUCTURE })];
    const comp = composition([[null, RS_6L]]);
    const allocations = allocateAdvanceDrawdown({
      outstanding,
      requestedPaise: RS_5L,
      projectId: PROJECT_A,
      composition: comp,
    });

    const unusable = unusableAdvances({ outstanding, allocations, projectId: PROJECT_A, composition: comp });
    expect(unusable).toHaveLength(1);
    expect(unusable[0].remainingPaise).toBe(RS_5L);
    expect(unusable[0].reason).toContain("hasn't been attributed");
  });

  it("says nothing when everything was consumed", () => {
    const outstanding = [advance("adv", RS_2L, { projectId: PROJECT_A })];
    const comp = composition([[null, RS_6L]]);
    const allocations = allocateAdvanceDrawdown({
      outstanding,
      requestedPaise: RS_2L,
      projectId: PROJECT_A,
      composition: comp,
    });
    expect(unusableAdvances({ outstanding, allocations, projectId: PROJECT_A, composition: comp })).toEqual([]);
  });
});

/* ── Scope balances and per-advance outstanding ─────────────────────────── */

describe("scoped balances", () => {
  const entries: ScopedLedgerEntry[] = [
    { id: "l1", type: "ADVANCE", amountPaise: RS_2L, projectId: PROJECT_A, contractId: null, date: "2026-01-01" },
    { id: "l2", type: "ADVANCE", amountPaise: RS_5L, projectId: PROJECT_A, contractId: STRUCTURE, date: "2026-01-02" },
    { id: "l3", type: "ADVANCE", amountPaise: RS_3L, projectId: null, contractId: null, date: "2026-01-03" },
    { id: "l4", type: "LABOUR_BILL", amountPaise: RS_6L, projectId: null, contractId: null, date: "2026-02-01" },
  ];

  it("splits the balance by scope without changing the total", () => {
    const scoped = advanceBalanceByScope(entries);
    expect(scoped.byContract.get(STRUCTURE)).toBe(RS_5L);
    expect(scoped.byProject.get(PROJECT_A)).toBe(RS_2L);
    expect(scoped.unattributedPaise).toBe(RS_3L);

    const total =
      scoped.unattributedPaise +
      [...scoped.byProject.values()].reduce((a, v) => a + v, 0) +
      [...scoped.byContract.values()].reduce((a, v) => a + v, 0);
    expect(total).toBe(lakhs(10));
  });

  it("computes per-advance outstanding after a drawdown", () => {
    const withDrawdown: ScopedLedgerEntry[] = [
      ...entries,
      {
        id: "adj1",
        type: "ADJUSTMENT",
        amountPaise: RS_2L,
        projectId: PROJECT_A,
        contractId: null,
        drawsFromEntryId: "l1",
        date: "2026-02-01",
      },
    ];
    const outstanding = outstandingPerAdvance(withDrawdown);
    expect(outstanding.find((a) => a.entryId === "l1")).toBeUndefined(); // fully consumed
    expect(outstanding.find((a) => a.entryId === "l2")!.remainingPaise).toBe(RS_5L);
  });

  it("restores an advance when its drawdown is reversed", () => {
    const withReversal: ScopedLedgerEntry[] = [
      ...entries,
      {
        id: "adj1",
        type: "ADJUSTMENT",
        amountPaise: RS_2L,
        projectId: PROJECT_A,
        contractId: null,
        drawsFromEntryId: "l1",
        date: "2026-02-01",
      },
      {
        id: "rev1",
        type: "SETTLEMENT_REVERSAL",
        amountPaise: RS_2L,
        projectId: PROJECT_A,
        contractId: null,
        reversesEntryId: "adj1",
        date: "2026-03-01",
      },
    ];
    expect(outstandingPerAdvance(withReversal).find((a) => a.entryId === "l1")!.remainingPaise).toBe(
      RS_2L,
    );
  });

  it("treats unapplied reversal cash as an advance in its own right", () => {
    const unapplied: ScopedLedgerEntry[] = [
      {
        id: "rev-cash",
        type: "SETTLEMENT_REVERSAL",
        amountPaise: RS_4L,
        projectId: PROJECT_A,
        contractId: STRUCTURE,
        reversesEntryId: null,
        date: "2026-03-01",
      },
    ];
    const outstanding = outstandingPerAdvance(unapplied);
    expect(outstanding).toHaveLength(1);
    expect(outstanding[0]).toMatchObject({ contractId: STRUCTURE, remainingPaise: RS_4L });
  });
});

/* ── The breakdown a settlement records about itself ────────────────────── */

describe("settlement breakdown", () => {
  it("holds the four invariants", () => {
    const comp = composition([
      [STRUCTURE, RS_4L],
      [COMPOUND_WALL, RS_2L],
    ]);
    const allocations = allocateAdvanceDrawdown({
      outstanding: [
        advance("adv-structure", lakhs(1), { projectId: PROJECT_A, contractId: STRUCTURE }),
        advance("adv-wall", lakhs(0.5), { projectId: PROJECT_A, contractId: COMPOUND_WALL }),
      ],
      requestedPaise: lakhs(1.5),
      projectId: PROJECT_A,
      composition: comp,
    });

    const buckets = buildSettlementBreakdown(comp, allocations);
    const sum = (k: keyof (typeof buckets)[number]) =>
      buckets.reduce((a, b) => a + (b[k] as number), 0);

    expect(sum("labourBillPaise")).toBe(RS_6L);
    expect(sum("advanceAdjustmentPaise")).toBe(lakhs(1.5));
    expect(sum("netPaymentPaise")).toBe(lakhs(4.5));
    for (const b of buckets) {
      expect(b.labourBillPaise).toBe(b.advanceAdjustmentPaise + b.netPaymentPaise);
    }
  });

  it("produces exactly one unattributed row before Phase 6", () => {
    const comp = composition([[null, RS_6L]]);
    const allocations = allocateAdvanceDrawdown({
      outstanding: [advance("adv", RS_2L, { projectId: PROJECT_A })],
      requestedPaise: RS_2L,
      projectId: PROJECT_A,
      composition: comp,
    });
    const buckets = buildSettlementBreakdown(comp, allocations);

    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toEqual({
      contractId: null,
      labourBillPaise: RS_6L,
      advanceAdjustmentPaise: RS_2L,
      netPaymentPaise: RS_4L,
    });
  });

  it("agrees with the per-drawdown fundsContractId totals", () => {
    const comp = composition([
      [STRUCTURE, RS_4L],
      [COMPOUND_WALL, RS_2L],
    ]);
    const allocations = allocateAdvanceDrawdown({
      outstanding: [advance("adv-legacy", RS_3L)],
      requestedPaise: RS_3L,
      projectId: PROJECT_A,
      composition: comp,
    });
    const buckets = buildSettlementBreakdown(comp, allocations);

    for (const bucket of buckets) {
      const fromLedger = allocations
        .filter((a) => a.fundsContractId === bucket.contractId)
        .reduce((a, x) => a + x.amountPaise, 0);
      expect(bucket.advanceAdjustmentPaise).toBe(fromLedger);
    }
  });

  it("gives the whole bill as net when no advance was drawn", () => {
    const comp = composition([
      [STRUCTURE, RS_4L],
      [COMPOUND_WALL, RS_2L],
    ]);
    const buckets = buildSettlementBreakdown(comp, []);
    expect(buckets.map((b) => b.netPaymentPaise)).toEqual([RS_4L, RS_2L]);
    expect(buckets.every((b) => b.advanceAdjustmentPaise === 0)).toBe(true);
  });
});
