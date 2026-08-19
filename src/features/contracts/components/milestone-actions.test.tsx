/**
 * The milestone row's action menu, as a user meets it.
 *
 * Pins REACHABILITY, PERMISSION and the completion CONFIRMATION — in particular
 * that completing shows its financial effect before it commits, and that
 * reopening is offered as a correction rather than a delete. The arithmetic
 * behind those numbers is pinned in ../milestone-projections.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import type { Permission } from "@/features/rbac/permissions";
import type { AgreementReconciliation, Contract, Milestone } from "../types";

const h = vi.hoisted(() => ({
  permissions: new Set<string>(),
  setStatus: vi.fn(),
  del: vi.fn(),
}));

vi.mock("@/features/rbac/permission-context", () => ({
  useCan: () => (p: Permission) => h.permissions.has(p),
}));
vi.mock("../hooks", () => ({
  useSetMilestoneStatus: () => ({ mutate: h.setStatus, isPending: false }),
  useDeleteMilestone: () => ({ mutate: h.del, isPending: false }),
  useCreateMilestone: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateMilestone: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { MilestoneActionsMenu } from "./milestone-actions";

const L = (lakhs: number) => lakhs * 100_000 * 100;

/** ₹60L agreement, nothing earned, ₹8L credited — the brief's opening position. */
function recon(over: Partial<AgreementReconciliation> = {}): AgreementReconciliation {
  return {
    agreementId: "ag-structure",
    originalContractValuePaise: L(60),
    amendmentDeltaPaise: 0,
    currentContractValuePaise: L(60),
    earnedValueRawPaise: 0,
    earnedValuePaise: 0,
    earnedValueExcessPaise: 0,
    attendanceCreditPaise: 0,
    otherPaymentCreditPaise: L(8),
    totalCreditedPaise: L(8),
    currentDuePaise: 0,
    advanceCreditPaise: L(8),
    remainingUnearnedPaise: L(60),
    overallBalancePaise: L(52),
    overCreditedPaise: 0,
    unsettledAttendancePaise: 0,
    milestoneCoveragePaise: L(60),
    milestoneCoverageVariancePaise: 0,
    milestonesTotal: 6,
    milestonesCompleted: 0,
    ...over,
  };
}

function contract(over: Partial<Contract> = {}): Contract {
  return {
    id: "ag-structure",
    contractorId: "c-pappu",
    contractorName: "Pappu Contractor",
    projectId: "p-skyline",
    projectName: "Skyline Tower",
    title: "Structure Labour Contract",
    reference: null,
    scope: null,
    quantity: null,
    unit: null,
    originalAmountPaise: L(60),
    currentAmountPaise: L(60),
    startDate: null,
    expectedCompletionDate: null,
    status: "IN_PROGRESS",
    notes: null,
    completedAt: null,
    settledAt: null,
    cancelledAt: null,
    cancelledReason: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    reconciliation: recon(),
    ...over,
  };
}

function milestone(over: Partial<Milestone> = {}): Milestone {
  return {
    id: "slab-1",
    contractId: "ag-structure",
    sequence: 0,
    title: "Slab 1",
    description: null,
    valuePaise: L(10),
    plannedDate: null,
    status: "NOT_STARTED",
    completedAt: null,
    completedByName: null,
    cancelledAt: null,
    cancelledReason: null,
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    financialStateAtCompletion: "NOT_EARNED",
    currentCoverageState: "NOT_EARNED",
    cumulativeEarnedPaise: null,
    cumulativeCreditedPaise: null,
    cumulativeEarnedThresholdPaise: 0,
    ...over,
  };
}

const grant = (...p: Permission[]) => (h.permissions = new Set(p));

function openMenu(m: Milestone = milestone(), c: Contract = contract()) {
  render(<MilestoneActionsMenu contract={c} milestone={m} />);
  const trigger = screen.getByRole("button", { name: `Actions for ${m.title}` });
  fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
  return screen.getByRole("menu");
}

beforeEach(() => {
  grant("contracts.edit", "contracts.complete");
  h.setStatus.mockReset();
  h.del.mockReset();
});
afterEach(cleanup);

/* ── Permissions ────────────────────────────────────────────────────────── */

