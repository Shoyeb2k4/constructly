/**
 * The pure projections behind the Milestones tab.
 *
 * Two rules carry this pass, and both are pinned here rather than in a
 * component: planned COVERAGE is a warning that never normalises a value, and a
 * completion PREVIEW must predict exactly what the reconciliation statement will
 * say afterwards. The preview test proves that by running the real engine over a
 * real snapshot and comparing.
 */
import { describe, it, expect } from "vitest";
import {
  availableMilestoneActions,
  deleteMilestoneBlockedReason,
  milestoneCoverage,
  previewMilestoneCompletion,
} from "./milestones";
import { reconcileAgreement } from "./reconcile";
import { MILESTONE_TRANSITIONS } from "./milestones";
import type { AgreementSnapshot, MilestoneEntry, MilestoneStatus } from "./types";

const L = (lakhs: number) => lakhs * 100_000 * 100;

/** Six ₹10L slabs on a ₹60L agreement; the first `completed` of them are done. */
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

/* ── Coverage ───────────────────────────────────────────────────────────── */

describe("milestoneCoverage", () => {
  it("reports exact coverage when the plan matches the agreement", () => {
    const c = milestoneCoverage(reconcileAgreement(snapshot()));
    expect(c.state).toBe("EXACT");
    expect(c.plannedPaise).toBe(L(60));
    expect(c.authorisedPaise).toBe(L(60));
    expect(c.variancePaise).toBe(0);
    expect(c.message).toMatch(/Coverage complete/);
  });

  it("reports what is not yet allocated when the plan falls short", () => {
    // 5 slabs planned against a ₹60L agreement → ₹10L unallocated.
    const c = milestoneCoverage(reconcileAgreement(snapshot({ milestones: slabs(5, 0) })));
    expect(c.state).toBe("UNDER");
    expect(c.plannedPaise).toBe(L(50));
    expect(c.variancePaise).toBe(-L(10));
    expect(c.magnitudePaise).toBe(L(10));
    expect(c.message).toMatch(/not yet allocated/);
  });

  it("warns when the plan exceeds the authorised value, without normalising it", () => {
    const c = milestoneCoverage(reconcileAgreement(snapshot({ milestones: slabs(7, 0) })));
    expect(c.state).toBe("OVER");
    // The planned figure is reported AS ENTERED — never clamped to the agreement.
    expect(c.plannedPaise).toBe(L(70));
    expect(c.variancePaise).toBe(L(10));
    expect(c.message).toMatch(/above the authorised/);
  });

  it("says nothing is allocated when there are no milestones at all", () => {
    const c = milestoneCoverage(reconcileAgreement(snapshot({ milestones: [] })));
    expect(c.state).toBe("NONE");
    expect(c.plannedPaise).toBe(0);
  });

  it("excludes cancelled milestones from planned coverage", () => {
    const ms = slabs(6, 0);
    ms[5] = { ...ms[5], status: "CANCELLED" };
    const c = milestoneCoverage(reconcileAgreement(snapshot({ milestones: ms })));
    expect(c.plannedPaise).toBe(L(50));
    expect(c.state).toBe("UNDER");
  });
});

/* ── Completion preview ─────────────────────────────────────────────────── */

