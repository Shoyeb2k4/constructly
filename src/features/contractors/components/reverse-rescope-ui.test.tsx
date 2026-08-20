/**
 * What the re-scope REVERSAL dialog shows, sends, and refuses.
 *
 * This closed the last Contractor workflow gap: `reverseAdvanceRescope` existed
 * across the server, the demo store and a hook with no UI to reach it. These
 * cover the claims a reader of the dialog is entitled to rely on — that no cash
 * moves, that a reason is mandatory, that the exact transfer id is sent, and
 * that a server refusal is shown rather than swallowed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import type { ContractorLedgerEntry } from "../types";

const mutate = vi.fn();

vi.mock("../hooks", () => ({
  useReverseAdvanceRescope: () => ({ mutate, isPending: false }),
}));

import { ReverseRescopeDialog } from "./reverse-rescope-dialog";

const L = (lakhs: number) => lakhs * 100_000 * 100;

const transfer: ContractorLedgerEntry = {
  id: "xfer-1",
  contractorId: "c-pappu",
  date: "2026-08-19",
  type: "SCOPE_TRANSFER_OUT",
  amountPaise: L(2),
  advanceBalanceAfterPaise: L(5),
  notes: "Re-scoped to General contractor",
  settlementId: null,
  projectId: "p-sky",
  contractId: "ag-structure",
  contractTitle: "Structure",
  projectName: "Skyline Residency",
  drawsFromEntryId: "adv-1",
  reversesEntryId: null,
  fundsContractId: null,
  createdAt: "2026-08-19T00:00:00.000Z",
};

function open() {
  render(
    <ReverseRescopeDialog
      transfer={transfer}
      fromLabel="Skyline Residency · Structure"
      toLabel="General contractor advance"
      onOpenChange={() => {}}
    />,
  );
}

beforeEach(() => mutate.mockReset());
afterEach(cleanup);

describe("reverse re-scope dialog", () => {
  it("names both ends of the move it is undoing", () => {
    open();
    // Both ends appear more than once — in the summary line and in the callout
    // that says which way availability travels.
    expect(screen.getAllByText(/Skyline Residency · Structure/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/General contractor advance/).length).toBeGreaterThan(0);
  });

  it("states that no cash moves and the balance is unchanged", () => {
    open();
    // The claim the whole feature rests on. A reader watching ₹2,00,000 move
    // between scopes must be told the contractor was not paid again.
    expect(screen.getByText("₹0")).toBeDefined();
    expect(screen.getByText("unchanged")).toBeDefined();
    expect(screen.getByText(/Cash impact/)).toBeDefined();
  });

  it("refuses to submit without a reason", () => {
    open();
    const confirm = screen.getByRole("button", { name: /Reverse re-scope/ });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(confirm);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("sends the transfer id and the trimmed reason", () => {
    open();
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "  Re-scoped in error  " } });
    fireEvent.click(screen.getByRole("button", { name: /Reverse re-scope/ }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({
      transferId: "xfer-1",
      reason: "Re-scoped in error",
    });
  });

  it("shows the server's refusal instead of closing", () => {
    open();
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /Reverse re-scope/ }));

    // The server answers a refusal as DATA, not as a thrown error — so the
    // dialog has to render it rather than assume success.
    const [, opts] = mutate.mock.calls[0];
    act(() => opts.onSuccess({ blockers: ["TRANSFER_ALREADY_CONSUMED"] }));

    expect(screen.getByText(/can't be reversed/i)).toBeDefined();
  });

  it("never offers a partial unwind", () => {
    open();
    // Deciding WHICH half of the money came back would be the UI making a
    // financial judgement. There is no amount field, by design.
    expect(screen.queryByLabelText(/amount/i)).toBeNull();
  });

  it("labels the reason field, rather than relying on its placeholder", () => {
    open();
    expect(screen.getByLabelText(/Reason/)).toBeDefined();
  });
});
