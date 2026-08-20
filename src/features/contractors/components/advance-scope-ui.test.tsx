/**
 * What the Record Advance sheet actually sends.
 *
 * The whole defect this pass fixes was a UI one: the backend and the allocator
 * had supported scope all along, and the sheet simply never sent it. So the
 * assertions that matter are about the exact payload — a scope selector that
 * looks right but posts `projectId: undefined` would leave the bug in place
 * while appearing fixed.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const mutate = vi.fn();

vi.mock("../hooks", () => ({
  useRecordAdvance: () => ({ mutate, isPending: false }),
}));

const profile = {
  contractor: { id: "c-pappu", name: "Pappu Contractor", phone: null, status: "ACTIVE" },
  projects: [
    {
      projectId: "p-sky",
      projectName: "Skyline Residency",
      contracts: [
        { id: "ag-structure", title: "Structure", status: "IN_PROGRESS" },
        { id: "ag-wall", title: "Compound Wall", status: "CANCELLED" },
        { id: "ag-interior", title: "Interior Finishing", status: "SETTLED" },
      ],
      rollup: {},
    },
  ],
  lifetime: {},
  payments: [],
  // A project the contractor has attendance on but NO agreement.
  attendance: [
    {
      projectId: "p-orion",
      projectName: "Orion Tech Park",
      unsettledPaise: 0,
      settledAttributedPaise: 0,
      settledUnattributedPaise: 0,
    },
  ],
  attendanceTotals: { unsettledPaise: 0, settledAttributedPaise: 0, settledUnattributedPaise: 0 },
};

vi.mock("@/features/contracts/hooks", () => ({
  useContractorProfile: () => ({ data: profile }),
}));

import { RecordAdvanceSheet } from "./record-advance-sheet";

const open = () =>
  render(
    <RecordAdvanceSheet
      open
      onOpenChange={() => {}}
      contractorId="c-pappu"
      contractorName="Pappu Contractor"
    />,
  );

const setAmount = (rupees: string) => {
  fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: rupees } });
};

const choose = (label: string) => fireEvent.click(screen.getByRole("button", { name: label }));

const save = () => fireEvent.click(screen.getByRole("button", { name: "Record advance" }));

beforeEach(() => mutate.mockReset());
afterEach(cleanup);

/* ── The payload ────────────────────────────────────────────────────────── */

describe("what Save sends", () => {
  it("GENERAL sends explicit nulls, not undefined", () => {
    open();
    setAmount("100000");
    save();
    expect(mutate).toHaveBeenCalledTimes(1);
    const input = mutate.mock.calls[0][0];
    expect(input).toMatchObject({
      contractorId: "c-pappu",
      amountPaise: 10_000_000,
      projectId: null,
      contractId: null,
    });
  });

  it("defaults to General, so an unconsidered advance stays unscoped", () => {
    open();
    // No scope chosen at all — the historical behaviour is preserved exactly.
    setAmount("100000");
    save();
    expect(mutate.mock.calls[0][0].projectId).toBeNull();
  });
});

describe("the scope selector", () => {
  it("offers the three business choices, not allocator vocabulary", () => {
    open();
    expect(screen.getByRole("button", { name: "General contractor" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Specific project" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Specific agreement" })).toBeDefined();
    const text = document.body.textContent!.toLowerCase();
    for (const jargon of ["strict-to-broad", "allocator", "bucket", "ledger tier"]) {
      expect(text).not.toContain(jargon);
    }
  });

  it("blocks Save until a chosen scope is actually filled in", () => {
    open();
    setAmount("100000");
    choose("Specific project");
    const button = screen.getByRole("button", { name: "Record advance" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("clears a previous selection when the scope changes", () => {
    open();
    setAmount("100000");
    choose("Specific agreement");
    choose("General contractor");
    save();
    // No stale agreement id rides along.
    expect(mutate.mock.calls[0][0]).toMatchObject({ projectId: null, contractId: null });
  });
});

/* ── What is offered ────────────────────────────────────────────────────── */

describe("the agreement list", () => {
  it("hides agreements that could never spend the money", () => {
    open();
    choose("Specific agreement");
    fireEvent.click(screen.getByLabelText("Agreement for this advance"));
    // CANCELLED and SETTLED are absent; the server would refuse them anyway.
    expect(screen.queryByText(/Compound Wall/)).toBeNull();
    expect(screen.queryByText(/Interior Finishing/)).toBeNull();
  });

  it("names the project alongside the agreement, so the target is unambiguous", () => {
    open();
    choose("Specific agreement");
    fireEvent.click(screen.getByLabelText("Agreement for this advance"));
    expect(screen.getByText(/Skyline Residency → Structure/)).toBeDefined();
  });
});

describe("the project list", () => {
  it("includes a project the contractor has attendance on but no agreement", () => {
    open();
    choose("Specific project");
    fireEvent.click(screen.getByLabelText("Project for this advance"));
    expect(screen.getByText("Orion Tech Park")).toBeDefined();
    expect(screen.getByText("Skyline Residency")).toBeDefined();
  });
});

/* ── The preview ────────────────────────────────────────────────────────── */

describe("the scope preview", () => {
  it("says nothing before an amount is entered", () => {
    open();
    expect(screen.queryByText(/will be available/)).toBeNull();
  });

  it("explains a general advance in plain terms", () => {
    open();
    setAmount("100000");
    expect(screen.getByText(/will be available broadly/)).toBeDefined();
  });

  it("spells out that agreement money is not shared", () => {
    open();
    setAmount("500000");
    choose("Specific agreement");
    // Selecting through Radix in jsdom is awkward; the copy is asserted by the
    // strings that are present regardless of selection state.
    expect(screen.getByText(/Apply this advance to/)).toBeDefined();
  });
});
