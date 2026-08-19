/**
 * The agreement action layer, as a user meets it.
 *
 * These tests assert REACHABILITY and CONTEXT — that the menu offers the right
 * actions for the agreement's state and the viewer's permissions, and that the
 * right agreement reaches the form behind each one. The domain rules themselves
 * are pinned in ../agreement-actions.test.ts and on the server; nothing here
 * re-tests arithmetic.
 *
 * The two sheets are stubbed so the assertions can name the contract that
 * reached them. Which fields those forms contain is their own concern.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import type { Permission } from "@/features/rbac/permissions";
import type { AgreementReconciliation, Contract } from "../types";

/* ── Test doubles ───────────────────────────────────────────────────────── */

const h = vi.hoisted(() => ({
  permissions: new Set<string>(),
  setStatus: vi.fn(),
  cancel: vi.fn(),
  del: vi.fn(),
}));

vi.mock("@/features/rbac/permission-context", () => ({
  useCan: () => (p: Permission) => h.permissions.has(p),
}));

vi.mock("../hooks", () => ({
  useSetContractStatus: () => ({ mutate: h.setStatus, isPending: false }),
  useCancelContract: () => ({ mutate: h.cancel, isPending: false }),
  useDeleteContract: () => ({ mutate: h.del, isPending: false }),
}));

// Stubs that announce which agreement they were handed.
vi.mock("./contract-form-sheet", () => ({
  ContractFormSheet: ({ open, contract }: { open: boolean; contract?: Contract }) =>
    open ? <div data-testid="edit-sheet">{contract ? contract.id : "no-contract"}</div> : null,
}));
vi.mock("./record-contract-payment-sheet", () => ({
  RecordContractPaymentSheet: ({ open, contract }: { open: boolean; contract: Contract }) =>
    open ? <div data-testid="pay-sheet">{contract.id}</div> : null,
}));
// The amendment sheet has its own tests; here it only needs to announce which
// agreement the menu handed it.
vi.mock("./amendment-actions", () => ({
  ProposeAmendmentSheet: ({ open, contract }: { open: boolean; contract: Contract }) =>
    open ? <div data-testid="amend-sheet">{contract.id}</div> : null,
}));

import { AgreementActionsMenu } from "./agreement-actions-menu";

/* ── Fixtures ───────────────────────────────────────────────────────────── */

const PRISTINE: AgreementReconciliation = {
  agreementId: "ag-structure",
  originalContractValuePaise: 600_000_000,
  amendmentDeltaPaise: 0,
  currentContractValuePaise: 600_000_000,
  earnedValueRawPaise: 0,
  earnedValuePaise: 0,
  earnedValueExcessPaise: 0,
  attendanceCreditPaise: 0,
  otherPaymentCreditPaise: 0,
  totalCreditedPaise: 0,
  currentDuePaise: 0,
  advanceCreditPaise: 0,
  remainingUnearnedPaise: 600_000_000,
  overallBalancePaise: 600_000_000,
  overCreditedPaise: 0,
  unsettledAttendancePaise: 0,
  milestoneCoveragePaise: 0,
  milestoneCoverageVariancePaise: -600_000_000,
  milestonesTotal: 0,
  milestonesCompleted: 0,
};

function contract(over: Partial<Contract> = {}): Contract {
  return {
    id: "ag-structure",
    contractorId: "c-pappu",
    contractorName: "Pappu Contractor",
    projectId: "p-skyline",
    projectName: "Skyline Tower",
    title: "Structure Labour Contract",
    reference: "AGR-2026-001",
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
    reconciliation: PRISTINE,
    ...over,
  };
}

const ALL: Permission[] = [
  "contracts.edit",
  "contracts.complete",
  "contracts.cancel",
  "contracts.delete",
  "contracts.pay",
];

function grant(...permissions: Permission[]) {
  h.permissions = new Set(permissions);
}

