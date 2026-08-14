/**
 * Milestone lifecycle, the earned-value ceiling, and the DERIVED financial
 * state that replaces a user-settable "settled" status.
 */
import { describe, it, expect } from "vitest";
import {
  MILESTONE_TRANSITIONS,
  canTransitionMilestone,
  validateMilestoneTransition,
  validateMilestoneCompletion,
  completedValuePaise,
  milestoneFinancialStateAtCompletion,
  milestoneCurrentCoverageState,
  cumulativeEarnedThroughPaise,
  canTransitionAgreement,
  canSettleAgreement,
  impliedAgreementStatus,
} from "./milestones";
import type { AgreementSnapshot, MilestoneEntry, MilestoneStatus } from "./types";
import { RS_2L, RS_10L, RS_12L, RS_50L, RS_60L, lakhs } from "./__fixtures__/amounts";

const ALL_STATUSES: MilestoneStatus[] = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
];

function milestone(
  seq: number,
  status: MilestoneStatus = "NOT_STARTED",
  completedAt: string | null = null,
  valuePaise = RS_10L,
): MilestoneEntry {
  return { id: `m${seq}`, sequence: seq, title: `Slab ${seq}`, valuePaise, status, completedAt };
}

describe("physical transitions", () => {
  it("has no SETTLED state — financial status is derived, never stamped", () => {
    expect(Object.keys(MILESTONE_TRANSITIONS).sort()).toEqual([...ALL_STATUSES].sort());
    for (const targets of Object.values(MILESTONE_TRANSITIONS)) {
      expect(targets).not.toContain("SETTLED");
    }
  });

  it("allows the normal forward path", () => {
    expect(canTransitionMilestone("NOT_STARTED", "IN_PROGRESS")).toBe(true);
    expect(canTransitionMilestone("IN_PROGRESS", "COMPLETED")).toBe(true);
    expect(canTransitionMilestone("NOT_STARTED", "COMPLETED")).toBe(true);
  });

  it("allows un-completing — work signed off early can fail inspection", () => {
    expect(canTransitionMilestone("COMPLETED", "IN_PROGRESS")).toBe(true);
  });

  it("refuses to jump straight from COMPLETED to CANCELLED", () => {
    expect(canTransitionMilestone("COMPLETED", "CANCELLED")).toBe(false);
  });

  it("rejects a no-op transition with a clear message", () => {
    expect(
      validateMilestoneTransition({
        from: "COMPLETED",
        to: "COMPLETED",
        linkedNonReversedPaymentPaise: 0,
      }),
    ).toContain("already");
  });

  it("blocks cancelling a milestone with payments booked against it", () => {
    const msg = validateMilestoneTransition({
      from: "IN_PROGRESS",
      to: "CANCELLED",
      linkedNonReversedPaymentPaise: RS_2L,
    });
    expect(msg).toContain("₹2,00,000");
    expect(msg).toContain("Reverse those payments");
  });

  it("allows cancelling once those payments are reversed", () => {
    expect(
      validateMilestoneTransition({
        from: "IN_PROGRESS",
        to: "CANCELLED",
        linkedNonReversedPaymentPaise: 0,
      }),
    ).toBeNull();
  });
});

describe("earned-value ceiling", () => {
  it("allows completion inside the authorised value", () => {
    expect(
      validateMilestoneCompletion({
        alreadyCompletedValuePaise: RS_10L,
        thisMilestoneValuePaise: RS_10L,
        currentContractValuePaise: RS_60L,
      }),
    ).toBeNull();
  });

  it("allows completion that lands exactly on the authorised value", () => {
    expect(
      validateMilestoneCompletion({
        alreadyCompletedValuePaise: lakhs(50),
        thisMilestoneValuePaise: RS_10L,
        currentContractValuePaise: RS_60L,
      }),
    ).toBeNull();
  });

  it("blocks completion that would recognise more than the authorised value", () => {
    // Six ₹11,00,000 slabs against a ₹60,00,000 agreement: the sixth is refused.
    const msg = validateMilestoneCompletion({
      alreadyCompletedValuePaise: lakhs(55),
      thisMilestoneValuePaise: lakhs(11),
      currentContractValuePaise: RS_60L,
    });
    expect(msg).toContain("₹66,00,000");
    expect(msg).toContain("₹60,00,000");
    expect(msg).toContain("₹5,00,000"); // remaining headroom
    expect(msg).toContain("amendment");
  });

  it("permits the same completion once an amendment has raised the value", () => {
    expect(
      validateMilestoneCompletion({
        alreadyCompletedValuePaise: lakhs(55),
        thisMilestoneValuePaise: lakhs(11),
        currentContractValuePaise: lakhs(70),
      }),
    ).toBeNull();
  });

  it("sums only COMPLETED milestones", () => {
    expect(
      completedValuePaise([
        milestone(1, "COMPLETED", "2026-02-15T00:00:00.000Z"),
        milestone(2, "IN_PROGRESS"),
        milestone(3, "CANCELLED"),
        milestone(4, "COMPLETED", "2026-03-20T00:00:00.000Z"),
      ]),
    ).toBe(lakhs(20));
  });
});

