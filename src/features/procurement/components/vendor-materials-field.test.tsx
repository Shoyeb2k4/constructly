/**
 * The vendor's "Materials supplied" picker.
 *
 * What it must guarantee, beyond looking right: only ACTIVE master materials
 * are ever offered; an archived material the vendor already has stays visible
 * and removable rather than vanishing; and typed text never turns into a
 * material except through an explicit, permission-gated "Create …".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import type { Permission } from "@/features/rbac/permissions";
import type { Material, VendorMaterialRef } from "../types";

const h = vi.hoisted(() => ({
  permissions: new Set<string>(),
  active: [] as Material[],
  isLoading: false,
  lastSheet: null as null | { defaultName?: string; onSaved?: (m: Material) => void },
}));

vi.mock("@/features/rbac/permission-context", () => ({
  useCan: () => (p: Permission) => h.permissions.has(p),
}));
vi.mock("../hooks", () => ({
  useMaterialMaster: () => ({ data: h.active, isLoading: h.isLoading }),
}));
// The Add-material form has its own tests. Here it only needs to show what it
// was opened with, and let the test "save" through the callback it was given.
vi.mock("./material-sheet", () => ({
  MaterialSheet: (props: { defaultName?: string; onSaved?: (m: Material) => void }) => {
    h.lastSheet = props;
    return <div data-testid="material-sheet">{props.defaultName}</div>;
  },
}));

import { VendorMaterialsField } from "./vendor-materials-field";

const m = (id: string, name: string): Material => ({
  id,
  name,
  category: null,
  defaultUnit: null,
  hsnCode: null,
  displayOrder: 0,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const CATALOGUE = [
  m("m-cement", "OPC 53 Cement"),
  m("m-steel", "TMT Steel 12mm"),
  m("m-sand", "River Sand"),
  m("m-agg", "Aggregate 20mm"),
];

/** A controlled harness, so the field is exercised the way a form drives it. */
function Harness({
  initial = [],
  existing,
  onChangeSpy,
}: {
  initial?: string[];
  existing?: VendorMaterialRef[];
  onChangeSpy?: (ids: string[]) => void;
}) {
  const [value, setValue] = React.useState(initial);
  return (
    <VendorMaterialsField
      value={value}
      onChange={(ids) => {
        onChangeSpy?.(ids);
        setValue(ids);
      }}
      existing={existing}
    />
  );
}

const search = () => screen.getByLabelText("Search materials");
const optionsGroup = () => within(screen.getByRole("group", { name: "Materials" }));
const selectedChips = () => screen.queryByRole("list", { name: "Selected materials" });

beforeEach(() => {
  h.permissions = new Set(["vendors.edit"]);
  h.active = CATALOGUE;
  h.isLoading = false;
  h.lastSheet = null;
});
afterEach(cleanup);

describe("offering materials", () => {
  it("lists every active Material Master material as an option", () => {
    render(<Harness />);
    for (const mat of CATALOGUE) {
      expect(optionsGroup().getByLabelText(mat.name)).toBeTruthy();
    }
  });

  it("narrows the options by name as the user searches", () => {
    render(<Harness />);
    fireEvent.change(search(), { target: { value: "steel" } });
    expect(optionsGroup().getByLabelText("TMT Steel 12mm")).toBeTruthy();
    expect(optionsGroup().queryByLabelText("River Sand")).toBeNull();
  });

  it("matches case-insensitively", () => {
    render(<Harness />);
    fireEvent.change(search(), { target: { value: "RIVER" } });
    expect(optionsGroup().getByLabelText("River Sand")).toBeTruthy();
  });

  it("never offers an archived material as a new choice", () => {
    // The master list the field reads is ACTIVE-only; an archived material that
    // is only known through the vendor's existing mappings is not an option.
    const archived: VendorMaterialRef = { id: "m-old", name: "Retired Cement", isActive: false };
    render(<Harness existing={[archived]} />);
    expect(optionsGroup().queryByLabelText("Retired Cement")).toBeNull();
  });
});

