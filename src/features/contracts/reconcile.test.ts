/**
 * The authoritative reconciliation scenarios.
 *
 * Every figure here is stated in rupees in the brief and converted through the
 * shared fixtures, never hand-written as paise — see __fixtures__/amounts.ts for
 * why that distinction is load-bearing.
 */
import { describe, it, expect } from "vitest";
import {
  reconcileAgreement,
  reconcileAsOf,
  reconciliationTimeline,
  rollUpReconciliations,
  currentContractValuePaise,
  validateCreditCeiling,
} from "./reconcile";
import type {
  AgreementSnapshot,
  AmendmentEntry,
  AttendanceCreditEntry,
  MilestoneEntry,
  PaymentEntry,
} from "./types";
import {
  RS_2L,
  RS_3L,
  RS_6L,
  RS_8L,
  RS_10L,
  RS_12L,
  RS_15L,
  RS_20L,
  RS_50L,
  RS_52L,
  RS_60L,
  lakhs,
} from "./__fixtures__/amounts";

/* ── Builders ───────────────────────────────────────────────────────────── */

function milestone(
  seq: number,
  status: MilestoneEntry["status"] = "NOT_STARTED",
  completedAt: string | null = null,
  valuePaise = RS_10L,
): MilestoneEntry {
  return { id: `m${seq}`, sequence: seq, title: `Slab ${seq}`, valuePaise, status, completedAt };
}

function payment(id: string, amountPaise: number, date = "2026-02-10"): PaymentEntry {
  return { id, date, amountPaise, type: "INTERIM", reversedAt: null };
}

function credit(id: string, amountPaise: number, date = "2026-02-05"): AttendanceCreditEntry {
  return { id, date, amountPaise };
}

/** Pappu Contractor → Project A → Structure: ₹60,00,000 over six ₹10,00,000 slabs. */
function structure(over: Partial<AgreementSnapshot> = {}): AgreementSnapshot {
  return {
    agreementId: "structure",
    status: "IN_PROGRESS",
    originalAmountPaise: RS_60L,
    amendments: [],
    milestones: [1, 2, 3, 4, 5, 6].map((n) => milestone(n)),
    attendanceCredits: [],
    payments: [],
    ...over,
  };
}

/* ── Scenario C: the authoritative acceptance case ──────────────────────── */

describe("authoritative case — Pappu / Project A / Structure ₹60,00,000", () => {
  const slab1Done = structure({
    milestones: [
      milestone(1, "COMPLETED", "2026-02-15T00:00:00.000Z"),
      ...[2, 3, 4, 5, 6].map((n) => milestone(n)),
    ],
    attendanceCredits: [credit("a1", RS_6L)],
    payments: [payment("p1", RS_2L)],
  });

  it("step 1 — Slab 1 complete, ₹6,00,000 settled attendance + ₹2,00,000 paid ⇒ ₹2,00,000 due", () => {
    const r = reconcileAgreement(slab1Done);

    expect(r.currentContractValuePaise).toBe(RS_60L);
    expect(r.earnedValuePaise).toBe(RS_10L);
    expect(r.attendanceCreditPaise).toBe(RS_6L);
    expect(r.otherPaymentCreditPaise).toBe(RS_2L);
    expect(r.totalCreditedPaise).toBe(RS_8L);

    expect(r.currentDuePaise).toBe(RS_2L);
    expect(r.advanceCreditPaise).toBe(0);
    expect(r.remainingUnearnedPaise).toBe(RS_50L);
    expect(r.overallBalancePaise).toBe(RS_52L);

    expect(r.milestonesCompleted).toBe(1);
    expect(r.milestonesTotal).toBe(6);
  });

  it("never reports the ₹52,00,000 balance as currently payable", () => {
    const r = reconcileAgreement(slab1Done);
    // The whole point of the model: unearned future work is not a debt today.
    expect(r.currentDuePaise).not.toBe(RS_52L);
    expect(r.currentDuePaise).toBeLessThan(r.overallBalancePaise);
  });

  it("step 2 — a further ₹2,00,000 clears the due to zero", () => {
    const r = reconcileAgreement({
      ...slab1Done,
      payments: [payment("p1", RS_2L), payment("p2", RS_2L)],
    });
    expect(r.earnedValuePaise).toBe(RS_10L);
    expect(r.totalCreditedPaise).toBe(RS_10L);
    expect(r.currentDuePaise).toBe(0);
    expect(r.advanceCreditPaise).toBe(0);
  });

  it("step 3 — another ₹2,00,000 before Slab 2 becomes ₹2,00,000 ahead credit", () => {
    const r = reconcileAgreement({
      ...slab1Done,
      payments: [payment("p1", RS_2L), payment("p2", RS_2L), payment("p3", RS_2L)],
    });
    expect(r.earnedValuePaise).toBe(RS_10L);
    expect(r.totalCreditedPaise).toBe(RS_12L);
    expect(r.currentDuePaise).toBe(0);
    expect(r.advanceCreditPaise).toBe(RS_2L);
  });

  it("step 4 — Slab 2 completes; cumulative earned ₹20,00,000 ⇒ ₹8,00,000 due", () => {
    const r = reconcileAgreement({
      ...slab1Done,
      milestones: [
        milestone(1, "COMPLETED", "2026-02-15T00:00:00.000Z"),
        milestone(2, "COMPLETED", "2026-03-20T00:00:00.000Z"),
        ...[3, 4, 5, 6].map((n) => milestone(n)),
      ],
      payments: [payment("p1", RS_2L), payment("p2", RS_2L), payment("p3", RS_2L)],
    });
    expect(r.earnedValuePaise).toBe(RS_20L);
    expect(r.totalCreditedPaise).toBe(RS_12L);
    expect(r.currentDuePaise).toBe(lakhs(8));
    expect(r.advanceCreditPaise).toBe(0);
  });
});