describe("previewMilestoneCompletion", () => {
  it("predicts the brief's case: ₹10L earned against ₹8L credited leaves ₹2L due", () => {
    const snap = snapshot({
      payments: [
        { id: "p1", amountPaise: L(8), date: "2026-02-01", type: "INTERIM", reversedAt: null },
      ],
    });
    const p = previewMilestoneCompletion({
      reconciliation: reconcileAgreement(snap),
      milestoneValuePaise: L(10),
    });
    expect(p.earnedBeforePaise).toBe(0);
    expect(p.earnedAfterPaise).toBe(L(10));
    expect(p.creditedPaise).toBe(L(8));
    expect(p.dueAfterPaise).toBe(L(2));
    expect(p.aheadAfterPaise).toBe(0);
    expect(p.blockedReason).toBeNull();
  });

  it("predicts ahead credit when credit exceeds the new earned value", () => {
    const snap = snapshot({
      payments: [{ id: "p1", amountPaise: L(12), date: "2026-02-01", type: "INTERIM", reversedAt: null }],
    });
    const p = previewMilestoneCompletion({
      reconciliation: reconcileAgreement(snap),
      milestoneValuePaise: L(10),
    });
    expect(p.dueAfterPaise).toBe(0);
    expect(p.aheadAfterPaise).toBe(L(2));
  });

  it("AGREES with the engine — the preview is what the statement will say", () => {
    // Predict, then actually complete Slab 1 and reconcile for real.
    const before = snapshot({
      payments: [{ id: "p1", amountPaise: L(8), date: "2026-02-01", type: "INTERIM", reversedAt: null }],
    });
    const p = previewMilestoneCompletion({
      reconciliation: reconcileAgreement(before),
      milestoneValuePaise: L(10),
    });

    const after = reconcileAgreement({
      ...before,
      milestones: slabs(6, 1),
    });
    expect(after.earnedValuePaise).toBe(p.earnedAfterPaise);
    expect(after.currentDuePaise).toBe(p.dueAfterPaise);
    expect(after.advanceCreditPaise).toBe(p.aheadAfterPaise);
  });

  it("still agrees after a second completion — earned accrues cumulatively", () => {
    const oneDone = snapshot({
      milestones: slabs(6, 1),
      payments: [{ id: "p1", amountPaise: L(8), date: "2026-02-01", type: "INTERIM", reversedAt: null }],
    });
    const p = previewMilestoneCompletion({
      reconciliation: reconcileAgreement(oneDone),
      milestoneValuePaise: L(10),
    });
    expect(p.earnedBeforePaise).toBe(L(10));
    expect(p.earnedAfterPaise).toBe(L(20));
    expect(p.dueAfterPaise).toBe(L(12));

    const after = reconcileAgreement({ ...oneDone, milestones: slabs(6, 2) });
    expect(after.earnedValuePaise).toBe(L(20));
    expect(after.currentDuePaise).toBe(L(12));
  });

  it("refuses a completion that would recognise more than the authorised value", () => {
    // ₹60L agreement, all six slabs done; a seventh ₹10L checkpoint cannot earn.
    const full = snapshot({ milestones: slabs(6, 6) });
    const p = previewMilestoneCompletion({
      reconciliation: reconcileAgreement(full),
      milestoneValuePaise: L(10),
    });
    expect(p.blockedReason).toMatch(/amendment/);
    // Earned never runs past the authorised value even in the projection.
    expect(p.earnedAfterPaise).toBe(L(60));
  });

  it("allows a completion that lands exactly on the authorised value", () => {
    const p = previewMilestoneCompletion({
      reconciliation: reconcileAgreement(snapshot({ milestones: slabs(6, 5) })),
      milestoneValuePaise: L(10),
    });
    expect(p.blockedReason).toBeNull();
    expect(p.earnedAfterPaise).toBe(L(60));
  });
});

/* ── Row actions ────────────────────────────────────────────────────────── */

describe("availableMilestoneActions", () => {
  it("offers exactly the transitions the shared table permits", () => {
    for (const from of ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const) {
      const offered = availableMilestoneActions({ status: from }, "IN_PROGRESS").map(
        (a) => a.status,
      );
      expect([...offered].sort()).toEqual([...MILESTONE_TRANSITIONS[from]].sort());
    }
  });

  it("names COMPLETED → IN_PROGRESS as reopening, and confirms it", () => {
    const reopen = availableMilestoneActions({ status: "COMPLETED" }, "IN_PROGRESS").find(
      (a) => a.status === "IN_PROGRESS",
    );
    expect(reopen?.label).toBe("Reopen milestone");
    expect(reopen?.confirm).toBe(true);
  });

  it("requires a reason only for cancelling", () => {
    const actions = availableMilestoneActions({ status: "NOT_STARTED" }, "IN_PROGRESS");
    expect(actions.find((a) => a.status === "CANCELLED")?.requiresReason).toBe(true);
    expect(actions.find((a) => a.status === "COMPLETED")?.requiresReason).toBe(false);
  });

  it("offers nothing once the agreement is cancelled or settled", () => {
    expect(availableMilestoneActions({ status: "NOT_STARTED" }, "CANCELLED")).toEqual([]);
    expect(availableMilestoneActions({ status: "NOT_STARTED" }, "SETTLED")).toEqual([]);
  });
});

describe("deleteMilestoneBlockedReason", () => {
  it("allows deleting a milestone that never started", () => {
    expect(deleteMilestoneBlockedReason({ status: "NOT_STARTED" }, "IN_PROGRESS")).toBeNull();
  });

  it("refuses a completed milestone and points at reopening or cancelling", () => {
    expect(deleteMilestoneBlockedReason({ status: "COMPLETED" }, "IN_PROGRESS")).toMatch(
      /reopen it first, or cancel it/,
    );
  });

  it("refuses anything that has progressed, pointing at cancel", () => {
    expect(deleteMilestoneBlockedReason({ status: "IN_PROGRESS" }, "IN_PROGRESS")).toMatch(
      /Cancel it instead/,
    );
  });

  it("refuses on a cancelled or settled agreement", () => {
    expect(deleteMilestoneBlockedReason({ status: "NOT_STARTED" }, "CANCELLED")).toMatch(
      /agreement is cancelled/,
    );
    expect(deleteMilestoneBlockedReason({ status: "NOT_STARTED" }, "SETTLED")).toMatch(
      /closed out as settled/,
    );
  });
});