/** Render and open the menu; returns the menu for scoped queries. */
function openMenu(c: Contract = contract()) {
  render(<AgreementActionsMenu contract={c} />);
  const trigger = screen.getByRole("button", { name: `Actions for ${c.title}` });
  // Radix opens on pointerdown, not click.
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  return screen.getByRole("menu");
}

beforeEach(() => {
  grant(...ALL);
  h.setStatus.mockReset();
  h.cancel.mockReset();
  h.del.mockReset();
});
afterEach(cleanup);

/* ── Permissions ────────────────────────────────────────────────────────── */

describe("permission gating", () => {
  it("renders nothing at all when the viewer may do none of it", () => {
    grant();
    const { container } = render(<AgreementActionsMenu contract={contract()} />);
    expect(container.innerHTML).toBe("");
  });

  it("offers only the contracts.edit actions to a viewer holding only that", () => {
    grant("contracts.edit");
    const menu = openMenu();
    expect(within(menu).getByText("Edit agreement")).toBeTruthy();
    // Raising an amendment is also a contracts.edit action — it is the maker
    // half of maker-checker, and deciding it needs contracts.amend_approve.
    expect(within(menu).getByText("Propose amendment")).toBeTruthy();
    expect(within(menu).queryByText("Record payment")).toBeNull();
    expect(within(menu).queryByText("Cancel agreement")).toBeNull();
    expect(within(menu).queryByText("Delete agreement")).toBeNull();
    expect(within(menu).queryByText("Put on hold")).toBeNull();
  });

  it("hides Record payment without contracts.pay", () => {
    grant("contracts.edit", "contracts.complete");
    expect(within(openMenu()).queryByText("Record payment")).toBeNull();
  });

  it("hides lifecycle changes without contracts.complete", () => {
    grant("contracts.edit", "contracts.pay");
    const menu = openMenu();
    expect(within(menu).queryByText("Put on hold")).toBeNull();
    expect(within(menu).queryByText("Mark completed")).toBeNull();
  });

  it("hides Cancel without contracts.cancel, and Delete without contracts.delete", () => {
    grant("contracts.edit", "contracts.complete", "contracts.pay");
    const menu = openMenu();
    expect(within(menu).queryByText("Cancel agreement")).toBeNull();
    expect(within(menu).queryByText("Delete agreement")).toBeNull();
  });
});

/* ── Edit ───────────────────────────────────────────────────────────────── */

describe("edit agreement", () => {
  it("is reachable, and opens the shared form on THIS agreement", () => {
    const c = contract({ id: "ag-finishing", title: "Interior Finishing" });
    const menu = openMenu(c);
    fireEvent.click(within(menu).getByText("Edit agreement"));
    expect(screen.getByTestId("edit-sheet").textContent).toBe("ag-finishing");
  });

  it("does not open the form before the action is chosen", () => {
    openMenu();
    expect(screen.queryByTestId("edit-sheet")).toBeNull();
  });
});

/* ── Lifecycle ──────────────────────────────────────────────────────────── */