/* ── Scenario D: cumulative, not per-slab ───────────────────────────────── */

describe("cumulative reconciliation", () => {
  it("Slab 2 completing gives ₹20,00,000 earned vs ₹17,00,000 credited ⇒ ₹3,00,000 due", () => {
    const r = reconcileAgreement(
      structure({
        milestones: [
          milestone(1, "COMPLETED", "2026-02-15T00:00:00.000Z"),
          milestone(2, "COMPLETED", "2026-03-20T00:00:00.000Z"),
          ...[3, 4, 5, 6].map((n) => milestone(n)),
        ],
        attendanceCredits: [credit("a1", RS_6L), credit("a2", lakhs(5), "2026-03-05")],
        payments: [payment("p1", RS_2L), payment("p2", lakhs(4), "2026-03-10")],
      }),
    );
    expect(r.earnedValuePaise).toBe(RS_20L);
    expect(r.totalCreditedPaise).toBe(lakhs(17));
    expect(r.currentDuePaise).toBe(RS_3L);
  });

  it("an earlier over-credit carries forward and reduces the next milestone's due", () => {
    // ₹12L credited against ₹10L earned; when Slab 2 lands, only ₹8L is due.
    const r = reconcileAgreement(
      structure({
        milestones: [
          milestone(1, "COMPLETED", "2026-02-15T00:00:00.000Z"),
          milestone(2, "COMPLETED", "2026-03-20T00:00:00.000Z"),
          ...[3, 4, 5, 6].map((n) => milestone(n)),
        ],
        payments: [payment("p1", RS_12L)],
      }),
    );
    expect(r.currentDuePaise).toBe(lakhs(8));
  });
});

/* ── Scenario E: advance / ahead credit ─────────────────────────────────── */

