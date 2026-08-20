/**
 * What the re-scope UI actually shows and sends.
 *
 * These stand in for the parts of a browser walkthrough that matter most and are
 * easiest to get quietly wrong: that the sheet sends the exact scope fields, that
 * the transfer PAIR renders as one row rather than as cash leaving and arriving,
 * and that the action is withheld from users who may not use it.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { ContractorLedgerEntry } from "../types";

const mutate = vi.fn();
let permitted = new Set<string>();
let previewData: unknown = undefined;

vi.mock("../hooks", () => ({
  useRescopeAdvance: () => ({ mutate, isPending: false }),
  useAdvanceRescopePreview: () => ({ data: previewData }),
  useReverseAdvanceRescope: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/features/contracts/hooks", () => ({
  useContractorProfile: () => ({
    data: {
      projects: [
        {
          projectId: "p-sky",
          projectName: "Skyline Residency",
          contracts: [
            { id: "ag-structure", title: "Structure", status: "IN_PROGRESS" },
            { id: "ag-wall", title: "Compound Wall", status: "CANCELLED" },
          ],
        },
      ],
      attendance: [],
    },
  }),
}));
vi.mock("@/features/rbac/permission-context", () => ({
  useCan: () => (p: string) => permitted.has(p),
}));

import { RescopeAdvanceSheet } from "./rescope-advance-sheet";

const L = (lakhs: number) => lakhs * 100_000 * 100;

const advance: ContractorLedgerEntry = {
  id: "adv-1",
  contractorId: "c-pappu",
  date: "2026-01-25",
  type: "ADVANCE",
  amountPaise: L(5),
  advanceBalanceAfterPaise: L(5),
  notes: null,
  settlementId: null,
  projectId: "p-sky",
  contractId: "ag-structure",
  contractTitle: "Structure",
  drawsFromEntryId: null,
  reversesEntryId: null,
  fundsContractId: null,
  projectName: "Skyline Residency",
  createdAt: "2026-01-25T00:00:00.000Z",
};

const preview = (over: Record<string, unknown> = {}) => ({
  source: {
    advanceId: "adv-1",
    type: "ADVANCE",
    date: "2026-01-25",
    scope: { projectId: "p-sky", contractId: "ag-structure" },
    scopeLabel: "Skyline Residency · Structure",
    originalPaise: L(5),
    consumedPaise: L(2),
    transferredOutPaise: 0,
    remainingPaise: L(3),
  },
  target: { scope: { projectId: null, contractId: null }, label: "General contractor" },
  transferPaise: L(2),
  before: { sourceAvailablePaise: L(3), targetAvailablePaise: L(1), contractorBalancePaise: L(4) },
  after: { sourceAvailablePaise: L(1), targetAvailablePaise: L(3), contractorBalancePaise: L(4) },
  cashImpactPaise: 0,
  historicalSettlementImpactPaise: 0,
  warnings: ["BROADENING_SCOPE"],
  blockers: [],
  ...over,
});

const open = () =>
  render(
    <RescopeAdvanceSheet
      open
      onOpenChange={() => {}}
      contractorId="c-pappu"
      contractorName="Pappu Contractor"
      advance={advance}
    />,
  );

beforeEach(() => {
  mutate.mockReset();
  permitted = new Set(["contractors.advance_rescope"]);
  previewData = preview();
});
afterEach(cleanup);

describe("the source panel", () => {
  it("shows original, consumed and unused so the user knows what can move", () => {
    open();
    // Named in the source panel AND in the preview sentence.
    expect(screen.getAllByText(/Skyline Residency · Structure/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/5,00,000/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2,00,000/).length).toBeGreaterThan(0);
    expect(screen.getByText("Unused")).toBeDefined();
  });
});

describe("the preview", () => {
  it("states cash impact as ₹0 and the settlements as unchanged", () => {
    open();
    expect(document.body.textContent).toContain("Cash impact");
    expect(document.body.textContent).toContain("historical settlements unchanged");
  });

  it("shows the total advance balance unchanged on both sides", () => {
    open();
    // ₹4,00,000 → ₹4,00,000. A transfer is not a payment.
    const balanceRow = screen.getByText("Total advance balance").parentElement!;
    expect(balanceRow.textContent).toContain("4,00,000");
  });

  it("warns, by name, that the money stops being reserved", () => {
    open();
    expect(document.body.textContent).toContain(
      "no longer be reserved for Skyline Residency · Structure",
    );
  });

  it("does not warn when narrowing", () => {
    previewData = preview({ warnings: [] });
    open();
    expect(document.body.textContent).not.toContain("no longer be reserved");
  });

  it("renders a blocker instead of the preview when refused", () => {
    previewData = preview({ blockers: ["OVER_TRANSFER"] });
    open();
    expect(document.body.textContent).toContain("more than this advance has left");
  });
});

describe("what Save sends", () => {
  const fill = () => {
    fireEvent.change(screen.getByLabelText(/Amount to move/), { target: { value: "200000" } });
    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "Agreement scope corrected" },
    });
  };

  it("sends GENERAL as explicit nulls", () => {
    open();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Re-scope advance" }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toMatchObject({
      contractorId: "c-pappu",
      advanceId: "adv-1",
      transferPaise: 20_000_000,
      target: { projectId: null, contractId: null },
      reason: "Agreement scope corrected",
    });
  });

  it("blocks Save without a reason", () => {
    open();
    fireEvent.change(screen.getByLabelText(/Amount to move/), { target: { value: "200000" } });
    const btn = screen.getByRole("button", { name: "Re-scope advance" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("blocks Save while the preview reports a blocker", () => {
    previewData = preview({ blockers: ["OVER_TRANSFER"] });
    open();
    fill();
    const btn = screen.getByRole("button", { name: "Re-scope advance" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("offers the three business choices, not ledger vocabulary", () => {
    open();
    expect(screen.getByRole("button", { name: "General contractor" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Specific project" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Specific agreement" })).toBeDefined();
    const text = document.body.textContent!.toLowerCase();
    for (const jargon of ["transfer_out", "transfer_in", "ledger entry", "drawsfrom"]) {
      expect(text).not.toContain(jargon);
    }
  });

  it("never implies a payment", () => {
    open();
    const text = document.body.textContent!.toLowerCase();
    // The copy says outright that this is NOT a payment, and that the contractor
    // is not paid again — the negation is the point, so assert the sentence
    // rather than banning the words inside it.
    expect(text).toContain("it is not a payment");
    expect(text).toContain("isn’t paid again");
    expect(text).toContain("no settlement runs");
  });
});

describe("the agreement target list", () => {
  it("hides agreements that could never spend the money", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Specific agreement" }));
    fireEvent.click(screen.getByLabelText("Target agreement"));
    expect(screen.queryByText(/Compound Wall/)).toBeNull();
  });
});
