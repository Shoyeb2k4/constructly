/**
 * Which actions an agreement offers — the pure projection behind the Command
 * Centre's menu.
 *
 * The rules restated here already exist on the server. These tests pin the
 * projection to them, so the menu can never quietly start offering an action the
 * domain refuses (or hiding one it allows). Where a rule is shared with a pure
 * engine — agreement transitions, the settle precondition — the test asserts the
 * two AGREE rather than re-stating the rule a second time.
 */
import { describe, it, expect } from "vitest";
import {
  availableStatusActions,
  canCancelAgreement,
  canDeleteAgreement,
  deleteBlockedReason,
  describeAgreementError,
  settleBlockedReason,
} from "./agreement-actions";
import { AGREEMENT_TRANSITIONS, canSettleAgreement } from "./milestones";
import { CONTRACT_STATUSES } from "./constants";
import type { AgreementReconciliation, Contract, ContractStatus, MilestoneEntry } from "./types";

/** A fully reconciled ₹60,00,000 agreement: all earned, all credited, nothing due. */
function recon(over: Partial<AgreementReconciliation> = {}): AgreementReconciliation {
  return {
    agreementId: "a1",
    originalContractValuePaise: 600_000_000,
    amendmentDeltaPaise: 0,
    currentContractValuePaise: 600_000_000,
    earnedValueRawPaise: 600_000_000,
    earnedValuePaise: 600_000_000,
    earnedValueExcessPaise: 0,
    attendanceCreditPaise: 0,
    otherPaymentCreditPaise: 600_000_000,
    totalCreditedPaise: 600_000_000,
    currentDuePaise: 0,
    advanceCreditPaise: 0,
    remainingUnearnedPaise: 0,
    overallBalancePaise: 0,
    overCreditedPaise: 0,
    unsettledAttendancePaise: 0,
    milestoneCoveragePaise: 600_000_000,
    milestoneCoverageVariancePaise: 0,
    milestonesTotal: 6,
    milestonesCompleted: 6,
    ...over,
  };
}

/** A pristine agreement: created, never used. */
function contract(over: Partial<Contract> = {}): Contract {
  return {
    id: "a1",
    contractorId: "c1",
    contractorName: "Pappu Contractor",
    projectId: "p1",
    projectName: "Skyline Tower",
    title: "Structure Labour Contract",
    reference: null,
    scope: null,
    quantity: null,
    unit: null,
    originalAmountPaise: 600_000_000,
    currentAmountPaise: 600_000_000,
    startDate: null,
    expectedCompletionDate: null,
    status: "IN_PROGRESS",
    notes: null,
    completedAt: null,
    settledAt: null,
    cancelledAt: null,
    cancelledReason: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    reconciliation: recon({
      earnedValueRawPaise: 0,
      earnedValuePaise: 0,
      otherPaymentCreditPaise: 0,
      totalCreditedPaise: 0,
      remainingUnearnedPaise: 600_000_000,
      overallBalancePaise: 600_000_000,
      milestoneCoveragePaise: 0,
      milestoneCoverageVariancePaise: -600_000_000,
      milestonesTotal: 0,
      milestonesCompleted: 0,
    }),
    ...over,
  };
}

describe("availableStatusActions", () => {
  it("offers exactly the transitions the shared engine permits, minus CANCELLED", () => {
    for (const from of CONTRACT_STATUSES) {
      const offered = availableStatusActions(contract({ status: from })).map((a) => a.status);
      const expected = AGREEMENT_TRANSITIONS[from].filter((s) => s !== "CANCELLED");
      expect([...offered].sort()).toEqual([...expected].sort());
    }
  });

  it("never offers CANCELLED — cancelling is its own authority and needs a reason", () => {
    for (const from of CONTRACT_STATUSES) {
      const offered = availableStatusActions(contract({ status: from })).map((a) => a.status);
      expect(offered).not.toContain("CANCELLED" as ContractStatus);
    }
  });

  it("never offers the status the agreement is already in", () => {
    for (const from of CONTRACT_STATUSES) {
      expect(availableStatusActions(contract({ status: from })).map((a) => a.status)).not.toContain(
        from,
      );
    }
  });

  it("does not offer hold or complete on a cancelled agreement", () => {
    const offered = availableStatusActions(contract({ status: "CANCELLED" })).map((a) => a.status);
    expect(offered).not.toContain("ON_HOLD" as ContractStatus);
    expect(offered).not.toContain("COMPLETED" as ContractStatus);
    expect(offered).toEqual(["NOT_STARTED"]);
  });

  it("asks for confirmation on close-out and on un-starting, not on routine changes", () => {
    const fromCompleted = availableStatusActions(contract({ status: "COMPLETED" }));
    expect(fromCompleted.find((a) => a.status === "SETTLED")?.confirm).toBe(true);
    expect(fromCompleted.find((a) => a.status === "IN_PROGRESS")?.confirm).toBe(false);

    const fromInProgress = availableStatusActions(contract({ status: "IN_PROGRESS" }));
    expect(fromInProgress.find((a) => a.status === "ON_HOLD")?.confirm).toBe(false);
    expect(fromInProgress.find((a) => a.status === "NOT_STARTED")?.confirm).toBe(true);
  });
});