describe("advance / ahead credit", () => {
  it("credited above earned reports ahead credit and zero due", () => {
    const r = reconcileAgreement(
      structure({
        milestones: [
          milestone(1, "COMPLETED", "2026-02-15T00:00:00.000Z"),
          ...[2, 3, 4, 5, 6].map((n) => milestone(n)),
        ],
        payments: [payment("p1", RS_12L)],
      }),
    );
    expect(r.currentDuePaise).toBe(0);
    expect(r.advanceCreditPaise).toBe(RS_2L);
  });

  it("an advance before ANY milestone completes is legitimate", () => {
    const r = reconcileAgreement(structure({ payments: [payment("p1", RS_3L)] }));
    expect(r.earnedValuePaise).toBe(0);
    expect(r.currentDuePaise).toBe(0);
    expect(r.advanceCreditPaise).toBe(RS_3L);
  });

  it("due and ahead are never both non-zero on one agreement", () => {
    for (const credited of [0, RS_2L, RS_10L, RS_12L, RS_20L]) {
      const r = reconcileAgreement(
        structure({
          milestones: [
            milestone(1, "COMPLETED", "2026-02-15T00:00:00.000Z"),
            ...[2, 3, 4, 5, 6].map((n) => milestone(n)),
          ],
          payments: credited > 0 ? [payment("p", credited)] : [],
        }),
      );
      expect(r.currentDuePaise * r.advanceCreditPaise).toBe(0);
    }
  });
});

/* ── Scenario H: multi-agreement roll-up must NOT net ───────────────────── */

describe("portfolio roll-up — agreements never offset each other", () => {
  const structureRecon = reconcileAgreement(
    structure({
      milestones: [
        milestone(1, "COMPLETED", "2026-02-15T00:00:00.000Z"),
        milestone(2, "COMPLETED", "2026-03-20T00:00:00.000Z"),
        ...[3, 4, 5, 6].map((n) => milestone(n)),
      ],
      payments: [payment("p1", RS_12L)],
    }),
  );
  const compoundWallRecon = reconcileAgreement({
    agreementId: "compound-wall",
    status: "NOT_STARTED",
    originalAmountPaise: lakhs(8),
    amendments: [],
    milestones: [{ id: "cw1", sequence: 1, title: "Wall", valuePaise: lakhs(8), status: "NOT_STARTED", completedAt: null }],
    attendanceCredits: [],
    payments: [payment("cwp", RS_3L)],
  });

  it("each agreement stands alone", () => {
    expect(structureRecon.earnedValuePaise).toBe(RS_20L);
    expect(structureRecon.totalCreditedPaise).toBe(RS_12L);
    expect(structureRecon.currentDuePaise).toBe(lakhs(8));
    expect(structureRecon.advanceCreditPaise).toBe(0);

    expect(compoundWallRecon.earnedValuePaise).toBe(0);
    expect(compoundWallRecon.totalCreditedPaise).toBe(RS_3L);
    expect(compoundWallRecon.currentDuePaise).toBe(0);
    expect(compoundWallRecon.advanceCreditPaise).toBe(RS_3L);
  });

  it("the contractor total shows ₹8,00,000 due AND ₹3,00,000 ahead — never a netted ₹5,00,000", () => {
    const roll = rollUpReconciliations([structureRecon, compoundWallRecon]);

    expect(roll.totalEarnedPaise).toBe(RS_20L);
    expect(roll.totalCreditedPaise).toBe(RS_15L);

    expect(roll.totalCurrentDuePaise).toBe(lakhs(8));
    expect(roll.totalAdvanceCreditPaise).toBe(RS_3L);

    // The Compound Wall advance must not extinguish the Structure liability.
    expect(roll.totalCurrentDuePaise).not.toBe(lakhs(5));
  });

  it("exposes the netted figure only as an informational position", () => {
    const roll = rollUpReconciliations([structureRecon, compoundWallRecon]);
    expect(roll.netCommercialPositionPaise).toBe(lakhs(5));
    // …and it is precisely due − ahead, never a substitute for either.
    expect(roll.netCommercialPositionPaise).toBe(
      roll.totalCurrentDuePaise - roll.totalAdvanceCreditPaise,
    );
  });

  it("sums due and ahead per agreement rather than re-deriving them", () => {
    const roll = rollUpReconciliations([structureRecon, compoundWallRecon]);
    const naive = Math.max(0, roll.totalEarnedPaise - roll.totalCreditedPaise);
    expect(naive).toBe(lakhs(5)); // what the wrong implementation would report
    expect(roll.totalCurrentDuePaise).toBe(lakhs(8));
  });

  it("an empty portfolio is all zeroes, not NaN", () => {
    const roll = rollUpReconciliations([]);
    expect(roll.agreementCount).toBe(0);
    expect(roll.totalCurrentDuePaise).toBe(0);
    expect(roll.totalAdvanceCreditPaise).toBe(0);
    expect(roll.netCommercialPositionPaise).toBe(0);
  });
});

