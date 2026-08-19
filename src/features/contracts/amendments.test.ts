/**
 * The pure amendment rules.
 *
 * Two things carry this pass. First, an amendment moves the AUTHORISED value and
 * nothing else — never earned, never credited. Second, the revised value has a
 * FLOOR: it may not fall below what has been credited or earned, or the record
 * would assert an agreement that owes more than it authorises.
 */
import { describe, it, expect } from "vitest";
import {
  approveBlockedReason,
  approvedDeltaPaise,
  canProposeAmendment,
  isDecidable,
  isStale,
  previewAmendment,
  validateRevisedValue,
} from "./amendments";
import { reconcileAgreement } from "./reconcile";
import { CONTRACT_STATUSES } from "./constants";
import type { AgreementSnapshot, Amendment, MilestoneEntry, MilestoneStatus } from "./types";

const L = (lakhs: number) => lakhs * 100_000 * 100;

function slabs(count: number, completed: number, valuePaise = L(10)): MilestoneEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `slab-${i + 1}`,
    sequence: i,
    title: `Slab ${i + 1}`,
    valuePaise,
    status: (i < completed ? "COMPLETED" : "NOT_STARTED") as MilestoneStatus,
    completedAt: i < completed ? "2026-02-15T00:00:00.000Z" : null,
  }));
}

function snapshot(over: Partial<AgreementSnapshot> = {}): AgreementSnapshot {
  return {
    agreementId: "ag-structure",
    status: "IN_PROGRESS",
    originalAmountPaise: L(60),
    amendments: [],
    milestones: slabs(6, 0),
    attendanceCredits: [],
    payments: [],
    unsettledAttendancePaise: 0,
    ...over,
  };
}

function amendment(over: Partial<Amendment> = {}): Amendment {
  return {
    id: "am-1",
    contractId: "ag-structure",
    sequence: 0,
    type: "VARIATION",
    previousAmountPaise: L(60),
    revisedAmountPaise: L(65),
    deltaPaise: L(5),
    reason: "Additional authorised structural work",
    effectiveDate: "2026-05-20",
    status: "PROPOSED",
    requestedByName: "Aarav Mehta",
    approvedByName: null,
    approvedAt: null,
    rejectedReason: null,
    createdAt: "2026-05-20T00:00:00.000Z",
    ...over,
  };
}

/* ── Preview ────────────────────────────────────────────────────────────── */

describe("previewAmendment", () => {
  it("reads the brief's case: ₹60,00,000 + ₹5,00,000 = ₹65,00,000", () => {
    const p = previewAmendment({
      revisedAmountPaise: L(65),
      reconciliation: reconcileAgreement(snapshot()),
    });
    expect(p.currentAuthorisedPaise).toBe(L(60));
    expect(p.deltaPaise).toBe(L(5));
    expect(p.direction).toBe("INCREASE");
    expect(p.revisedAuthorisedPaise).toBe(L(65));
    expect(p.blockedReason).toBeNull();
  });

  it("reads a reduction as a negative delta: ₹60,00,000 − ₹3,00,000 = ₹57,00,000", () => {
    const p = previewAmendment({
      revisedAmountPaise: L(57),
      reconciliation: reconcileAgreement(snapshot()),
    });
    expect(p.deltaPaise).toBe(-L(3));
    expect(p.direction).toBe("DECREASE");
    expect(p.revisedAuthorisedPaise).toBe(L(57));
    expect(p.blockedReason).toBeNull();
  });

  it("puts the whole delta on unearned work — an amendment earns nothing", () => {
    const earned = snapshot({ milestones: slabs(6, 2) }); // ₹20,00,000 earned
    const p = previewAmendment({
      revisedAmountPaise: L(65),
      reconciliation: reconcileAgreement(earned),
    });
    // Remaining unearned goes ₹40,00,000 → ₹45,00,000; earned stays ₹20,00,000.
    expect(p.remainingUnearnedAfterPaise).toBe(L(45));
  });

  it("refuses a no-op revision", () => {
    const p = previewAmendment({
      revisedAmountPaise: L(60),
      reconciliation: reconcileAgreement(snapshot()),
    });
    expect(p.direction).toBe("NONE");
    expect(p.blockedReason).toMatch(/NO_VALUE_CHANGE/);
  });
});

/* ── The floor ──────────────────────────────────────────────────────────── */

