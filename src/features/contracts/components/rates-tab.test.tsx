/**
 * The Rates tab's read/write contract.
 *
 * Same idiom as the rest of the Command Centre: history is visible to anyone who
 * can see the agreement, and the write action appears only when the viewer holds
 * the permission the server will actually demand (`contracts.edit`) AND the
 * agreement is in a state where a rate could still price something.
 *
 * A Revise button shown to someone who cannot use it is a 403 waiting to happen;
 * one missing for someone who can is a feature nobody finds.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { RateRevision, ScopeItem } from "../types";

let permitted = new Set<string>();
const revisions: RateRevision[] = [
  {
    id: "rev1",
    scopeItemId: "si-mason",
    ratePaise: 85_000,
    rateUnit: "day",
    effectiveFrom: "2026-01-10",
    reason: "Original agreement",
    createdByName: "Aarav Mehta",
    createdAt: "2026-01-10T00:00:00.000Z",
  },
  {
    id: "rev2",
    scopeItemId: "si-mason",
    ratePaise: 90_000,
    rateUnit: "day",
    effectiveFrom: "2026-04-01",
    reason: "Rate revision — project duration extension",
    createdByName: "Aarav Mehta",
    createdAt: "2026-03-25T00:00:00.000Z",
  },
];

vi.mock("@/features/rbac/permission-context", () => ({
  useCan: () => (p: string) => permitted.has(p),
}));
vi.mock("../hooks", () => ({
  useRateRevisions: () => ({ data: revisions }),
  useSetScopeRate: () => ({ mutate: vi.fn(), isPending: false }),
  useContract: () => ({ data: undefined }),
  useScopeItems: () => ({ data: [], isLoading: false }),
  useAddScopeItem: () => ({ mutateAsync: vi.fn() }),
  useRemoveScopeItem: () => ({ mutateAsync: vi.fn() }),
}));

import { ScopeItemRates } from "./command-centre-tabs";

const ITEM: ScopeItem = {
  id: "si-mason",
  contractId: "ag-structure",
  labourSubcategoryId: "sub-mason",
  subcategoryName: "Mason",
  categoryId: "cat-m",
  categoryName: "Mason",
  currentRatePaise: 90_000,
  rateUnit: "day",
  notes: null,
  createdAt: "2026-01-10T00:00:00.000Z",
};

// Only the fields ScopeItemRates and ReviseRateSheet actually read.
const CONTRACT = {
  id: "ag-structure",
  title: "Structure Labour Contract",
  projectName: "Skyline Residency",
  startDate: "2026-01-10",
  status: "IN_PROGRESS",
} as never;

afterEach(() => {
  cleanup();
  permitted = new Set();
});

describe("rate history is readable", () => {
  it("shows every band with its dates, rate and reason — no permission needed", () => {
    render(<ScopeItemRates item={ITEM} contract={CONTRACT} />);
    expect(screen.getByText(/Original agreement/)).toBeDefined();
    expect(screen.getByText(/project duration extension/)).toBeDefined();
    // The open-ended newest band reads as "current", not as an invented end date.
    expect(screen.getByText(/→ current/)).toBeDefined();
  });

  it("closes the earlier band the day before the next one starts", () => {
    render(<ScopeItemRates item={ITEM} contract={CONTRACT} />);
    // 1 Apr 2026 supersedes, so the 10 Jan band ends 31 Mar — derived, never stored.
    expect(screen.getByText(/31 Mar 2026/)).toBeDefined();
  });
});

describe("the Revise action", () => {
  it("is absent for a viewer who cannot edit", () => {
    permitted = new Set(["contracts.view"]);
    render(<ScopeItemRates item={ITEM} contract={CONTRACT} canRevise={false} />);
    expect(screen.queryByRole("button", { name: /revise rate/i })).toBeNull();
    // …but the history is still fully there.
    expect(screen.getByText(/Original agreement/)).toBeDefined();
  });

  it("is offered to an editor", () => {
    permitted = new Set(["contracts.view", "contracts.edit"]);
    render(<ScopeItemRates item={ITEM} contract={CONTRACT} canRevise />);
    expect(screen.getByRole("button", { name: /revise rate/i })).toBeDefined();
  });
});

describe("the revision preview names the band it actually closes", () => {
  /**
   * A regression from the browser walkthrough: proposing ₹950 from 1 Jul with
   * bands [10 Jan → 31 Mar ₹850] and [1 Apr → current ₹900] named the ₹850 band
   * as the one being closed off. Bands are ordered oldest first, so the
   * IMMEDIATELY preceding one is the LAST that ends before the new one starts.
   */
  it("picks the immediately preceding band, not the oldest", async () => {
    const { rateBands } = await import("../rates");
    const projected = rateBands([
      ...revisions,
      {
        id: "__proposed__",
        scopeItemId: "si-mason",
        ratePaise: 95_000,
        rateUnit: "day",
        effectiveFrom: "2026-07-01",
        reason: "Annual rate revision",
        createdByName: null,
        createdAt: new Date(8.64e15).toISOString(),
      },
    ]);
    const proposed = projected.find((b) => b.revisionId === "__proposed__")!;
    const before = projected
      .filter((b) => b.toDate != null && b.toDate < proposed.fromDate)
      .at(-1)!;

    expect(before.ratePaise).toBe(90_000); // ₹900, not the ₹850 two bands back
    expect(before.toDate).toBe("2026-06-30");
  });
});

describe("a scheduled future rate", () => {
  it("is shown separately and does NOT claim to be today's rate", () => {
    revisions.push({
      id: "rev3",
      scopeItemId: "si-mason",
      ratePaise: 95_000,
      rateUnit: "day",
      effectiveFrom: "2099-09-01",
      reason: "Agreed uplift",
      createdByName: "Aarav Mehta",
      createdAt: "2026-08-19T00:00:00.000Z",
    });
    try {
      render(<ScopeItemRates item={ITEM} contract={CONTRACT} />);
      // The header still reads the server-computed rate in force TODAY.
      expect(screen.getByText(/\/day today/)).toBeDefined();
      // The future band is labelled as scheduled, not as current.
      expect(screen.getByText(/→ scheduled/)).toBeDefined();
      expect(screen.getByText(/Agreed uplift/)).toBeDefined();
    } finally {
      revisions.pop();
    }
  });
});