/* ── D1: unsettled attendance is informational ──────────────────────────── */

describe("unsettled attendance", () => {
  it("does not reduce the amount due", () => {
    const r = reconcileAgreement(
      structure({
        milestones: [
          milestone(1, "COMPLETED", "2026-02-15T00:00:00.000Z"),
          ...[2, 3, 4, 5, 6].map((n) => milestone(n)),
        ],
        attendanceCredits: [credit("a1", RS_6L)],
        payments: [payment("p1", RS_2L)],
        unsettledAttendancePaise: lakhs(1),
      }),
    );
    expect(r.unsettledAttendancePaise).toBe(lakhs(1));
    expect(r.totalCreditedPaise).toBe(RS_8L); // ₹1,00,000 excluded
    expect(r.currentDuePaise).toBe(RS_2L); // NOT ₹1,00,000
  });

  it("changing it moves no other field", () => {
    const base = structure({
      milestones: [milestone(1, "COMPLETED", "2026-02-15T00:00:00.000Z"), ...[2, 3, 4, 5, 6].map((n) => milestone(n))],
      attendanceCredits: [credit("a1", RS_6L)],
      payments: [payment("p1", RS_2L)],
    });
    const a = reconcileAgreement({ ...base, unsettledAttendancePaise: 0 });
    const b = reconcileAgreement({ ...base, unsettledAttendancePaise: lakhs(99) });
    expect({ ...a, unsettledAttendancePaise: 0 }).toEqual({ ...b, unsettledAttendancePaise: 0 });
  });
});

/* ── Scenario K: amendments ─────────────────────────────────────────────── */

describe("amendments", () => {
  const proposed: AmendmentEntry = {
    id: "am1",
    status: "PROPOSED",
    deltaPaise: lakhs(5),
    effectiveDate: "2026-04-01",
  };

  it("a PROPOSED amendment does not move the authorised value", () => {
    expect(currentContractValuePaise(RS_60L, [proposed])).toBe(RS_60L);
  });

  it("an APPROVED amendment does", () => {
    expect(currentContractValuePaise(RS_60L, [{ ...proposed, status: "APPROVED" }])).toBe(lakhs(65));
  });

  it("a REJECTED amendment does not", () => {
    expect(currentContractValuePaise(RS_60L, [{ ...proposed, status: "REJECTED" }])).toBe(RS_60L);
  });

  it("a reducing variation lowers the authorised value and the remaining work", () => {
    const r = reconcileAgreement(
      structure({
        amendments: [{ id: "a", status: "APPROVED", deltaPaise: -lakhs(10), effectiveDate: "2026-04-01" }],
        milestones: [milestone(1, "COMPLETED", "2026-02-15T00:00:00.000Z"), ...[2, 3, 4, 5, 6].map((n) => milestone(n))],
      }),
    );
    expect(r.currentContractValuePaise).toBe(RS_50L);
    expect(r.amendmentDeltaPaise).toBe(-lakhs(10));
    expect(r.remainingUnearnedPaise).toBe(lakhs(40));
  });
});

/* ── Scenario J2: the earned-value ceiling in the engine ────────────────── */

