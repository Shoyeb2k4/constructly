/**
 * The Add / Edit material form.
 *
 * What matters here is what leaves the form: the exact fields the server
 * accepts, nothing more, and with "not set" expressed as null rather than an
 * empty string. The validation rules themselves are the server's (see
 * server/material-master-enforcement.test.ts); the form only has to agree.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { UNITS } from "../constants";
import type { Material } from "../types";

const h = vi.hoisted(() => ({
  categories: ["Cement", "Steel", "Sand & Aggregate"],
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock("../hooks", () => ({
  useMaterialCategories: () => ({ data: h.categories }),
  useMaterialMutations: () => ({
    create: { mutateAsync: h.create, isPending: false },
    update: { mutateAsync: h.update, isPending: false },
    setArchived: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

import { MaterialSheet } from "./material-sheet";

const material = (over: Partial<Material> = {}): Material => ({
  id: "m1",
  name: "Cement",
  category: "Cement",
  defaultUnit: "bag",
  hsnCode: "25232910",
  displayOrder: 0,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

const nameField = () => screen.getByPlaceholderText("OPC 53 Grade Cement");
const hsnField = () => screen.getByPlaceholderText("25232910");

beforeEach(() => {
  h.create.mockReset().mockResolvedValue(material());
  h.update.mockReset().mockResolvedValue(material());
  h.categories = ["Cement", "Steel", "Sand & Aggregate"];
});
afterEach(cleanup);

describe("adding a material", () => {
  it("submits the name, with unset optional fields as null", async () => {
    render(<MaterialSheet open onOpenChange={() => {}} />);
    fireEvent.change(nameField(), { target: { value: "  OPC 53 Grade Cement  " } });
    fireEvent.click(screen.getByRole("button", { name: /^Add material$/i }));

    await waitFor(() => expect(h.create).toHaveBeenCalled());
    expect(h.create.mock.calls[0][0]).toEqual({
      name: "OPC 53 Grade Cement", // trimmed
      category: null,
      defaultUnit: null,
      hsnCode: null,
    });
  });

  it("will not submit without a name", async () => {
    render(<MaterialSheet open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^Add material$/i }));
    await waitFor(() => expect(screen.getByText(/Enter a material name/i)).toBeTruthy());
    expect(h.create).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric HSN code before it reaches the server", async () => {
    render(<MaterialSheet open onOpenChange={() => {}} />);
    fireEvent.change(nameField(), { target: { value: "Cement" } });
    fireEvent.change(hsnField(), { target: { value: "ABC123" } });
    fireEvent.click(screen.getByRole("button", { name: /^Add material$/i }));

    await waitFor(() => expect(screen.getByText(/Digits only/i)).toBeTruthy());
    expect(h.create).not.toHaveBeenCalled();
  });

  it("explains what a material is, not what a category is", () => {
    render(<MaterialSheet open onOpenChange={() => {}} />);
    expect(screen.getByText(/e\.g\. OPC 53 Grade Cement/i)).toBeTruthy();
    expect(screen.getByText(/Categories group materials/i)).toBeTruthy();
  });
});

describe("the pickers offer the canonical options", () => {
  it("shows the company's categories, from the shared category source", () => {
    // The trigger displays the current value, which is how the selected option
    // is observable — Radix renders its list only once opened, and jsdom cannot
    // open it (hasPointerCapture).
    render(<MaterialSheet open onOpenChange={() => {}} material={material({ category: "Steel" })} />);
    expect(screen.getByLabelText("Category").textContent).toContain("Steel");
  });

  it("keeps a category Settings has since dropped selectable, so the record stays editable", () => {
    h.categories = ["Cement", "Steel"]; // "Retired" is no longer offered
    render(<MaterialSheet open onOpenChange={() => {}} material={material({ category: "Retired" })} />);
    // It is still the selected value rather than being silently blanked — which
    // would quietly rewrite the material's category on the next save.
    expect(screen.getByLabelText("Category").textContent).toContain("Retired");
  });

  it("shows a unit from the canonical UNITS list", () => {
    const unit = UNITS[1];
    render(<MaterialSheet open onOpenChange={() => {}} material={material({ defaultUnit: unit })} />);
    expect(screen.getByLabelText("Default unit").textContent).toContain(unit);
  });

  it("says so when nothing is set, rather than showing an empty control", () => {
    render(
      <MaterialSheet
        open
        onOpenChange={() => {}}
        material={material({ category: null, defaultUnit: null })}
      />,
    );
    expect(screen.getByLabelText("Category").textContent).toContain("No category");
    expect(screen.getByLabelText("Default unit").textContent).toContain("No unit");
  });
});

describe("editing a material", () => {
  it("seeds the form from the material", () => {
    render(<MaterialSheet open onOpenChange={() => {}} material={material()} />);
    expect((nameField() as HTMLInputElement).value).toBe("Cement");
    expect((hsnField() as HTMLInputElement).value).toBe("25232910");
  });

  it("tells the user that existing purchase orders keep their recorded name", () => {
    render(<MaterialSheet open onOpenChange={() => {}} material={material()} />);
    expect(
      screen.getByText(/Existing purchase orders keep the material name recorded/i),
    ).toBeTruthy();
  });

  it("submits only the four supported fields, and nothing else", async () => {
    render(<MaterialSheet open onOpenChange={() => {}} material={material()} />);
    fireEvent.change(nameField(), { target: { value: "OPC 53 Cement" } });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() => expect(h.update).toHaveBeenCalled());
    const [id, patch] = h.update.mock.calls[0][0]
      ? [h.update.mock.calls[0][0].id, h.update.mock.calls[0][0].patch]
      : [];
    expect(id).toBe("m1");
    // No id, no isActive, no displayOrder, no timestamps — a rename must not be
    // able to carry lifecycle or ordering changes with it.
    expect(Object.keys(patch).sort()).toEqual(["category", "defaultUnit", "hsnCode", "name"]);
    expect(patch.name).toBe("OPC 53 Cement");
  });

  it("renames the master only — it never asks for a purchase order write", async () => {
    render(<MaterialSheet open onOpenChange={() => {}} material={material()} />);
    fireEvent.change(nameField(), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1));
    // The update mutation is the only call the form makes; there is no PO
    // mutation in this component's reach at all.
    expect(h.create).not.toHaveBeenCalled();
  });
});
