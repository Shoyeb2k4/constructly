/**
 * The ledger as a scoped user meets it.
 *
 * The headline must be the authoritative balance, the list must be whatever they
 * may inspect, and the gap between the two must be explained rather than left
 * looking like broken arithmetic. Nothing about a hidden entry may render.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Permission } from "@/features/rbac/permissions";
import type { ContractorLedger } from "../types";

const h = vi.hoisted(() => ({
  ledger: null as ContractorLedger | null,
  permissions: new Set<string>(["contractors.view"]),
}));

vi.mock("@/features/rbac/permission-context", () => ({
  useCan: () => (p: Permission) => h.permissions.has(p),
}));
vi.mock("../hooks", () => ({
  useContractorLedger: () => ({ data: h.ledger, isLoading: false }),
  useSettlements: () => ({ data: [] }),
  useReverseSettlement: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/features/contracts/hooks", () => ({
  useContractorProfile: () => ({ data: null }),
}));
// The sheets are exercised by their own tests; they must not fetch here.
vi.mock("./add-contractor-sheet", () => ({ AddContractorSheet: () => null }));
vi.mock("./record-advance-sheet", () => ({ RecordAdvanceSheet: () => null }));
vi.mock("./settlement-sheet", () => ({ SettlementSheet: () => null }));
vi.mock("@/features/contracts/components/contract-form-sheet", () => ({
  ContractFormSheet: () => null,
}));

import { ContractorDetailView } from "./contractor-detail-view";

const L = (lakhs: number) => lakhs * 100_000 * 100;

/** The brief's case: ₹5,00,000 hidden company-wide + ₹2,00,000 visible. */
function ledger(over: Partial<ContractorLedger> = {}): ContractorLedger {
  return {
    contractor: {
      id: "c-pappu",
      name: "Pappu Contractor",
      phone: null,
      status: "ACTIVE",
      openingAdvancePaise: 0,
      advanceBalancePaise: L(7),
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    entries: [
      {
        id: "l-skyline",
        contractorId: "c-pappu",
        date: "2026-01-20",
        type: "ADVANCE",
        amountPaise: L(2),
        advanceBalanceAfterPaise: L(2),
        notes: "Labour advance — Skyline",
        settlementId: null,
        projectId: "p-skyline",
        contractId: null,
        contractTitle: null,
        drawsFromEntryId: null,
        reversesEntryId: null,
        fundsContractId: null,
        projectName: "Skyline Tower",
        createdAt: "2026-01-20T00:00:00.000Z",
      },
    ],
    scope: "PROJECT" as const,
    isPartial: true,
    hiddenEntryCount: 1,
    ...over,
  };
}

beforeEach(() => {
  h.permissions = new Set(["contractors.view"]);
  h.ledger = ledger();
});
afterEach(cleanup);

const render1 = () => render(<ContractorDetailView contractorId="c-pappu" />);

describe("a scoped user with a partial ledger", () => {
  it("shows the scoped fold — the company-wide total is not theirs to see", () => {
    // POLICY B: `contractors.view` is project-scoped, and `view_all` is what
    // unlocks cross-project lifetime figures. The number shown is the fold of
    // the rows they may inspect, and it is labelled as exactly that.
    h.ledger = ledger({
      contractor: { ...ledger().contractor, advanceBalancePaise: L(2) },
    });
    render1();
    expect(screen.getByText("₹2,00,000")).toBeTruthy();
  });

  it("labels the figure as project-scoped, never as THE advance balance", () => {
    render1();
    expect(screen.getByText("Visible project advance balance")).toBeTruthy();
    expect(screen.queryByText("Advance balance")).toBeNull();
    expect(screen.getByText(/Across your projects only/i)).toBeTruthy();
  });

  it("renders only the entries it was given", () => {
    render1();
    // The ledger lives on its own tab; open it.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Advance ledger" }));
    fireEvent.click(screen.getByRole("tab", { name: "Advance ledger" }));
    const body = document.body.textContent!;
    // The visible row is there…
    expect(body).toMatch(/Labour advance — Skyline/);
    // …and nothing identifying the hidden one is.
    expect(body).not.toMatch(/l-company/);
  });
});

describe("a full-access user", () => {
  beforeEach(() => {
    h.ledger = ledger({
      contractor: { ...ledger().contractor, advanceBalancePaise: L(7) },
      scope: "COMPANY",
      isPartial: false,
      hiddenEntryCount: 0,
    });
  });

  it("is shown no partial-ledger caveat, and the plain label", () => {
    render1();
    expect(screen.getByText("Advance balance")).toBeTruthy();
    expect(screen.queryByText(/Across your projects only/i)).toBeNull();
    expect(screen.queryByText(/further entr/i)).toBeNull();
  });

  it("still shows the authoritative balance", () => {
    render1();
    expect(screen.getByText("₹7,00,000")).toBeTruthy();
  });
});
