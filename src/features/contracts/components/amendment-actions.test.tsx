/**
 * The amendment surface, as a user meets it.
 *
 * Pins the three figures staying apart (original / change / authorised), the
 * pending-means-nothing-moved rule, the maker–checker split, and the refusals a
 * user can hit — staleness, the floor, and a closed-out agreement.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import type { AgreementReconciliation, Amendment, Contract } from "../types";

const h = vi.hoisted(() => ({
  propose: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
}));

vi.mock("../hooks", () => ({
  useProposeAmendment: () => ({ mutate: h.propose, isPending: false }),
  useApproveAmendment: () => ({ mutate: h.approve, isPending: false }),
  useRejectAmendment: () => ({ mutate: h.reject, isPending: false }),
}));

import {
  AmendmentDecisionButtons,
  ApproveAmendmentDialog,
  ProposeAmendmentSheet,
  RejectAmendmentDialog,
} from "./amendment-actions";

const L = (lakhs: number) => lakhs * 100_000 * 100;

/** ₹60,00,000 authorised, ₹10,00,000 earned, ₹8,00,000 credited. */
function recon(over: Partial<AgreementReconciliation> = {}): AgreementReconciliation {
  return {
    agreementId: "ag-structure",
    originalContractValuePaise: L(60),
    amendmentDeltaPaise: 0,
    currentContractValuePaise: L(60),
    earnedValueRawPaise: L(10),
    earnedValuePaise: L(10),
    earnedValueExcessPaise: 0,
    attendanceCreditPaise: L(6),
    otherPaymentCreditPaise: L(2),
    totalCreditedPaise: L(8),
    currentDuePaise: L(2),
    advanceCreditPaise: 0,
    remainingUnearnedPaise: L(50),
    overallBalancePaise: L(52),
    overCreditedPaise: 0,
    unsettledAttendancePaise: 0,
    milestoneCoveragePaise: L(60),
    milestoneCoverageVariancePaise: 0,
    milestonesTotal: 6,
    milestonesCompleted: 1,
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

const setValue = (el: HTMLElement, v: string) => {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

beforeEach(() => {
  h.propose.mockReset();
  h.approve.mockReset();
  h.reject.mockReset();
});
afterEach(cleanup);

/* ── Propose ────────────────────────────────────────────────────────────── */

describe("proposing an amendment", () => {
  function open(c: Contract = contract()) {
    render(<ProposeAmendmentSheet open onOpenChange={() => {}} contract={c} />);
    return screen.getByRole("dialog");
  }

  it("names the agreement and states that the value is never edited in place", () => {
    const d = open();
    expect(within(d).getByText(/Structure Labour Contract/)).toBeTruthy();
    expect(within(d).getByText(/never edited in place/)).toBeTruthy();
  });

  it("previews +₹5,00,000 as ₹60,00,000 → ₹65,00,000 without committing anything", () => {
    const d = open();
    setValue(within(d).getByLabelText(/Change to the agreement value/), "500000");

    const text = d.textContent!.replace(/\s+/g, " ");
    expect(text).toMatch(/Current authorised value.*₹60,00,000/);
    expect(text).toMatch(/Proposed amendment.*\+₹5,00,000/);
    expect(text).toMatch(/If approved.*₹65,00,000/);
    expect(text).toMatch(/changes nothing until it is approved/);
    expect(h.propose).not.toHaveBeenCalled();
  });

  it("reads a negative entry as a reduction", () => {
    const d = open();
    setValue(within(d).getByLabelText(/Change to the agreement value/), "-300000");
    const text = d.textContent!.replace(/\s+/g, " ");
    expect(text).toMatch(/Proposed reduction.*−₹3,00,000/);
    expect(text).toMatch(/If approved.*₹57,00,000/);
  });

  it("requires a reason before it will submit", () => {
    const d = open();
    const submit = within(d).getByRole("button", { name: "Propose amendment" });
    setValue(within(d).getByLabelText(/Change to the agreement value/), "500000");
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    setValue(within(d).getByLabelText("Reason"), "Additional authorised structural work");
    expect((submit as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(submit);
    expect(h.propose).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: "ag-structure",
        revisedAmountPaise: L(65),
        reason: "Additional authorised structural work",
      }),
      expect.anything(),
    );
  });

  it("blocks a reduction below what has already been earned, and says why", () => {
    const d = open();
    // ₹8,00,000 credited and ₹10,00,000 earned. Reducing by ₹51,00,000 leaves
    // ₹9,00,000 authorised: above the credit floor, below the earned floor — so
    // it is the EARNED rule that must speak.
    setValue(within(d).getByLabelText(/Change to the agreement value/), "-5100000");
    setValue(within(d).getByLabelText("Reason"), "Too far");

    expect(within(d).getByText(/can't be below the .* of work already recognised as earned/)).toBeTruthy();
    expect(
      (within(d).getByRole("button", { name: "Propose amendment" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

/* ── Approve ────────────────────────────────────────────────────────────── */

describe("approving an amendment", () => {
  it("shows the three figures and states that earned and credited do not move", () => {
    render(
      <ApproveAmendmentDialog
        contract={contract()}
        amendment={amendment()}
        onOpenChange={() => {}}
      />,
    );
    const d = screen.getByRole("dialog");
    const text = d.textContent!.replace(/\s+/g, " ");
    expect(text).toMatch(/Current authorised value.*₹60,00,000/);
    expect(text).toMatch(/\+₹5,00,000/);
    expect(text).toMatch(/New authorised value.*₹65,00,000/);
    expect(text).toMatch(/Earned value stays at ₹10,00,000/);
    expect(text).toMatch(/credited stays at ₹8,00,000/);
    expect(text).toMatch(/no payment moves/);
  });

  it("approves the exact amendment", () => {
    render(
      <ApproveAmendmentDialog
        contract={contract()}
        amendment={amendment()}
        onOpenChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve amendment" }));
    expect(h.approve).toHaveBeenCalledWith("am-1", expect.anything());
  });

  it("refuses a stale amendment, explaining that it must be raised again", () => {
    // Another amendment moved the agreement to ₹62,00,000 in the meantime.
    render(
      <ApproveAmendmentDialog
        contract={contract({ reconciliation: recon({ currentContractValuePaise: L(62) }) })}
        amendment={amendment()}
        onOpenChange={() => {}}
      />,
    );
    const d = screen.getByRole("dialog");
    expect(within(d).getByText(/Another amendment was approved while this one was waiting/)).toBeTruthy();
    const submit = within(d).getByRole("button", { name: "Approve amendment" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(submit);
    expect(h.approve).not.toHaveBeenCalled();
  });

  it("refuses on a settled agreement", () => {
    render(
      <ApproveAmendmentDialog
        contract={contract({ status: "SETTLED" })}
        amendment={amendment()}
        onOpenChange={() => {}}
      />,
    );
    const d = screen.getByRole("dialog");
    expect(within(d).getByText(/closed out as settled/)).toBeTruthy();
    expect(
      (within(d).getByRole("button", { name: "Approve amendment" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("refuses a reduction that has fallen below earned value since proposal", () => {
    render(
      <ApproveAmendmentDialog
        contract={contract({ reconciliation: recon({ earnedValuePaise: L(50) }) })}
        amendment={amendment({ revisedAmountPaise: L(30), deltaPaise: -L(30) })}
        onOpenChange={() => {}}
      />,
    );
    const d = screen.getByRole("dialog");
    expect(within(d).getByText(/already recognised as earned/)).toBeTruthy();
    expect(
      (within(d).getByRole("button", { name: "Approve amendment" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

/* ── Reject ─────────────────────────────────────────────────────────────── */

describe("rejecting an amendment", () => {
  it("requires a reason and says nothing is deleted", () => {
    render(
      <RejectAmendmentDialog
        contract={contract()}
        amendment={amendment()}
        onOpenChange={() => {}}
      />,
    );
    const d = screen.getByRole("dialog");
    expect(within(d).getByText(/nothing is deleted/)).toBeTruthy();

    const submit = within(d).getByRole("button", { name: "Reject amendment" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    setValue(within(d).getByLabelText("Reason"), "Variation not agreed with the client");
    fireEvent.click(submit);
    expect(h.reject).toHaveBeenCalledWith(
      { id: "am-1", reason: "Variation not agreed with the client" },
      expect.anything(),
    );
  });
});

/* ── Decision buttons ───────────────────────────────────────────────────── */

describe("decision buttons", () => {
  it("offer Approve and Reject on a proposed amendment", () => {
    render(<AmendmentDecisionButtons contract={contract()} amendment={amendment()} />);
    expect(screen.getByRole("button", { name: /Approve/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Reject/ })).toBeTruthy();
  });

  it("open the approval dialog on demand", () => {
    render(<AmendmentDecisionButtons contract={contract()} amendment={amendment()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Approve/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