describe("permission gating", () => {
  it("renders nothing for a viewer who may do neither", () => {
    grant("contracts.view");
    const { container } = render(
      <MilestoneActionsMenu contract={contract()} milestone={milestone()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("hides status changes without contracts.complete", () => {
    grant("contracts.edit");
    const menu = openMenu();
    expect(within(menu).queryByText("Mark completed")).toBeNull();
    expect(within(menu).queryByText("Cancel milestone")).toBeNull();
    // Editing is still available on its own permission.
    expect(within(menu).getByText("Edit milestone")).toBeTruthy();
  });

  it("hides editing and deleting without contracts.edit", () => {
    grant("contracts.complete");
    const menu = openMenu();
    expect(within(menu).queryByText("Edit milestone")).toBeNull();
    expect(within(menu).queryByText("Delete milestone")).toBeNull();
    expect(within(menu).getByText("Mark completed")).toBeTruthy();
  });
});

/* ── Offered actions ────────────────────────────────────────────────────── */

describe("which actions are offered", () => {
  it("offers the legal transitions for a milestone that has not started", () => {
    const menu = openMenu();
    expect(within(menu).getByText("Mark in progress")).toBeTruthy();
    expect(within(menu).getByText("Mark completed")).toBeTruthy();
    expect(within(menu).getByText("Cancel milestone")).toBeTruthy();
    expect(within(menu).queryByText("Reopen milestone")).toBeNull();
  });

  it("offers ONLY reopening on a completed milestone", () => {
    const menu = openMenu(milestone({ status: "COMPLETED", completedAt: "2026-02-15T00:00:00Z" }));
    expect(within(menu).getByText("Reopen milestone")).toBeTruthy();
    expect(within(menu).queryByText("Mark completed")).toBeNull();
    expect(within(menu).queryByText("Cancel milestone")).toBeNull();
  });

  it("offers nothing once the agreement is cancelled or settled", () => {
    for (const status of ["CANCELLED", "SETTLED"] as const) {
      const menu = openMenu(milestone(), contract({ status }));
      expect(within(menu).queryByText("Mark completed")).toBeNull();
      expect(within(menu).queryByText("Reopen milestone")).toBeNull();
      cleanup();
    }
  });
});

/* ── Completion ─────────────────────────────────────────────────────────── */

describe("completing a milestone", () => {
  it("confirms first, showing the effect on earned value and what is due", () => {
    const menu = openMenu();
    fireEvent.click(within(menu).getByText("Mark completed"));
    expect(h.setStatus).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog");
    // "will increase cumulative earned value by ₹10,00,000"
    expect(within(dialog).getByText(/increase cumulative earned value by/)).toBeTruthy();
    expect(within(dialog).getByText("Earned value")).toBeTruthy();
    expect(within(dialog).getByText("Already credited")).toBeTruthy();
    // ₹10L earned against ₹8L credited leaves ₹2L due.
    expect(within(dialog).getByText("Currently due")).toBeTruthy();
    expect(within(dialog).getByText(/no existing payment is attached/i)).toBeTruthy();
  });

  it("commits the completion once confirmed", () => {
    const menu = openMenu();
    fireEvent.click(within(menu).getByText("Mark completed"));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark completed" }));
    expect(h.setStatus).toHaveBeenCalledWith(
      { id: "slab-1", status: "COMPLETED", reason: null },
      expect.anything(),
    );
  });

  it("blocks completion past the authorised value, explaining why", () => {
    // ₹60L agreement fully earned already; this ₹10L slab cannot be recognised.
    const full = contract({
      reconciliation: recon({
        earnedValuePaise: L(60),
        earnedValueRawPaise: L(60),
        remainingUnearnedPaise: 0,
        milestonesCompleted: 6,
      }),
    });
    const menu = openMenu(milestone(), full);
    fireEvent.click(within(menu).getByText("Mark completed"));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/raise an amendment/i)).toBeTruthy();
    const submit = within(dialog).getByRole("button", { name: "Mark completed" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(submit);
    expect(h.setStatus).not.toHaveBeenCalled();
  });
});

/* ── Correction ─────────────────────────────────────────────────────────── */

describe("reopening a milestone", () => {
  it("confirms, and says the value is un-recognised rather than deleted", () => {
    const done = milestone({ status: "COMPLETED", completedAt: "2026-02-15T00:00:00Z" });
    const menu = openMenu(done, contract({ reconciliation: recon({ earnedValuePaise: L(10) }) }));
    fireEvent.click(within(menu).getByText("Reopen milestone"));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/un-recognises/)).toBeTruthy();
    expect(within(dialog).getByText(/nothing is deleted, and no payment is touched/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Reopen milestone" }));
    expect(h.setStatus).toHaveBeenCalledWith(
      { id: "slab-1", status: "IN_PROGRESS", reason: null },
      expect.anything(),
    );
  });
});

/* ── Cancel ─────────────────────────────────────────────────────────────── */

describe("cancelling a milestone", () => {
  it("requires a reason before it will submit", () => {
    const menu = openMenu();
    fireEvent.click(within(menu).getByText("Cancel milestone"));

    const dialog = screen.getByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: "Cancel milestone" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(within(dialog).getByLabelText("Reason"), {
      target: { value: "Slab dropped from the package" },
    });
    fireEvent.click(submit);
    expect(h.setStatus).toHaveBeenCalledWith(
      { id: "slab-1", status: "CANCELLED", reason: "Slab dropped from the package" },
      expect.anything(),
    );
  });
});

/* ── Delete ─────────────────────────────────────────────────────────────── */

describe("deleting a milestone", () => {
  it("deletes one that never started, after confirmation", () => {
    const menu = openMenu();
    fireEvent.click(within(menu).getByText("Delete milestone"));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete milestone" }));
    expect(h.del).toHaveBeenCalledWith("slab-1", expect.anything());
  });

  it("is disabled on a completed milestone, pointing at reopen or cancel", () => {
    const menu = openMenu(milestone({ status: "COMPLETED", completedAt: "2026-02-15T00:00:00Z" }));
    expect(within(menu).getByText(/reopen it first, or cancel it/)).toBeTruthy();
    fireEvent.click(within(menu).getByText("Delete milestone"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.del).not.toHaveBeenCalled();
  });
});

/* ── Reorder ────────────────────────────────────────────────────────────── */

describe("reordering", () => {
  it("offers Move up / Move down only in the directions this row can move", () => {
    const onMoveDown = vi.fn();
    render(
      <MilestoneActionsMenu
        contract={contract()}
        milestone={milestone()}
        onMoveDown={onMoveDown}
      />,
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: "Actions for Slab 1" }), {
      button: 0,
      pointerType: "mouse",
    });
    const menu = screen.getByRole("menu");

    const up = within(menu).getByText("Move up").closest('[role="menuitem"]')!;
    expect(up.getAttribute("data-disabled")).not.toBeNull();

    fireEvent.click(within(menu).getByText("Move down"));
    expect(onMoveDown).toHaveBeenCalled();
  });
});
