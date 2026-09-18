/**
 * The single-select material picker on its own: what it offers for which
 * permissions, and that nothing is ever picked or created implicitly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import type { Permission } from "@/features/rbac/permissions";
import type { Material } from "../types";

const h = vi.hoisted(() => ({ permissions: new Set<string>(), sheetName: null as string | null }));
vi.mock("@/features/rbac/permission-context", () => ({
  useCan: () => (p: Permission) => h.permissions.has(p),
}));
// The Add-material form has its own tests; here it only reports its prefill.
vi.mock("./material-sheet", () => ({
  MaterialSheet: ({ defaultName }: { defaultName?: string }) => {
    h.sheetName = defaultName ?? "";
    return <div data-testid="material-sheet">{defaultName}</div>;
  },
}));

import { MaterialPickerSheet } from "./material-picker-sheet";

const m = (id: string, name: string, extra: Partial<Material> = {}): Material => ({
  id,
  name,
  category: null,
  defaultUnit: null,
  hsnCode: null,
  displayOrder: 0,
  isActive: true,
  createdAt: "",
  updatedAt: "",
  ...extra,
});
const MATERIALS = [m("c", "Cement", { category: "Cement", defaultUnit: "bag" }), m("s", "River Sand"), m("t", "TMT Steel")];

function renderPicker(opts: { usual?: string[]; selectedId?: string; onSelect?: (x: Material) => void } = {}) {
  return render(
    <MaterialPickerSheet
      open
      onOpenChange={() => {}}
      vendorName="ABC Traders"
      vendorMaterialIds={new Set(opts.usual ?? ["c"])}
      materials={MATERIALS}
      selectedId={opts.selectedId}
      onSelect={opts.onSelect ?? (() => {})}
    />,
  );
}
const group = (name: string) => within(screen.getByRole("region", { name }));
const search = (v: string) => fireEvent.change(screen.getByLabelText("Search materials"), { target: { value: v } });

beforeEach(() => {
  h.permissions = new Set(["purchase_orders.create"]);
  h.sheetName = null;
});
afterEach(cleanup);

describe("groups", () => {
  it("puts the vendor's usual materials under their own heading, the rest under Other", () => {
    renderPicker();
    expect(group("Supplied by ABC Traders").getByRole("button", { name: /^Cement/ })).toBeTruthy();
    expect(group("Other materials").getByRole("button", { name: /^River Sand/ })).toBeTruthy();
    expect(group("Other materials").queryByRole("button", { name: /^Cement/ })).toBeNull();
  });

  it("shows each option's category and unit, so similar names can be told apart", () => {
    renderPicker();
    expect(group("Supplied by ABC Traders").getByRole("button", { name: /Cement · bag/ })).toBeTruthy();
  });

  it("marks the line's current material", () => {
    renderPicker({ selectedId: "c" });
    expect(group("Supplied by ABC Traders").getByRole("button", { name: /^Cement/ }).getAttribute("aria-current")).toBe(
      "true",
    );
  });

  it("says so plainly when the vendor has no usual materials", () => {
    renderPicker({ usual: [] });
    expect(screen.getByText("No usual materials recorded for this vendor.")).toBeTruthy();
    expect(group("Other materials").getByRole("button", { name: /^Cement/ })).toBeTruthy();
  });

  it("choosing returns the whole material to the editor", () => {
    const onSelect = vi.fn();
    renderPicker({ onSelect });
    fireEvent.click(group("Other materials").getByRole("button", { name: /^TMT Steel/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "t", name: "TMT Steel" }));
  });
});

describe("nothing implicit", () => {
  it("Enter in the search neither picks nor creates", () => {
    h.permissions.add("materials.create");
    const onSelect = vi.fn();
    renderPicker({ onSelect });
    search("Waterproofing Chemical");
    fireEvent.keyDown(screen.getByLabelText("Search materials"), { key: "Enter" });
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByTestId("material-sheet")).toBeNull();
  });
});

describe("creating a missing material", () => {
  it("is offered, prefilled, to someone with materials.create", () => {
    h.permissions.add("materials.create");
    renderPicker();
    search("  Waterproofing Chemical ");
    fireEvent.click(screen.getByRole("button", { name: "Create “Waterproofing Chemical”" }));
    expect(h.sheetName).toBe("Waterproofing Chemical");
  });

  it("is not offered when a material already has exactly that name", () => {
    h.permissions.add("materials.create");
    renderPicker();
    search("cement");
    expect(screen.queryByRole("button", { name: /^Create/ })).toBeNull();
  });

  it("is never offered to a PO creator without materials.create — only a pointer", () => {
    renderPicker();
    search("Waterproofing Chemical");
    expect(screen.queryByRole("button", { name: /^Create/ })).toBeNull();
    expect(screen.getByText(/No matching material\. Ask someone with material management access/)).toBeTruthy();
  });
});
