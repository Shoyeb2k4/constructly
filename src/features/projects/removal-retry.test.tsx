/**
 * A blocked removal must be reported once, not retried.
 *
 * The app-wide default retries a failed mutation once (app/providers.tsx), which
 * is right for a transient server failure and wrong for a domain decision: the
 * dependency check ran twice and the explanation was delayed behind a retry the
 * outcome could never change. Found in the browser, where the refusal never
 * surfaced at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import type { ProjectContractorInput } from "./types";

const h = vi.hoisted(() => ({
  setProjectContractors: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("./data", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    projectsApi: { setProjectContractors: h.setProjectContractors },
  };
});
vi.mock("sonner", () => ({
  toast: { error: h.toastError, success: h.toastSuccess },
}));

import { useSetProjectContractors } from "./hooks";

const BLOCKER = {
  contractorId: "c-pappu",
  contractorName: "Pappu Contractor",
  agreements: [{ id: "ag-structure", title: "Structure", status: "IN_PROGRESS" as const }],
  attendanceCount: 0,
  settlementCount: 0,
};

/** Mirrors the real app: mutations retry once by default. */
function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: 1 }, queries: { retry: 1 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function Harness({ rows }: { rows: ProjectContractorInput[] }) {
  const save = useSetProjectContractors("p1", "Skyline Tower");
  return (
    <button onClick={() => save.mutate(rows)} data-testid="save">
      {save.isPending ? "Saving…" : "Save"}
    </button>
  );
}

beforeEach(() => {
  h.setProjectContractors.mockReset();
  h.toastError.mockReset();
  h.toastSuccess.mockReset();
});
afterEach(cleanup);

describe("a blocked removal", () => {
  beforeEach(() => {
    h.setProjectContractors.mockResolvedValue({ blockedRemovals: [BLOCKER] });
  });

  it("calls the server exactly once — no retry of a decision", async () => {
    render(<Harness rows={[]} />, { wrapper });
    screen.getByTestId("save").click();

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.setProjectContractors).toHaveBeenCalledTimes(1);
  });

  it("settles, so the form stops saying Saving…", async () => {
    render(<Harness rows={[]} />, { wrapper });
    screen.getByTestId("save").click();

    await waitFor(() => expect(screen.getByTestId("save").textContent).toBe("Save"));
  });

  it("shows the refusal, naming the contractor, project and agreement", async () => {
    render(<Harness rows={[]} />, { wrapper });
    screen.getByTestId("save").click();

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    const [message, options] = h.toastError.mock.calls[0];
    expect(message).toMatch(/Pappu Contractor can't be removed from Skyline Tower/);
    expect(message).toMatch(/"Structure" is still live/);
    expect(message).toMatch(/Nothing is deleted/);
    // A rule worth reading gets longer than the default dismissal.
    expect(options).toMatchObject({ duration: 10_000 });
  });

  it("never reports success", async () => {
    render(<Harness rows={[]} />, { wrapper });
    screen.getByTestId("save").click();
    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });
});

describe("a successful save", () => {
  it("reports success and does not surface a refusal", async () => {
    h.setProjectContractors.mockResolvedValue([]);
    render(<Harness rows={[]} />, { wrapper });
    screen.getByTestId("save").click();

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("Contractors updated"));
    expect(h.toastError).not.toHaveBeenCalled();
    expect(h.setProjectContractors).toHaveBeenCalledTimes(1);
  });
});