describe("settleBlockedReason — agrees with the server's canSettleAgreement", () => {
  /** Milestones matching a reconciliation's completed/total counts. */
  const milestones = (total: number, completed: number): MilestoneEntry[] =>
    Array.from({ length: total }, (_, i) => ({
      id: `m${i}`,
      sequence: i,
      title: `Slab ${i + 1}`,
      valuePaise: 100_000_000,
      status: (i < completed ? "COMPLETED" : "NOT_STARTED") as MilestoneEntry["status"],
      completedAt: i < completed ? "2026-02-15T00:00:00.000Z" : null,
    }));

  const cases: { name: string; r: AgreementReconciliation }[] = [
    { name: "fully reconciled", r: recon() },
    { name: "milestones outstanding", r: recon({ milestonesCompleted: 5 }) },
    {
      name: "value not fully earned",
      r: recon({
        earnedValuePaise: 500_000_000,
        remainingUnearnedPaise: 100_000_000,
        totalCreditedPaise: 500_000_000,
        otherPaymentCreditPaise: 500_000_000,
      }),
    },
    {
      name: "money still due",
      r: recon({ totalCreditedPaise: 500_000_000, otherPaymentCreditPaise: 500_000_000, currentDuePaise: 100_000_000 }),
    },
    {
      name: "credited ahead",
      r: recon({ totalCreditedPaise: 700_000_000, otherPaymentCreditPaise: 700_000_000, advanceCreditPaise: 100_000_000 }),
    },
  ];

  for (const { name, r } of cases) {
    it(`${name}: blocks iff the engine blocks`, () => {
      const engine = canSettleAgreement({
        reconciliation: r,
        milestones: milestones(r.milestonesTotal, r.milestonesCompleted),
      });
      const projection = settleBlockedReason(r);
      expect(projection === null).toBe(engine === null);
    });
  }

  it("offers close-out as available only when nothing blocks it", () => {
    const ready = availableStatusActions(
      contract({ status: "COMPLETED", reconciliation: recon() }),
    ).find((a) => a.status === "SETTLED");
    expect(ready?.blockedReason).toBeNull();

    const notReady = availableStatusActions(
      contract({ status: "COMPLETED", reconciliation: recon({ milestonesCompleted: 5 }) }),
    ).find((a) => a.status === "SETTLED");
    expect(notReady?.blockedReason).toMatch(/not complete/);
  });
});

describe("cancel and delete are different things", () => {
  it("cancel is available on anything not already cancelled", () => {
    expect(canCancelAgreement(contract({ status: "IN_PROGRESS" }))).toBe(true);
    expect(canCancelAgreement(contract({ status: "SETTLED" }))).toBe(true);
    expect(canCancelAgreement(contract({ status: "CANCELLED" }))).toBe(false);
  });

  it("delete is available only for an agreement with no financial history at all", () => {
    expect(canDeleteAgreement(contract())).toBe(true);
    expect(deleteBlockedReason(contract())).toBeNull();
  });

  const blockers: { name: string; over: Partial<AgreementReconciliation> }[] = [
    { name: "a live payment", over: { otherPaymentCreditPaise: 1, totalCreditedPaise: 1 } },
    { name: "a completed milestone", over: { milestonesTotal: 1, milestonesCompleted: 1 } },
    { name: "settled labour", over: { attendanceCreditPaise: 1 } },
    { name: "unsettled labour", over: { unsettledAttendancePaise: 1 } },
    { name: "an approved amendment", over: { amendmentDeltaPaise: 500_000 } },
  ];
  for (const { name, over } of blockers) {
    it(`refuses delete once there is ${name}, and points at cancel`, () => {
      const c = contract({ reconciliation: { ...contract().reconciliation, ...over } });
      expect(canDeleteAgreement(c)).toBe(false);
      expect(deleteBlockedReason(c)).toMatch(/Cancel it instead/);
    });
  }
});

describe("describeAgreementError", () => {
  it("explains the domain refusals a user can actually hit", () => {
    expect(describeAgreementError(new Error("USE_AMENDMENT"), "fallback")).toMatch(
      /approved amendment/,
    );
    expect(describeAgreementError(new Error("HAS_FINANCIAL_HISTORY"), "fallback")).toMatch(
      /Cancel it instead/,
    );
    expect(describeAgreementError(new Error("AGREEMENT_CANCELLED"), "fallback")).toMatch(
      /cancelled/,
    );
  });

  it("prefers the server's own sentence when it supplied one", () => {
    const msg = describeAgreementError(
      new Error("CREDIT_EXCEEDS_CONTRACT_VALUE: At most ₹2,00,000 can be recorded."),
      "fallback",
    );
    expect(msg).toBe("At most ₹2,00,000 can be recorded.");
  });

  it("falls back rather than leaking internals", () => {
    // Next.js masks Server Action errors in production; a digest must never reach
    // the user as if it were an explanation.
    for (const raw of [
      "An error occurred in the Server Components render. Digest: 3856299942",
      "PrismaClientKnownRequestError: P2002",
      "Failed to fetch",
      "",
    ]) {
      expect(describeAgreementError(new Error(raw), "Couldn't record the payment.")).toBe(
        "Couldn't record the payment.",
      );
    }
    expect(describeAgreementError(undefined, "Couldn't do it.")).toBe("Couldn't do it.");
    expect(describeAgreementError({ weird: true }, "Couldn't do it.")).toBe("Couldn't do it.");
  });
});