describe("derived milestone financial state", () => {
  const snapshot = (payments: number[], milestones: MilestoneEntry[]): AgreementSnapshot => ({
    agreementId: "structure",
    status: "IN_PROGRESS",
    originalAmountPaise: RS_60L,
    amendments: [],
    milestones,
    attendanceCredits: [],
    payments: payments.map((amountPaise, i) => ({
      id: `p${i}`,
      date: "2026-02-01",
      amountPaise,
      type: "INTERIM" as const,
      reversedAt: null,
    })),
  });

  const slab1 = milestone(1, "COMPLETED", "2026-02-15T00:00:00.000Z");
  const rest = [2, 3, 4, 5, 6].map((n) => milestone(n));

  it("is NOT_EARNED while the milestone is incomplete", () => {
    const s = snapshot([RS_12L], [milestone(1, "IN_PROGRESS"), ...rest]);
    expect(milestoneFinancialStateAtCompletion(s, s.milestones[0])).toBe("NOT_EARNED");
  });

  it("is DUE when credit falls short at the checkpoint", () => {
    const s = snapshot([lakhs(8)], [slab1, ...rest]);
    expect(milestoneFinancialStateAtCompletion(s, slab1)).toBe("DUE");
  });

  it("is SETTLED when credit exactly meets earned value", () => {
    const s = snapshot([RS_10L], [slab1, ...rest]);
    expect(milestoneFinancialStateAtCompletion(s, slab1)).toBe("SETTLED");
  });

  it("is AHEAD when credit exceeds earned value", () => {
    const s = snapshot([RS_12L], [slab1, ...rest]);
    expect(milestoneFinancialStateAtCompletion(s, slab1)).toBe("AHEAD");
  });

  it("reflects the position AT the checkpoint, not today", () => {
    // ₹8,00,000 paid before Slab 1, another ₹2,00,000 a month later. Slab 1 was
    // DUE on the day it completed even though nothing is owed now.
    const s: AgreementSnapshot = {
      ...snapshot([], [slab1, ...rest]),
      payments: [
        { id: "p1", date: "2026-02-01", amountPaise: lakhs(8), type: "INTERIM", reversedAt: null },
        { id: "p2", date: "2026-03-15", amountPaise: RS_2L, type: "INTERIM", reversedAt: null },
      ],
    };
    expect(milestoneFinancialStateAtCompletion(s, slab1)).toBe("DUE");
  });

  it("a cancelled milestone is never earned", () => {
    const cancelled = milestone(2, "CANCELLED");
    const s = snapshot([RS_12L], [slab1, cancelled, ...rest.slice(1)]);
    expect(milestoneFinancialStateAtCompletion(s, cancelled)).toBe("NOT_EARNED");
  });
});