describe("validateRevisedValue — the floor on a reduction", () => {
  it("allows a reduction that stays above earned and credited", () => {
    const r = reconcileAgreement(snapshot({ milestones: slabs(6, 2) })); // earned ₹20L
    expect(validateRevisedValue({ revisedAmountPaise: L(30), reconciliation: r })).toBeNull();
  });

  it("refuses a reduction below the work already recognised as earned", () => {
    // ₹55,00,000 earned; reducing the agreement to ₹50,00,000 would owe more
    // than it authorises.
    const r = reconcileAgreement(
      snapshot({ milestones: slabs(6, 5), originalAmountPaise: L(60) }),
    );
    expect(r.earnedValuePaise).toBe(L(50));
    const blocked = validateRevisedValue({ revisedAmountPaise: L(40), reconciliation: r });
    expect(blocked).toMatch(/REVISION_BELOW_EARNED/);
  });

  it("refuses a reduction below what has already been credited", () => {
    const r = reconcileAgreement(
      snapshot({
        payments: [
          { id: "p1", amountPaise: L(30), date: "2026-03-01", type: "INTERIM", reversedAt: null },
        ],
      }),
    );
    expect(validateRevisedValue({ revisedAmountPaise: L(20), reconciliation: r })).toMatch(
      /REVISION_BELOW_CREDITED/,
    );
  });

  it("allows a reduction that lands exactly on the earned value", () => {
    const r = reconcileAgreement(snapshot({ milestones: slabs(6, 5) }));
    expect(validateRevisedValue({ revisedAmountPaise: L(50), reconciliation: r })).toBeNull();
  });

  it("surfaces the same refusal through the preview", () => {
    const r = reconcileAgreement(snapshot({ milestones: slabs(6, 5) }));
    const p = previewAmendment({ revisedAmountPaise: L(40), reconciliation: r });
    expect(p.blockedReason).toMatch(/REVISION_BELOW_EARNED/);
  });
});

/* ── Staleness ──────────────────────────────────────────────────────────── */

describe("isStale", () => {
  it("is fresh while the agreement still stands where it was raised against", () => {
    expect(isStale(amendment(), L(60))).toBe(false);
  });

  it("is stale once another amendment has moved the authorised value", () => {
    // Raised against ₹60,00,000; a +₹2,00,000 amendment landed first.
    expect(isStale(amendment(), L(62))).toBe(true);
  });
});

/* ── Lifecycle ──────────────────────────────────────────────────────────── */

describe("lifecycle", () => {
  it("permits proposing on every status except cancelled", () => {
    for (const s of CONTRACT_STATUSES) {
      expect(canProposeAmendment(s)).toBe(s !== "CANCELLED");
    }
  });

  it("refuses approval on a cancelled or settled agreement, and allows the rest", () => {
    for (const s of CONTRACT_STATUSES) {
      const blocked = approveBlockedReason(s);
      if (s === "CANCELLED" || s === "SETTLED") expect(blocked).toBeTruthy();
      else expect(blocked).toBeNull();
    }
  });

  it("only a proposed amendment can be decided", () => {
    expect(isDecidable(amendment({ status: "PROPOSED" }))).toBe(true);
    expect(isDecidable(amendment({ status: "APPROVED" }))).toBe(false);
    expect(isDecidable(amendment({ status: "REJECTED" }))).toBe(false);
  });
});

/* ── Approved delta ─────────────────────────────────────────────────────── */

describe("approvedDeltaPaise", () => {
  it("counts APPROVED amendments only", () => {
    const rows = [
      amendment({ id: "a", status: "APPROVED", deltaPaise: L(5) }),
      amendment({ id: "b", status: "PROPOSED", deltaPaise: L(9) }),
      amendment({ id: "c", status: "REJECTED", deltaPaise: L(7) }),
    ];
    expect(approvedDeltaPaise(rows)).toBe(L(5));
  });

  it("nets a reduction against an increase", () => {
    const rows = [
      amendment({ id: "a", status: "APPROVED", deltaPaise: L(5) }),
      amendment({ id: "b", status: "APPROVED", deltaPaise: -L(3) }),
    ];
    expect(approvedDeltaPaise(rows)).toBe(L(2));
  });

  it("agrees with the engine's own amendmentDeltaPaise", () => {
    const snap = snapshot({
      amendments: [
        { id: "a", status: "APPROVED", deltaPaise: L(5), effectiveDate: "2026-05-20" },
        { id: "b", status: "PROPOSED", deltaPaise: L(9), effectiveDate: "2026-06-01" },
      ],
    });
    const engine = reconcileAgreement(snap);
    const rows = [
      amendment({ id: "a", status: "APPROVED", deltaPaise: L(5) }),
      amendment({ id: "b", status: "PROPOSED", deltaPaise: L(9) }),
    ];
    expect(approvedDeltaPaise(rows)).toBe(engine.amendmentDeltaPaise);
    expect(engine.currentContractValuePaise).toBe(L(65));
  });
});
