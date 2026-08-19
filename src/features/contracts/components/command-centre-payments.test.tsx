/**
 * The Payments tab's permission contract.
 *
 * The tab follows the same idiom as the rest of the Command Centre: a capability
 * is expressed by PASSING it in, and omitted when the viewer lacks the
 * permission. These tests pin that contract, because a control rendered for
 * someone who cannot use it is a 403 waiting to happen — and a control missing
 * for someone who can is a feature nobody finds.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { AgreementReconciliation, Contract, ContractPaymentHistoryRow } from "../types";

vi.mock("../hooks", () => ({
  useReverseContractPayment: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("./record-contract-payment-sheet", () => ({
  RecordContractPaymentSheet: () => null,
}));

import { PaymentsTab } from "./command-centre";

const RECON: AgreementReconciliation = {
  agreementId: "ag-structure",
  originalContractValuePaise: 600_000_000,
  amendmentDeltaPaise: 0,
  currentContractValuePaise: 600_000_000,
  earnedValueRawPaise: 0,
  earnedValuePaise: 0,
  earnedValueExcessPaise: 0,
  attendanceCreditPaise: 0,
  otherPaymentCreditPaise: 5_000_000,
  totalCreditedPaise: 5_000_000,
  currentDuePaise: 0,
  advanceCreditPaise: 5_000_000,
  remainingUnearnedPaise: 600_000_000,
  overallBalancePaise: 595_000_000,
  overCreditedPaise: 0,
  unsettledAttendancePaise: 0,
  milestoneCoveragePaise: 0,
  milestoneCoverageVariancePaise: -600_000_000,
  milestonesTotal: 0,
  milestonesCompleted: 0,
};

const CONTRACT: Contract = {
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
};

function payment(over: Partial<ContractPaymentHistoryRow> = {}): ContractPaymentHistoryRow {
  return {
    id: "pay-1",
    contractId: "ag-structure",
    contractorId: "c-pappu",
    projectId: "p-skyline",
    amountPaise: 5_000_000,
    type: "INTERIM",
    paymentMode: "BANK_TRANSFER",
    referenceNumber: null,
    date: "2026-03-01",
    notes: null,
    milestoneId: null,
    milestoneTitle: null,
    reversedAt: null,
    reversalReason: null,
    createdByName: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    projectName: "Skyline Tower",
    contractTitle: "Structure Labour Contract",
    ...over,
  };
}

const base = {
  settledAttendancePaise: 0,
  labourAdvanceOutstandingPaise: 0,
};

afterEach(cleanup);

describe("PaymentsTab — recording", () => {
  it("offers Record payment when the viewer may pay", () => {
    render(<PaymentsTab {...base} payments={[]} payableContracts={[CONTRACT]} />);
    expect(screen.getByRole("button", { name: /Record payment/ })).toBeTruthy();
  });

  it("offers nothing to a viewer without contracts.pay", () => {
    // The container omits `payableContracts` entirely for such a viewer.
    render(<PaymentsTab {...base} payments={[]} />);
    expect(screen.queryByRole("button", { name: /Record payment/ })).toBeNull();
  });
});

describe("PaymentsTab — reversing", () => {
  it("offers Reverse on a live payment when the viewer may reverse", () => {
    render(<PaymentsTab {...base} payments={[payment()]} onReversePayment={() => {}} />);
    expect(screen.getByRole("button", { name: "Reverse" })).toBeTruthy();
  });

  it("offers nothing to a viewer without contracts.pay_delete", () => {
    render(<PaymentsTab {...base} payments={[payment()]} />);
    expect(screen.queryByRole("button", { name: "Reverse" })).toBeNull();
  });

  it("never offers Reverse on an already-reversed payment, even with the permission", () => {
    render(
      <PaymentsTab
        {...base}
        payments={[
          payment({
            id: "pay-reversed",
            reversedAt: "2026-03-05T00:00:00.000Z",
            reversalReason: "Recorded against the wrong agreement",
          }),
        ]}
        onReversePayment={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "Reverse" })).toBeNull();
    // It stays visible for audit, with its reason.
    expect(screen.getByText(/Recorded against the wrong agreement/)).toBeTruthy();
  });

  it("keeps a reversed payment out of the live list and in the Reversals group", () => {
    render(
      <PaymentsTab
        {...base}
        payments={[payment({ id: "live" }), payment({ id: "dead", reversedAt: "2026-03-05T00:00:00.000Z" })]}
        onReversePayment={() => {}}
      />,
    );
    expect(screen.getByText("Reversals")).toBeTruthy();
    // Exactly one live payment, so exactly one Reverse control.
    expect(screen.getAllByRole("button", { name: "Reverse" })).toHaveLength(1);
  });
});