describe("earned-value ceiling", () => {
  it("clamps earned value to the authorised amount and reports the excess", () => {
    // Six ₹11,00,000 milestones = ₹66,00,000 against a ₹60,00,000 agreement.
    const r = reconcileAgreement(
      structure({
        milestones: [1, 2, 3, 4, 5, 6].map((n) =>
          milestone(n, "COMPLETED", "2026-02-15T00:00:00.000Z", lakhs(11)),
        ),
      }),
    );
    expect(r.earnedValueRawPaise).toBe(lakhs(66));
    expect(r.earnedValuePaise).toBe(RS_60L);
    expect(r.earnedValueExcessPaise).toBe(lakhs(6));
    expect(r.earnedValuePaise).toBeLessThanOrEqual(r.currentContractValuePaise);
  });

  it("reports coverage variance during setup without clamping anything", () => {
    const r = reconcileAgreement(
      structure({ milestones: [1, 2, 3, 4, 5, 6].map((n) => milestone(n, "NOT_STARTED", null, lakhs(11))) }),
    );
    expect(r.milestoneCoveragePaise).toBe(lakhs(66));
    expect(r.milestoneCoverageVariancePaise).toBe(lakhs(6));
    expect(r.earnedValuePaise).toBe(0);
  });

  it("cancelled milestones count towards neither earned value nor coverage", () => {
    const r = reconcileAgreement(
      structure({
        milestones: [
          milestone(1, "COMPLETED", "2026-02-15T00:00:00.000Z"),
          milestone(2, "CANCELLED"),
          ...[3, 4, 5, 6].map((n) => milestone(n)),
        ],
      }),
    );
    expect(r.earnedValuePaise).toBe(RS_10L);
    expect(r.milestoneCoveragePaise).toBe(RS_50L);
    expect(r.milestonesTotal).toBe(5);
  });
});

/* ── Scenario J3: the credit ceiling ────────────────────────────────────── */

describe("credit ceiling", () => {
  it("allows a payment that stays within the authorised value", () => {
    expect(
      validateCreditCeiling({
        additionalCreditPaise: RS_2L,
        totalCreditedPaise: RS_8L,
        currentContractValuePaise: RS_60L,
      }),
    ).toBeNull();
  });

  it("allows paying ahead of earned work", () => {
    // Nothing earned yet; an advance is still fine inside the ceiling.
    expect(
      validateCreditCeiling({
        additionalCreditPaise: RS_12L,
        totalCreditedPaise: 0,
        currentContractValuePaise: RS_60L,
      }),
    ).toBeNull();
  });

  it("allows crediting exactly up to the authorised value", () => {
    expect(
      validateCreditCeiling({
        additionalCreditPaise: RS_2L,
        totalCreditedPaise: lakhs(58),
        currentContractValuePaise: RS_60L,
      }),
    ).toBeNull();
  });

  it("refuses a payment that would exceed it, and says how much room is left", () => {
    const msg = validateCreditCeiling({
      additionalCreditPaise: lakhs(6),
      totalCreditedPaise: lakhs(58),
      currentContractValuePaise: RS_60L,
    });
    expect(msg).toContain("₹60,00,000");
    expect(msg).toContain("₹2,00,000");
    expect(msg).toContain("amendment");
  });

  it("refuses zero and negative amounts", () => {
    expect(
      validateCreditCeiling({ additionalCreditPaise: 0, totalCreditedPaise: 0, currentContractValuePaise: RS_60L }),
    ).toContain("greater than zero");
    expect(
      validateCreditCeiling({ additionalCreditPaise: -1, totalCreditedPaise: 0, currentContractValuePaise: RS_60L }),
    ).toContain("greater than zero");
  });
});

/* ── Scenario M: reversal ───────────────────────────────────────────────── */