describe("agreement lifecycle", () => {
  it("permits the ordinary progressions", () => {
    expect(canTransitionAgreement("NOT_STARTED", "IN_PROGRESS")).toBe(true);
    expect(canTransitionAgreement("IN_PROGRESS", "COMPLETED")).toBe(true);
    expect(canTransitionAgreement("COMPLETED", "SETTLED")).toBe(true);
    expect(canTransitionAgreement("ON_HOLD", "IN_PROGRESS")).toBe(true);
  });

  it("does not allow jumping to SETTLED without completing first", () => {
    expect(canTransitionAgreement("IN_PROGRESS", "SETTLED")).toBe(false);
    expect(canTransitionAgreement("NOT_STARTED", "SETTLED")).toBe(false);
  });

  // SETTLED is a FINAL close-out: the whole authorised agreement must be earned
  // and exactly reconciled. Each of these blocks it for a different reason.
  const fullyEarned = {
    currentDuePaise: 0,
    advanceCreditPaise: 0,
    earnedValuePaise: RS_60L,
    currentContractValuePaise: RS_60L,
    remainingUnearnedPaise: 0,
  };
  const allComplete = [
    milestone(1, "COMPLETED", "2026-02-15T00:00:00.000Z"),
    milestone(2, "CANCELLED"),
  ];

  it("settles when the agreement is fully earned and fully credited", () => {
    expect(
      canSettleAgreement({ reconciliation: fullyEarned, milestones: allComplete }),
    ).toBeNull();
  });

  it("refuses while milestones are outstanding", () => {
    expect(
      canSettleAgreement({
        reconciliation: fullyEarned,
        milestones: [milestone(1, "COMPLETED", "2026-02-15T00:00:00.000Z"), milestone(2)],
      }),
    ).toContain("not complete");
  });

  it("refuses when nothing is due but authorised value remains UNEARNED", () => {
    // The counterexample the weaker rule allowed: ₹60L authorised, milestones
    // total only ₹50L, all complete, ₹50L credited, ₹0 due — yet ₹10L of the
    // agreement was never earned, so it is not commercially finished.
    expect(
      canSettleAgreement({
        reconciliation: {
          ...fullyEarned,
          earnedValuePaise: RS_50L,
          remainingUnearnedPaise: RS_10L,
        },
        milestones: allComplete,
      }),
    ).toContain("has not been earned");
  });

  it("refuses when milestone coverage falls short of the contract value", () => {
    // Same shape stated from the coverage side: every milestone is complete but
    // they never added up to the authorised value in the first place.
    const under = canSettleAgreement({
      reconciliation: {
        currentDuePaise: 0,
        advanceCreditPaise: 0,
        earnedValuePaise: RS_50L,
        currentContractValuePaise: RS_60L,
        remainingUnearnedPaise: RS_10L,
      },
      milestones: allComplete,
    });
    expect(under).toContain("₹10,00,000");
    expect(under).toContain("₹60,00,000");
  });

  it("refuses while money is still due", () => {
    expect(
      canSettleAgreement({
        reconciliation: { ...fullyEarned, currentDuePaise: RS_2L },
        milestones: allComplete,
      }),
    ).toContain("₹2,00,000");
  });

  it("refuses when the contractor has been paid AHEAD", () => {
    // Fully earned, but over-credited: the excess has to be resolved before the
    // agreement can be declared closed.
    expect(
      canSettleAgreement({
        reconciliation: { ...fullyEarned, advanceCreditPaise: RS_2L },
        milestones: allComplete,
      }),
    ).toContain("ahead of earned work");
  });

  it("suggests, but never asserts, a status from milestone progress", () => {
    expect(impliedAgreementStatus([milestone(1), milestone(2)])).toBeNull();
    expect(impliedAgreementStatus([milestone(1, "IN_PROGRESS"), milestone(2)])).toBe("IN_PROGRESS");
    expect(
      impliedAgreementStatus([
        milestone(1, "COMPLETED", "2026-02-15T00:00:00.000Z"),
        milestone(2, "CANCELLED"),
      ]),
    ).toBe("COMPLETED");
    expect(impliedAgreementStatus([])).toBeNull();
  });
});