describe("lifecycle actions", () => {
  it("offers hold and complete on an in-progress agreement, and calls the server action", () => {
    const menu = openMenu(contract({ status: "IN_PROGRESS" }));
    fireEvent.click(within(menu).getByText("Put on hold"));
    expect(h.setStatus).toHaveBeenCalledWith({ id: "ag-structure", status: "ON_HOLD" });
  });

  it("does not offer transitions the domain forbids", () => {
    // A cancelled agreement may only move back to NOT_STARTED.
    const menu = openMenu(contract({ status: "CANCELLED" }));
    expect(within(menu).queryByText("Put on hold")).toBeNull();
    expect(within(menu).queryByText("Mark completed")).toBeNull();
    expect(within(menu).getByText("Move back to not started")).toBeTruthy();
  });

  it("never offers Cancel as a status change — it has its own flow", () => {
    const menu = openMenu(contract({ status: "IN_PROGRESS" }));
    // Present once, as the dedicated destructive action; never in the Status group.
    expect(within(menu).getAllByText("Cancel agreement")).toHaveLength(1);
  });

  it("offers close-out disabled, with the reason, when the agreement is not reconciled", () => {
    const menu = openMenu(
      contract({
        status: "COMPLETED",
        reconciliation: { ...PRISTINE, milestonesTotal: 6, milestonesCompleted: 5 },
      }),
    );
    expect(within(menu).getByText(/1 milestone is not complete/)).toBeTruthy();
    fireEvent.click(within(menu).getByText("Close out as settled"));
    expect(h.setStatus).not.toHaveBeenCalled();
  });

  it("confirms before closing out, rather than acting on the menu click", () => {
    const reconciled: AgreementReconciliation = {
      ...PRISTINE,
      earnedValuePaise: 600_000_000,
      earnedValueRawPaise: 600_000_000,
      otherPaymentCreditPaise: 600_000_000,
      totalCreditedPaise: 600_000_000,
      remainingUnearnedPaise: 0,
      overallBalancePaise: 0,
      milestonesTotal: 6,
      milestonesCompleted: 6,
    };
    const menu = openMenu(contract({ status: "COMPLETED", reconciliation: reconciled }));
    fireEvent.click(within(menu).getByText("Close out as settled"));
    expect(h.setStatus).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close out as settled" }));
    expect(h.setStatus).toHaveBeenCalledWith(
      { id: "ag-structure", status: "SETTLED" },
      expect.anything(),
    );
  });
});

/* ── Cancel ─────────────────────────────────────────────────────────────── */

describe("cancel agreement", () => {
  it("requires a reason before it will submit", () => {
    const menu = openMenu();
    fireEvent.click(within(menu).getByText("Cancel agreement"));

    const dialog = screen.getByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: "Cancel agreement" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(within(dialog).getByLabelText("Reason"), {
      target: { value: "Client dropped the package" },
    });
    fireEvent.click(submit);
    expect(h.cancel).toHaveBeenCalledWith(
      { id: "ag-structure", reason: "Client dropped the package" },
      expect.anything(),
    );
  });

  it("is not offered on an already-cancelled agreement", () => {
    const menu = openMenu(contract({ status: "CANCELLED" }));
    expect(within(menu).queryByText("Cancel agreement")).toBeNull();
  });
});

/* ── Delete ─────────────────────────────────────────────────────────────── */

describe("delete agreement", () => {
  it("deletes a pristine agreement after confirmation", () => {
    const menu = openMenu();
    fireEvent.click(within(menu).getByText("Delete agreement"));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete agreement" }));
    expect(h.del).toHaveBeenCalledWith("ag-structure", expect.anything());
  });

  it("is disabled, pointing at cancel, once the agreement has financial history", () => {
    const menu = openMenu(
      contract({
        reconciliation: { ...PRISTINE, otherPaymentCreditPaise: 100_000, totalCreditedPaise: 100_000 },
      }),
    );
    expect(within(menu).getByText(/Cancel it instead/)).toBeTruthy();
    fireEvent.click(within(menu).getByText("Delete agreement"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.del).not.toHaveBeenCalled();
  });
});

/* ── Payment ────────────────────────────────────────────────────────────── */

describe("record payment from the agreement row", () => {
  it("opens the payment sheet on THIS agreement", () => {
    const menu = openMenu(contract({ id: "ag-wall", title: "Compound Wall" }));
    fireEvent.click(within(menu).getByText("Record payment"));
    expect(screen.getByTestId("pay-sheet").textContent).toBe("ag-wall");
  });

  it("is not offered on a cancelled agreement — the server refuses the payment", () => {
    const menu = openMenu(contract({ status: "CANCELLED" }));
    expect(within(menu).queryByText("Record payment")).toBeNull();
  });
});
