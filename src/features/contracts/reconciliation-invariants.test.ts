/**
 * Property-style invariants over generated snapshots.
 *
 * The worked scenarios in reconcile.test.ts prove the engine gets the brief's
 * cases right. These prove it can't get *any* case structurally wrong — in
 * particular the roll-up rule, which is the one place a plausible-looking
 * implementation silently loses money.
 */
import { describe, it, expect } from "vitest";
import { reconcileAgreement, reconcileAsOf, rollUpReconciliations } from "./reconcile";
import type {
  AgreementReconciliation,
  AgreementSnapshot,
  AmendmentEntry,
  AttendanceCreditEntry,
  MilestoneEntry,
  PaymentEntry,
} from "./types";
import { lakhs } from "./__fixtures__/amounts";

/** Deterministic PRNG so a failure is always reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

const DATES = [
  "2026-01-10",
  "2026-02-05",
  "2026-02-15",
  "2026-03-05",
  "2026-03-20",
  "2026-04-12",
  "2026-05-30",
];

function generate(seed: number): AgreementSnapshot {
  const rand = seed === 0 ? () => 0 : rng(seed);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length) % xs.length];
  const amount = (maxLakhs: number) => lakhs(Math.floor(rand() * maxLakhs));

  const original = lakhs(10 + Math.floor(rand() * 90));

  const milestones: MilestoneEntry[] = Array.from(
    { length: 1 + Math.floor(rand() * 6) },
    (_, i) => {
      const status = pick<MilestoneEntry["status"]>([
        "NOT_STARTED",
        "IN_PROGRESS",
        "COMPLETED",
        "CANCELLED",
      ]);
      return {
        id: `m${i}`,
        sequence: i + 1,
        title: `Milestone ${i + 1}`,
        valuePaise: amount(20),
        status,
        completedAt: status === "COMPLETED" ? `${pick(DATES)}T00:00:00.000Z` : null,
      };
    },
  );

  const amendments: AmendmentEntry[] = Array.from(
    { length: Math.floor(rand() * 3) },
    (_, i) => ({
      id: `a${i}`,
      status: pick<AmendmentEntry["status"]>(["PROPOSED", "APPROVED", "REJECTED"]),
      // Signed: variations may reduce scope.
      deltaPaise: (rand() < 0.3 ? -1 : 1) * amount(15),
      effectiveDate: pick(DATES),
    }),
  );

  const attendanceCredits: AttendanceCreditEntry[] = Array.from(
    { length: Math.floor(rand() * 4) },
    (_, i) => ({ id: `c${i}`, date: pick(DATES), amountPaise: amount(8) }),
  );

  const payments: PaymentEntry[] = Array.from({ length: Math.floor(rand() * 4) }, (_, i) => ({
    id: `p${i}`,
    date: pick(DATES),
    amountPaise: amount(12),
    type: "INTERIM" as const,
    reversedAt: rand() < 0.25 ? `${pick(DATES)}T00:00:00.000Z` : null,
  }));

  return {
    agreementId: `ag-${seed}`,
    status: "IN_PROGRESS",
    originalAmountPaise: original,
    amendments,
    milestones,
    attendanceCredits,
    payments,
    unsettledAttendancePaise: amount(5),
  };
}

const SNAPSHOTS = Array.from({ length: 200 }, (_, i) => generate(i));

describe("agreement-level invariants", () => {
  it("at most one of due / ahead is non-zero", () => {
    for (const s of SNAPSHOTS) {
      const r = reconcileAgreement(s);
      expect(r.currentDuePaise * r.advanceCreditPaise).toBe(0);
    }
  });

  it("earned − credited === due − ahead", () => {
    for (const s of SNAPSHOTS) {
      const r = reconcileAgreement(s);
      expect(r.earnedValuePaise - r.totalCreditedPaise).toBe(
        r.currentDuePaise - r.advanceCreditPaise,
      );
    }
  });

  it("recognised earned value never exceeds the authorised contract value", () => {
    for (const s of SNAPSHOTS) {
      const r = reconcileAgreement(s);
      expect(r.earnedValuePaise).toBeLessThanOrEqual(r.currentContractValuePaise);
    }
  });

  it("credited components sum to the total", () => {
    for (const s of SNAPSHOTS) {
      const r = reconcileAgreement(s);
      expect(r.attendanceCreditPaise + r.otherPaymentCreditPaise).toBe(r.totalCreditedPaise);
    }
  });

  it("balances are consistent with value, earned and credited", () => {
    for (const s of SNAPSHOTS) {
      const r = reconcileAgreement(s);
      expect(r.remainingUnearnedPaise).toBe(r.currentContractValuePaise - r.earnedValuePaise);
      expect(r.overallBalancePaise).toBe(r.currentContractValuePaise - r.totalCreditedPaise);
    }
  });

  it("due, ahead, and every credit figure are non-negative", () => {
    for (const s of SNAPSHOTS) {
      const r = reconcileAgreement(s);
      for (const v of [
        r.currentDuePaise,
        r.advanceCreditPaise,
        r.attendanceCreditPaise,
        r.otherPaymentCreditPaise,
        r.totalCreditedPaise,
        r.earnedValuePaise,
        r.earnedValueExcessPaise,
        r.overCreditedPaise,
      ]) {
        expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("every field is an integer — no float leakage", () => {
    for (const s of SNAPSHOTS) {
      const r = reconcileAgreement(s);
      for (const [key, value] of Object.entries(r)) {
        if (typeof value === "number") {
          expect(Number.isInteger(value), `${key} = ${value}`).toBe(true);
        }
      }
    }
  });

  it("as-of at the far future equals the live reconciliation", () => {
    for (const s of SNAPSHOTS) {
      const live = reconcileAgreement({ ...s, unsettledAttendancePaise: 0 });
      expect(reconcileAsOf(s, "2099-12-31")).toEqual(live);
    }
  });
});

describe("roll-up invariants — the no-netting rule", () => {
  /** Deterministic grouping into portfolios of 1..4 agreements. */
  const PORTFOLIOS: AgreementReconciliation[][] = [];
  for (let i = 0; i < SNAPSHOTS.length; i += 3) {
    PORTFOLIOS.push(SNAPSHOTS.slice(i, i + 3).map(reconcileAgreement));
  }

  it("total due is the SUM of each agreement's due", () => {
    for (const p of PORTFOLIOS) {
      const roll = rollUpReconciliations(p);
      expect(roll.totalCurrentDuePaise).toBe(
        p.reduce((acc, r) => acc + r.currentDuePaise, 0),
      );
    }
  });

  it("total ahead is the SUM of each agreement's ahead", () => {
    for (const p of PORTFOLIOS) {
      const roll = rollUpReconciliations(p);
      expect(roll.totalAdvanceCreditPaise).toBe(
        p.reduce((acc, r) => acc + r.advanceCreditPaise, 0),
      );
    }
  });

  it("never re-derives due from summed earned and credited", () => {
    // The naive formula can only ever UNDERSTATE what is owed, because an
    // advance on one agreement cancels a payable on another.
    for (const p of PORTFOLIOS) {
      const roll = rollUpReconciliations(p);
      const naive = Math.max(0, roll.totalEarnedPaise - roll.totalCreditedPaise);
      expect(roll.totalCurrentDuePaise).toBeGreaterThanOrEqual(naive);
    }
  });

  it("due and ahead can both be positive at portfolio level", () => {
    const mixed = PORTFOLIOS.filter(
      (p) =>
        p.some((r) => r.currentDuePaise > 0) && p.some((r) => r.advanceCreditPaise > 0),
    );
    // The generator produces plenty of these; if it ever stops, the invariant
    // below would be vacuous and we want to know.
    expect(mixed.length).toBeGreaterThan(0);
    for (const p of mixed) {
      const roll = rollUpReconciliations(p);
      expect(roll.totalCurrentDuePaise).toBeGreaterThan(0);
      expect(roll.totalAdvanceCreditPaise).toBeGreaterThan(0);
    }
  });

  it("the informational net position is exactly due − ahead", () => {
    for (const p of PORTFOLIOS) {
      const roll = rollUpReconciliations(p);
      expect(roll.netCommercialPositionPaise).toBe(
        roll.totalCurrentDuePaise - roll.totalAdvanceCreditPaise,
      );
      expect(roll.netCommercialPositionPaise).toBe(
        roll.totalEarnedPaise - roll.totalCreditedPaise,
      );
    }
  });

  it("component totals are plain sums", () => {
    for (const p of PORTFOLIOS) {
      const roll = rollUpReconciliations(p);
      expect(roll.totalEarnedPaise).toBe(p.reduce((a, r) => a + r.earnedValuePaise, 0));
      expect(roll.totalCreditedPaise).toBe(p.reduce((a, r) => a + r.totalCreditedPaise, 0));
      expect(roll.totalContractValuePaise).toBe(
        p.reduce((a, r) => a + r.currentContractValuePaise, 0),
      );
      expect(roll.agreementCount).toBe(p.length);
    }
  });

  it("splitting a portfolio never changes its total due", () => {
    for (const p of PORTFOLIOS) {
      if (p.length < 2) continue;
      const whole = rollUpReconciliations(p);
      const a = rollUpReconciliations(p.slice(0, 1));
      const b = rollUpReconciliations(p.slice(1));
      expect(a.totalCurrentDuePaise + b.totalCurrentDuePaise).toBe(whole.totalCurrentDuePaise);
      expect(a.totalAdvanceCreditPaise + b.totalAdvanceCreditPaise).toBe(
        whole.totalAdvanceCreditPaise,
      );
    }
  });
});