describe("historical checkpoint state vs current coverage", () => {
  const slab1 = milestone(1, "COMPLETED", "2026-02-15T00:00:00.000Z");
  const slab2 = milestone(2, "COMPLETED", "2026-03-20T00:00:00.000Z");
  const rest = [3, 4, 5, 6].map((n) => milestone(n));

  /** Slab 1 complete; payments accumulate over time. */
  const snap = (payments: { amountPaise: number; date: string }[]): AgreementSnapshot => ({
    agreementId: "structure",
    status: "IN_PROGRESS",
    originalAmountPaise: RS_60L,
    amendments: [],
    milestones: [slab1, ...[2, 3, 4, 5, 6].map((n) => milestone(n))],
    attendanceCredits: [],
    payments: payments.map((p, i) => ({
      id: `p${i}`,
      date: p.date,
      amountPaise: p.amountPaise,
      type: "INTERIM" as const,
      reversedAt: null,
    })),
  });

  it("1. on completion at ₹10L earned / ₹8L credited, both views say DUE", () => {
    const s = snap([{ amountPaise: lakhs(8), date: "2026-02-10" }]);
    expect(milestoneFinancialStateAtCompletion(s, slab1)).toBe("DUE");
    expect(milestoneCurrentCoverageState(s, slab1)).toBe("DUE");
  });

  it("2. after a later ₹2L payment, history stays DUE but current becomes SETTLED", () => {
    const s = snap([
      { amountPaise: lakhs(8), date: "2026-02-10" },
      { amountPaise: RS_2L, date: "2026-02-18" }, // three days after completion
    ]);
    // The day it was signed off, ₹2,00,000 was genuinely outstanding.
    expect(milestoneFinancialStateAtCompletion(s, slab1)).toBe("DUE");
    // Today that slab is paid for.
    expect(milestoneCurrentCoverageState(s, slab1)).toBe("SETTLED");
  });

  it("3. a further ₹2L advance moves current coverage to AHEAD", () => {
    const s = snap([
      { amountPaise: lakhs(8), date: "2026-02-10" },
      { amountPaise: RS_2L, date: "2026-02-18" },
      { amountPaise: RS_2L, date: "2026-03-01" },
    ]);
    expect(milestoneFinancialStateAtCompletion(s, slab1)).toBe("DUE");
    expect(milestoneCurrentCoverageState(s, slab1)).toBe("AHEAD");
  });

  it("4. the historical state never changes as later transactions land", () => {
    const stages = [
      snap([{ amountPaise: lakhs(8), date: "2026-02-10" }]),
      snap([
        { amountPaise: lakhs(8), date: "2026-02-10" },
        { amountPaise: RS_2L, date: "2026-02-18" },
      ]),
      snap([
        { amountPaise: lakhs(8), date: "2026-02-10" },
        { amountPaise: RS_2L, date: "2026-02-18" },
        { amountPaise: RS_2L, date: "2026-03-01" },
      ]),
    ];
    for (const s of stages) {
      expect(milestoneFinancialStateAtCompletion(s, slab1)).toBe("DUE");
    }
  });

  it("compares against the CUMULATIVE threshold, not the milestone's own value", () => {
    // Two slabs complete ⇒ threshold through Slab 2 is ₹20,00,000. ₹12,00,000
    // credited covers Slab 1's ₹10,00,000 but not Slab 2's cumulative level.
    const s: AgreementSnapshot = {
      ...snap([{ amountPaise: RS_12L, date: "2026-04-01" }]),
      milestones: [slab1, slab2, ...rest],
    };
    expect(cumulativeEarnedThroughPaise(s.milestones, slab1)).toBe(RS_10L);
    expect(cumulativeEarnedThroughPaise(s.milestones, slab2)).toBe(lakhs(20));

    expect(milestoneCurrentCoverageState(s, slab1)).toBe("AHEAD"); // 12L > 10L
    expect(milestoneCurrentCoverageState(s, slab2)).toBe("DUE"); // 12L < 20L
  });

  it("does not allocate payments to a particular slab", () => {
    // One credit pool serves the whole agreement: the same ₹12,00,000 is what
    // both slabs above are measured against, not ₹12,00,000 split between them.
    const s: AgreementSnapshot = {
      ...snap([{ amountPaise: RS_12L, date: "2026-04-01" }]),
      milestones: [slab1, slab2, ...rest],
    };
    expect(reconcileAgreementCredited(s)).toBe(RS_12L);
  });

  it("an incomplete milestone has no threshold and is NOT_EARNED", () => {
    const s = snap([{ amountPaise: RS_12L, date: "2026-04-01" }]);
    const slab3 = s.milestones.find((m) => m.id === "m3")!;
    expect(cumulativeEarnedThroughPaise(s.milestones, slab3)).toBe(RS_10L); // only slab 1 counts
    expect(milestoneCurrentCoverageState(s, slab3)).toBe("NOT_EARNED");
  });
});

/** Small helper so the "one pool" assertion reads plainly. */
function reconcileAgreementCredited(s: AgreementSnapshot): number {
  return s.payments.filter((p) => p.reversedAt == null).reduce((a, p) => a + p.amountPaise, 0);
}