describe("selecting", () => {
  it("selects several materials and shows each as a chip", () => {
    render(<Harness />);
    fireEvent.click(optionsGroup().getByLabelText("OPC 53 Cement"));
    fireEvent.click(optionsGroup().getByLabelText("TMT Steel 12mm"));

    const chips = within(selectedChips()!);
    expect(chips.getByText("OPC 53 Cement")).toBeTruthy();
    expect(chips.getByText("TMT Steel 12mm")).toBeTruthy();
    expect((optionsGroup().getByLabelText("OPC 53 Cement") as HTMLInputElement).checked).toBe(true);
  });

  it("removing a chip removes the selection", () => {
    const spy = vi.fn();
    render(<Harness initial={["m-cement", "m-sand"]} onChangeSpy={spy} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove River Sand" }));

    expect(spy).toHaveBeenLastCalledWith(["m-cement"]);
    expect((optionsGroup().getByLabelText("River Sand") as HTMLInputElement).checked).toBe(false);
  });

  it("unticking an option removes it too", () => {
    const spy = vi.fn();
    render(<Harness initial={["m-cement"]} onChangeSpy={spy} />);
    fireEvent.click(optionsGroup().getByLabelText("OPC 53 Cement"));
    expect(spy).toHaveBeenLastCalledWith([]);
  });

  it("cannot select the same material twice", () => {
    const spy = vi.fn();
    render(<Harness initial={["m-cement"]} onChangeSpy={spy} />);
    // Ticking a ticked box toggles it OFF — there is no path that appends a duplicate.
    fireEvent.click(optionsGroup().getByLabelText("OPC 53 Cement"));
    expect(spy.mock.calls.every(([ids]) => new Set(ids).size === ids.length)).toBe(true);
  });

  it("says selection is optional when nothing is chosen", () => {
    render(<Harness />);
    expect(screen.getByText(/Optional — none selected/i)).toBeTruthy();
  });
});

describe("an existing mapping to an archived material", () => {
  const archived: VendorMaterialRef = { id: "m-old", name: "Retired Cement", isActive: false };

  it("is still shown, marked Archived — never silently hidden", () => {
    render(<Harness initial={["m-old"]} existing={[archived]} />);
    const chips = within(selectedChips()!);
    expect(chips.getByText("Retired Cement")).toBeTruthy();
    expect(chips.getByText(/Archived/)).toBeTruthy();
  });

  it("can be removed like any other", () => {
    const spy = vi.fn();
    render(<Harness initial={["m-old", "m-sand"]} existing={[archived]} onChangeSpy={spy} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Retired Cement" }));
    expect(spy).toHaveBeenLastCalledWith(["m-sand"]);
  });
});

describe("no free-text materials", () => {
  it("pressing Enter in the search creates nothing and submits nothing", () => {
    h.permissions.add("materials.create");
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Harness />
      </form>,
    );
    fireEvent.change(search(), { target: { value: "CPVC Pipe 1 inch" } });
    fireEvent.keyDown(search(), { key: "Enter" });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByTestId("material-sheet")).toBeNull();
  });

  it("without materials.create, an unmatched search only says who to ask", () => {
    render(<Harness />);
    fireEvent.change(search(), { target: { value: "CPVC Pipe 1 inch" } });
    expect(screen.getByText(/No matching material\. Ask someone with material management access/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Create/i })).toBeNull();
  });

  it("with materials.create, offers an explicit Create for the typed name", () => {
    h.permissions.add("materials.create");
    render(<Harness />);
    fireEvent.change(search(), { target: { value: "  CPVC Pipe 1 inch  " } });
    fireEvent.click(screen.getByRole("button", { name: "Create “CPVC Pipe 1 inch”" }));
    // Opens the normal Add-material form, prefilled — the user still confirms it.
    expect(screen.getByTestId("material-sheet").textContent).toBe("CPVC Pipe 1 inch");
  });

  it("does not offer Create when a material already has exactly that name", () => {
    h.permissions.add("materials.create");
    render(<Harness />);
    // Case and surrounding space do not make it a different material.
    fireEvent.change(search(), { target: { value: "  opc 53 CEMENT " } });
    expect(screen.queryByRole("button", { name: /Create/i })).toBeNull();
  });

  it("offers Create for a distinct name even while similar materials are listed", () => {
    // "Sand" is not "River Sand". A no-match-at-all rule made the client's own
    // example impossible to create here — found by clicking through the demo.
    h.permissions.add("materials.create");
    render(<Harness />);
    fireEvent.change(search(), { target: { value: "Sand" } });
    expect(optionsGroup().getByLabelText("River Sand")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create “Sand”" })).toBeTruthy();
  });

  it("without materials.create, near matches are simply listed — no nag", () => {
    render(<Harness />);
    fireEvent.change(search(), { target: { value: "Sand" } });
    expect(optionsGroup().getByLabelText("River Sand")).toBeTruthy();
    expect(screen.queryByText(/Ask someone/i)).toBeNull();
  });

  it("selects the material once it is created, and clears the search", () => {
    h.permissions.add("materials.create");
    const spy = vi.fn();
    render(<Harness initial={["m-sand"]} onChangeSpy={spy} />);
    fireEvent.change(search(), { target: { value: "CPVC Pipe 1 inch" } });
    fireEvent.click(screen.getByRole("button", { name: /Create/i }));

    React.act(() => h.lastSheet!.onSaved!(m("m-new", "CPVC Pipe 1 inch")));

    expect(spy).toHaveBeenLastCalledWith(["m-sand", "m-new"]);
    // Labelled immediately, before the master list has refetched.
    expect(within(selectedChips()!).getByText("CPVC Pipe 1 inch")).toBeTruthy();
    expect((search() as HTMLInputElement).value).toBe("");
  });
});

describe("an empty Material Master", () => {
  beforeEach(() => {
    h.active = [];
  });

  it("invites a material creator to add one", () => {
    h.permissions.add("materials.create");
    render(<Harness />);
    expect(screen.getByText(/No materials exist yet\. Add a material first/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Add material/i }));
    expect(screen.getByTestId("material-sheet")).toBeTruthy();
  });

  it("tells everyone else who to ask, without blocking the vendor form", () => {
    render(<Harness />);
    expect(screen.getByText(/No materials are available\. Ask someone/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Add material/i })).toBeNull();
  });
});
