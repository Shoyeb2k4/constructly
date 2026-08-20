/**
 * What the Command Centre actually shows for unattributed labour.
 *
 * These exist because the previous defect was invisible to every other kind of
 * test: the server was right, the engine was right, and the UI passed a literal
 * zero over the top of both. So the assertions here are about what a reader
 * SEES, and about the wording — a figure like this is easy to describe in a way
 * that sends someone hunting for a payment that was never missing.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { ContractorProfile } from "../types";

vi.mock("../hooks", () => ({
  useContract: () => ({ data: undefined }),
  useRateRevisions: () => ({ data: [] }),
  useSetScopeRate: () => ({ mutate: vi.fn(), isPending: false }),
  useScopeItems: () => ({ data: [], isLoading: false }),
  useAddScopeItem: () => ({ mutateAsync: vi.fn() }),
  useRemoveScopeItem: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/features/rbac/permission-context", () => ({ useCan: () => () => true }));

import { UnattributedBanner, UnattributedBreakdown, ReconciliationTab } from "./command-centre";

const profile = (over: Partial<ContractorProfile> = {}): ContractorProfile =>
  ({
    contractor: { id: "c-pappu", name: "Pappu Contractor", phone: null, status: "ACTIVE" },
    projects: [],
    lifetime: {} as never,
    payments: [],
    attendance: [],
    attendanceTotals: {
      unsettledPaise: 0,
      settledAttributedPaise: 0,
      settledUnattributedPaise: 0,
    },
    ...over,
  }) as ContractorProfile;

const withUnattributed = profile({
  attendance: [
    {
      projectId: "p-sky",
      projectName: "Skyline Residency",
      unsettledPaise: 0,
      settledAttributedPaise: 40_000_000, // ₹4,00,000
      settledUnattributedPaise: 20_000_000, // ₹2,00,000
    },
  ],
  attendanceTotals: {
    unsettledPaise: 0,
    settledAttributedPaise: 40_000_000,
    settledUnattributedPaise: 20_000_000,
  },
});

afterEach(cleanup);

describe("the zero state", () => {
  it("shows NOTHING — a permanent ₹0 notice trains people to ignore the banner", () => {
    const { container } = render(<UnattributedBanner paise={0} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows no breakdown either", () => {
    const { container } = render(<UnattributedBreakdown profile={profile()} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("the non-zero state", () => {
  it("names the amount", () => {
    render(<UnattributedBanner paise={20_000_000} />);
    expect(screen.getByText(/2,00,000/)).toBeDefined();
  });

  it("says the agreement figures EXCLUDE it", () => {
    render(<UnattributedBanner paise={20_000_000} />);
    expect(screen.getByText(/exclude/i)).toBeDefined();
    expect(screen.getByText(/not attributed to an agreement/i)).toBeDefined();
  });

  it("does not call it missing, lost or unallocated money", () => {
    const { container } = render(<UnattributedBanner paise={20_000_000} />);
    const text = container.textContent!.toLowerCase();
    for (const wrong of ["missing", "lost", "unallocated", "unpaid", "owed"]) {
      expect(text).not.toContain(wrong);
    }
    // It IS settled labour, and says so.
    expect(text).toContain("settled labour");
  });

  it("reads as a sentence — no words run together", () => {
    // Browser verification caught "settled labouris not attributed": JSX drops
    // the whitespace between an expression and a literal starting on the next
    // line. textContent is asserted rather than a regex over broken-up nodes.
    const { container } = render(<UnattributedBanner paise={20_000_000} />);
    expect(container.textContent).toContain("of settled labour is not attributed to an agreement");
  });

  it("still reads correctly WITH a project name", () => {
    const { container } = render(
      <UnattributedBanner paise={20_000_000} projectName="Skyline Residency" />,
    );
    expect(container.textContent).toContain(
      "of settled labour on Skyline Residency is not attributed to an agreement",
    );
  });

  it("names the project it belongs to when given one", () => {
    render(<UnattributedBanner paise={20_000_000} projectName="Skyline Residency" />);
    expect(screen.getByText(/Skyline Residency/)).toBeDefined();
  });
});

describe("the per-project breakdown", () => {
  it("lists only projects that actually have an unattributed amount", () => {
    const p = profile({
      attendance: [
        ...withUnattributed.attendance,
        {
          projectId: "p-orion",
          projectName: "Orion Tech Park",
          unsettledPaise: 0,
          settledAttributedPaise: 10_000_000,
          settledUnattributedPaise: 0, // nothing to report
        },
      ],
      attendanceTotals: withUnattributed.attendanceTotals,
    });
    render(<UnattributedBreakdown profile={p} />);
    expect(screen.getByText("Skyline Residency")).toBeDefined();
    expect(screen.queryByText("Orion Tech Park")).toBeNull();
  });

  it("shows attributed and unattributed side by side, so the split is legible", () => {
    render(<UnattributedBreakdown profile={withUnattributed} />);
    expect(screen.getByText(/4,00,000/)).toBeDefined();
    expect(screen.getByText(/2,00,000/)).toBeDefined();
  });

  it("says attribution is not done automatically", () => {
    render(<UnattributedBreakdown profile={withUnattributed} />);
    expect(screen.getByText(/nothing here is assigned automatically/i)).toBeDefined();
  });
});

describe("Reconciliation reads the real figure, not a hardcoded zero", () => {
  it("surfaces the amount even when the contractor has no agreements", () => {
    // The old code passed 0 here regardless; with no agreements it also bailed
    // to an empty state before rendering anything about labour.
    render(<ReconciliationTab profile={withUnattributed} />);
    expect(screen.getByText(/2,00,000/)).toBeDefined();
    expect(screen.getByText(/Nothing to reconcile/)).toBeDefined();
  });

  it("stays quiet when there is genuinely none", () => {
    render(<ReconciliationTab profile={profile()} />);
    expect(screen.queryByText(/not attributed to an agreement/i)).toBeNull();
  });
});