describe("payment reversal", () => {
  const withReversal = structure({
    milestones: [milestone(1, "COMPLETED", "2026-02-15T00:00:00.000Z"), ...[2, 3, 4, 5, 6].map((n) => milestone(n))],
    attendanceCredits: [credit("a1", RS_6L)],
    payments: [
      payment("p1", RS_2L),
      { ...payment("p2", RS_2L), reversedAt: "2026-02-20T00:00:00.000Z" },
    ],
  });

  it("a reversed payment contributes nothing to credit", () => {
    const r = reconcileAgreement(withReversal);
    expect(r.otherPaymentCreditPaise).toBe(RS_2L);
    expect(r.totalCreditedPaise).toBe(RS_8L);
    expect(r.currentDuePaise).toBe(RS_2L);
  });

  it("reversing an ahead-payment converts ahead credit back into a due", () => {
    const before = reconcileAgreement(
      structure({
        milestones: [milestone(1, "COMPLETED", "2026-02-15T00:00:00.000Z"), ...[2, 3, 4, 5, 6].map((n) => milestone(n))],
        payments: [payment("p1", RS_12L)],
      }),
    );
    expect(before.advanceCreditPaise).toBe(RS_2L);

    const after = reconcileAgreement(
      structure({
        milestones: [milestone(1, "COMPLETED", "2026-02-15T00:00:00.000Z"), ...[2, 3, 4, 5, 6].map((n) => milestone(n))],
        payments: [{ ...payment("p1", RS_12L), reversedAt: "2026-03-01T00:00:00.000Z" }],
      }),
    );
    expect(after.advanceCreditPaise).toBe(0);
    expect(after.currentDuePaise).toBe(RS_10L);
  });

  it("never drives a field negative", () => {
    const r = reconcileAgreement(
      structure({ payments: [{ ...payment("p1", RS_12L), reversedAt: "2026-03-01T00:00:00.000Z" }] }),
    );
    expect(r.currentDuePaise).toBeGreaterThanOrEqual(0);
    expect(r.advanceCreditPaise).toBeGreaterThanOrEqual(0);
    expect(r.totalCreditedPaise).toBe(0);
  });
});

/* ── As-of and timeline ─────────────────────────────────────────────────── */

describe("reconcileAsOf and the timeline", () => {
  const snap = structure({
    milestones: [
      milestone(1, "COMPLETED", "2026-02-15T00:00:00.000Z"),
      milestone(2, "COMPLETED", "2026-03-20T00:00:00.000Z"),
      ...[3, 4, 5, 6].map((n) => milestone(n)),
    ],
    attendanceCredits: [credit("a1", RS_6L, "2026-02-05"), credit("a2", lakhs(5), "2026-03-05")],
    payments: [payment("p1", RS_2L, "2026-02-10"), payment("p2", lakhs(4), "2026-03-10")],
  });

  it("as at Slab 1's completion, Slab 2 has not been earned", () => {
    const r = reconcileAsOf(snap, "2026-02-15");
    expect(r.earnedValuePaise).toBe(RS_10L);
    expect(r.totalCreditedPaise).toBe(RS_8L);
    expect(r.currentDuePaise).toBe(RS_2L);
  });

  it("as at the latest event it matches the live reconciliation", () => {
    const asOf = reconcileAsOf(snap, "2026-12-31");
    const live = reconcileAgreement({ ...snap, unsettledAttendancePaise: 0 });
    expect(asOf).toEqual(live);
  });

  it("builds one ascending cumulative point per event date", () => {
    const points = reconciliationTimeline(snap);
    expect(points.map((p) => p.date)).toEqual([
      "2026-02-05",
      "2026-02-10",
      "2026-02-15",
      "2026-03-05",
      "2026-03-10",
      "2026-03-20",
    ]);
    const slab1 = points.find((p) => p.date === "2026-02-15")!;
    expect(slab1.earnedValuePaise).toBe(RS_10L);
    expect(slab1.totalCreditedPaise).toBe(RS_8L);
    expect(slab1.currentDuePaise).toBe(RS_2L);

    const slab2 = points.find((p) => p.date === "2026-03-20")!;
    expect(slab2.earnedValuePaise).toBe(RS_20L);
    expect(slab2.totalCreditedPaise).toBe(lakhs(17));
    expect(slab2.currentDuePaise).toBe(RS_3L);
  });

  it("excludes a payment reversed before the as-at date", () => {
    const r = reconcileAsOf(
      structure({
        payments: [{ ...payment("p1", RS_2L, "2026-02-10"), reversedAt: "2026-02-12T00:00:00.000Z" }],
      }),
      "2026-02-28",
    );
    expect(r.totalCreditedPaise).toBe(0);
  });

  it("still counts a payment reversed AFTER the as-at date", () => {
    const r = reconcileAsOf(
      structure({
        payments: [{ ...payment("p1", RS_2L, "2026-02-10"), reversedAt: "2026-03-12T00:00:00.000Z" }],
      }),
      "2026-02-28",
    );
    expect(r.totalCreditedPaise).toBe(RS_2L);
  });
});
