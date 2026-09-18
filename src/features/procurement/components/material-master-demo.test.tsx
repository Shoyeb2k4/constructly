/**
 * The Material Master end to end in DEMO MODE: the real view, the real hooks,
 * the real form, and the Pass 3 demo repository underneath. Nothing about the
 * data layer is stubbed.
 *
 * This is the configuration a reviewer actually clicks through, and it is also
 * the cheapest proof that the screen talks to `ProcurementRepository` rather
 * than to any one implementation of it — the server and HTTP repositories
 * satisfy the same contract.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Permission } from "@/features/rbac/permissions";
import { demoProcurementRepository } from "../demo/demo-repository";

const h = vi.hoisted(() => ({ permissions: new Set<string>() }));

vi.mock("@/features/rbac/permission-context", () => ({
  useCan: () => (p: Permission) => h.permissions.has(p),
}));

// Demo mode selects this repository in data.ts via `isDemoMode`; pointing the
// api at it directly is the same wiring without needing the env flag.
vi.mock("../data", async (orig) => {
  const mod = (await orig()) as Record<string, unknown>;
  const { demoProcurementRepository: demo } = await import("../demo/demo-repository");
  return { ...mod, procurementApi: demo };
});
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { MaterialMasterView } from "./material-master-view";

function renderView(permissions: Permission[]) {
  h.permissions = new Set(permissions);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: qc }, React.createElement(MaterialMasterView)),
  );
}

const ALL: Permission[] = [
  "materials.view",
  "materials.create",
  "materials.edit",
  "materials.archive",
];

function openRowMenu(name: string) {
  const trigger = screen.getAllByRole("button", { name: `Actions for ${name}` })[0];
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  return within(screen.getByRole("menu"));
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(cleanup);

describe("material master in demo mode", () => {
  it("lists the seeded catalogue", async () => {
    renderView(ALL);
    // Seeded from the demo vendors' own material lists (Pass 3).
    await waitFor(() => expect(screen.getAllByText("Cement").length).toBeGreaterThan(0));
    expect(screen.getAllByText("TMT Steel").length).toBeGreaterThan(0);
  });

  it("creates a material through the real form and shows it in the list", async () => {
    renderView(ALL);
    await waitFor(() => expect(screen.getByRole("table")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Add material/i }));
    fireEvent.change(screen.getByPlaceholderText("OPC 53 Grade Cement"), {
      target: { value: "Vitrified Tiles 600x600" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Add material$/i, hidden: false }));

    await waitFor(() =>
      expect(screen.getAllByText("Vitrified Tiles 600x600").length).toBeGreaterThan(0),
    );
    // It really reached the repository, not just React state.
    const stored = await demoProcurementRepository.listMaterialMaster({ search: "Vitrified" });
    expect(stored.map((m) => m.name)).toContain("Vitrified Tiles 600x600");
  });

  it("reports a duplicate name instead of creating a second one", async () => {
    const { toast } = await import("sonner");
    renderView(ALL);
    await waitFor(() => expect(screen.getByRole("table")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Add material/i }));
    // "Cement" is already seeded; casing must not matter.
    fireEvent.change(screen.getByPlaceholderText("OPC 53 Grade Cement"), {
      target: { value: "cement" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Add material$/i }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("A material with this name already exists."),
    );
  });

  it("searches through the repository", async () => {
    renderView(ALL);
    await waitFor(() => expect(screen.getByRole("table")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Search materials"), { target: { value: "steel" } });

    await waitFor(() => {
      const rows = within(screen.getByRole("table")).getAllByRole("row");
      // Header + at least one match, and nothing unrelated like Cement.
      expect(rows.length).toBeGreaterThan(1);
      expect(within(screen.getByRole("table")).queryByText("River Sand")).toBeNull();
    });
  });

  it("archives a material through the UI without deleting it", async () => {
    // NOTE: the status filter is a Radix Select, which cannot be opened under
    // jsdom (it calls hasPointerCapture). So this drives the archive itself end
    // to end and then asks the repository what happened, rather than navigating
    // to the Archived view. The Restore path is covered where each half lives:
    // the dialog's call in material-master-view.test.tsx, and the repository's
    // behaviour in demo/material-parity.test.ts.
    renderView(ALL);
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Actions for Cement" }).length).toBeGreaterThan(0),
    );

    fireEvent.click(openRowMenu("Cement").getByText("Archive"));
    fireEvent.click(screen.getByRole("button", { name: /Archive material/i }));

    // Gone from the active list. Matched on the row's own action control, since
    // "Cement" is also a CATEGORY on other rows.
    await waitFor(() =>
      expect(screen.queryAllByRole("button", { name: "Actions for Cement" })).toHaveLength(0),
    );

    // The repository kept the row — archived, not deleted.
    const all = await demoProcurementRepository.listMaterialMaster({ includeArchived: true });
    expect(all.find((m) => m.name === "Cement")?.isActive).toBe(false);
  });

  it("edits a material without touching any purchase order", async () => {
    const before = await demoProcurementRepository.listPurchaseOrders();
    const beforeDetail = await demoProcurementRepository.getPurchaseOrder(before[0].id);

    renderView(ALL);
    await waitFor(() => expect(screen.getAllByText("Cement").length).toBeGreaterThan(0));

    fireEvent.click(openRowMenu("Cement").getByText("Edit"));
    const nameInput = screen.getByPlaceholderText("OPC 53 Grade Cement") as HTMLInputElement;
    expect(nameInput.value).toBe("Cement");
    fireEvent.change(nameInput, { target: { value: "Cement (OPC)" } });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(async () => {
      const after = await demoProcurementRepository.listMaterialMaster({ search: "Cement (OPC)" });
      expect(after.length).toBe(1);
    });

    // The rename is master-only: every PO line keeps its recorded snapshot.
    const afterDetail = await demoProcurementRepository.getPurchaseOrder(before[0].id);
    expect(afterDetail!.lineItems.map((l) => l.material)).toEqual(
      beforeDetail!.lineItems.map((l) => l.material),
    );
  });

  it("gives a read-only user the list and nothing else", async () => {
    renderView(["materials.view"]);
    await waitFor(() => expect(screen.getByRole("table")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Add material/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Actions for/i })).toBeNull();
  });
});
