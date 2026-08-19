/**
 * Recording and reversing an agreement payment, as a user meets it.
 *
 * The two things worth pinning: a payment always lands on ONE named agreement
 * (never a guess, never a split), and reversal is offered exactly once — on a
 * payment that is still live.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import type { AgreementReconciliation, Contract, ContractPaymentHistoryRow } from "../types";

const h = vi.hoisted(() => ({ reverse: vi.fn() }));

vi.mock("../hooks", () => ({
  useReverseContractPayment: () => ({ mutate: h.reverse, isPending: false }),
}));

// Stubbed so the assertions can name the agreement the sheet was handed.
vi.mock("./record-contract-payment-sheet", () => ({
  RecordContractPaymentSheet: ({ open, contract }: { open: boolean; contract: Contract }) =>
    open ? <div data-testid="pay-sheet">{contract.id}</div> : null,
}));

import {
  RecordPaymentLauncher,
  ReverseContractPaymentDialog,
  ReversePaymentButton,
} from "./payment-actions";

/* ── Fixtures ───────────────────────────────────────────────────────────── */

const RECON: AgreementReconciliation = {
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
    reconciliation: RECON,
    ...over,
  };
}

function payment(over: Partial<ContractPaymentHistoryRow> = {}): ContractPaymentHistoryRow {
  return {
    id: "pay-1",
    contractId: "ag-structure",
    contractorId: "c-pappu",
    projectId: "p-skyline",
    amountPaise: 50_000_00,
    type: "INTERIM",
    paymentMode: "BANK_TRANSFER",
    referenceNumber: null,
    date: "2026-03-01",
    notes: null,
    milestoneId: null,
    milestoneTitle: null,
    reversedAt: null,
    reversalReason: null,
    createdByName: "Aarav Mehta",
    createdAt: "2026-03-01T00:00:00.000Z",
    projectName: "Skyline Tower",
    contractTitle: "Structure Labour Contract",
    ...over,
  };
}

beforeEach(() => h.reverse.mockReset());
afterEach(cleanup);

/* ── Record ─────────────────────────────────────────────────────────────── */

describe("recording a payment", () => {
  it("goes straight to the sheet when there is only one payable agreement", () => {
    render(<RecordPaymentLauncher contracts={[contract()]} />);
    fireEvent.click(screen.getByRole("button", { name: /Record payment/ }));
    expect(screen.getByTestId("pay-sheet").textContent).toBe("ag-structure");
  });

  it("asks which agreement when there are several, and passes the chosen one", () => {
    render(
      <RecordPaymentLauncher
        contracts={[contract(), contract({ id: "ag-wall", title: "Compound Wall" })]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Record payment/ }));

    // Nothing is assumed before the user says which.
    expect(screen.queryByTestId("pay-sheet")).toBeNull();

    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByText("Compound Wall"));
    expect(screen.getByTestId("pay-sheet").textContent).toBe("ag-wall");
  });

  it("does not offer a cancelled agreement — the server refuses payment against one", () => {
    render(
      <RecordPaymentLauncher
        contracts={[contract({ status: "CANCELLED" }), contract({ id: "ag-wall", title: "Compound Wall" })]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Record payment/ }));
    // Only one payable agreement remains, so it opens directly onto it.
    expect(screen.getByTestId("pay-sheet").textContent).toBe("ag-wall");
  });

  it("renders no control at all when every agreement is cancelled", () => {
    const { container } = render(
      <RecordPaymentLauncher contracts={[contract({ status: "CANCELLED" })]} />,
    );
    expect(container.innerHTML).toBe("");
  });
});

/* ── Reverse ────────────────────────────────────────────────────────────── */

describe("reversing a payment", () => {
  it("offers Reverse on a live payment", () => {
    render(<ReversePaymentButton payment={payment()} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: "Reverse" })).toBeTruthy();
  });

  it("offers nothing on an already-reversed payment — it cannot be reversed twice", () => {
    const { container } = render(
      <ReversePaymentButton
        payment={payment({ reversedAt: "2026-03-05T00:00:00.000Z", reversalReason: "Wrong agreement" })}
        onSelect={() => {}}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("requires a reason, then reverses that exact payment", () => {
    render(<ReverseContractPaymentDialog payment={payment()} onOpenChange={() => {}} />);

    const dialog = screen.getByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: "Reverse payment" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(within(dialog).getByLabelText("Reason"), {
      target: { value: "Recorded against the wrong agreement" },
    });
    expect((submit as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(submit);
    expect(h.reverse).toHaveBeenCalledWith(
      { id: "pay-1", reason: "Recorded against the wrong agreement" },
      expect.anything(),
    );
  });

  it("refuses a reason that is only whitespace", () => {
    render(<ReverseContractPaymentDialog payment={payment()} onOpenChange={() => {}} />);
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "   " } });
    const submit = within(dialog).getByRole("button", { name: "Reverse payment" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it("names the agreement and project being corrected", () => {
    render(<ReverseContractPaymentDialog payment={payment()} onOpenChange={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Structure Labour Contract/)).toBeTruthy();
    expect(within(dialog).getByText(/Skyline Tower/)).toBeTruthy();
  });

  it("renders nothing when no payment is selected", () => {
    const { container } = render(
      <ReverseContractPaymentDialog payment={null} onOpenChange={() => {}} />,
    );
    expect(container.innerHTML).toBe("");
  });
});
