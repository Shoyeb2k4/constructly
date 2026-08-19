/**
 * Two sheet groups can legitimately belong to the SAME contractor.
 *
 * `buildSheet` emits a configured group (their current labour types and
 * agreements) and, separately, a synthesized historical group holding rows
 * recorded against a contractor/type/agreement combination since de-configured.
 * Both carry the same `contractorId`.
 *
 * Keying React on `contractorId` alone therefore collided. React logged "two
 * children with the same key", and a key collision is not cosmetic on an
 * attendance sheet: React may reuse, omit or duplicate the wrong subtree, so a
 * headcount can appear against the wrong contractor's row. The collapse state
 * used the same key, so collapsing one group closed both.
 *
 * These pin the composite identity and the behaviour that depends on it.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import type { AttendanceSheet, SheetGroup } from "../../types";
import { groupKey } from "../../calc";

const PAPPU = "c-pappu";
const PROJECT = "p-skyline";

const setQuantity = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/labor",
  useSearchParams: () => new URLSearchParams(`project=${PROJECT}`),
}));
// The offline sync module registers listeners on import; not this test's subject.
vi.mock("../../sync", () => ({}));
vi.mock("@/features/projects/hooks", () => ({
  useProjects: () => ({
    data: [{ id: PROJECT, name: "Skyline Residency", status: "ACTIVE" }],
    isLoading: false,
  }),
}));
vi.mock("@/features/rbac/permission-context", () => ({
  useCan: () => () => true,
}));
vi.mock("../../hooks", () => ({
  useAttendanceSheet: () => ({ data: sheet, isLoading: false }),
  useSetQuantity: () => ({ mutate: setQuantity, isPending: false }),
  useCopyPreviousDay: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { AttendanceView } from "./attendance-view";

const row = (subcategoryId: string, name: string, quantity: number) => ({
  subcategoryId,
  name,
  categoryId: "cat-m",
  categoryName: "Mason",
  contractId: null,
  agreementTitle: null,
  dailyRatePaise: 90_000,
  quantity,
  notes: null,
});

/** Pappu as he is configured today. */
const configured: SheetGroup = {
  contractorId: PAPPU,
  contractorName: "Pappu Contractor",
  contractRatePaise: null,
  contractRateUnit: null,
  configured: true,
  archived: false,
  agreements: [],
  requiresAgreementChoice: false,
  rows: [row("sub-mason", "Mason", 6)],
  totalPresent: 6,
  estimatedCostPaise: 540_000,
};

/** The same contractor's rows against a labour type since de-configured. */
const historical: SheetGroup = {
  ...configured,
  configured: false,
  rows: [row("sub-painter", "Painter", 2)],
  totalPresent: 2,
  estimatedCostPaise: 180_000,
};

let sheet: AttendanceSheet;

beforeEach(() => {
  setQuantity.mockReset();
  sheet = {
    projectId: PROJECT,
    date: "2026-08-19",
    groups: [configured, historical],
    totalPresent: 8,
    estimatedCostPaise: 720_000,
  };
});
afterEach(cleanup);

describe("groupKey", () => {
  it("separates a contractor's configured group from their historical one", () => {
    expect(groupKey(configured)).not.toBe(groupKey(historical));
  });

  it("is stable — it does not depend on position in the list", () => {
    // An index-based key would change the moment a group is inserted above.
    expect(groupKey(configured)).toBe(
      groupKey({ contractorId: configured.contractorId, configured: configured.configured }),
    );
  });

  it("still distinguishes two different contractors", () => {
    expect(groupKey(configured)).not.toBe(groupKey({ ...configured, contractorId: "c-ramesh" }));
  });

  it("gives the unattributed group a key of its own", () => {
    const k = groupKey({ contractorId: null, configured: false });
    expect(k).toContain("__unattributed__");
    expect(k).not.toBe(groupKey({ contractorId: null, configured: true }));
  });
});

describe("two groups for one contractor", () => {
  it("renders BOTH, and React logs no duplicate-key warning", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<AttendanceView />);

    expect(screen.getAllByText("Pappu Contractor")).toHaveLength(2);
    expect(
      spy.mock.calls.some((args) => args.some((a) => String(a).includes("same key"))),
    ).toBe(false);
    spy.mockRestore();
  });

  it("keeps their rows distinct — neither group absorbs the other's labour", () => {
    render(<AttendanceView />);
    expect(screen.getByText("Mason")).toBeDefined();
    expect(screen.getByText("Painter")).toBeDefined();
    // The historical group renders read-only rows; the configured one is editable.
    expect(screen.getByLabelText(/Mason present/)).toBeDefined();
    expect(screen.queryByLabelText(/Painter present/)).toBeNull();
  });

  it("collapsing one leaves the other open", () => {
    render(<AttendanceView />);
    const headers = screen.getAllByRole("button", { expanded: true });
    const first = headers.find((h) => h.textContent?.includes("Pappu Contractor"))!;
    fireEvent.click(first);

    // Exactly one collapsed, one still open — previously both closed together.
    expect(screen.queryAllByRole("button", { expanded: true })).toHaveLength(1);
    expect(screen.queryAllByRole("button", { expanded: false }).length).toBeGreaterThan(0);
  });

  it("editing the configured group targets ITS row, not the historical one", () => {
    render(<AttendanceView />);
    const input = screen.getByLabelText(/Mason present/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.blur(input);

    expect(setQuantity).toHaveBeenCalledTimes(1);
    expect(setQuantity.mock.calls[0][0]).toMatchObject({
      subcategoryId: "sub-mason",
      quantity: 7,
      contractorId: PAPPU,
    });
  });

  it("clearing the historical row targets the PAINTER row it belongs to", () => {
    render(<AttendanceView />);
    const painter = screen.getByText("Painter").closest("div")!;
    const clear = within(painter.parentElement!).getByRole("button", { name: /clear/i });
    fireEvent.click(clear);

    expect(setQuantity).toHaveBeenCalledTimes(1);
    expect(setQuantity.mock.calls[0][0]).toMatchObject({
      subcategoryId: "sub-painter",
      quantity: 0,
      contractorId: PAPPU,
    });
  });
});
