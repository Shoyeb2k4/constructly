/**
 * The Material filter control: users see names, the filter stores identity,
 * and choosing one form always clears the other.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { MaterialFilterSelect, materialFilterLabel } from "./material-filter-select";
import type { Material } from "../types";

// Radix Select needs these in jsdom.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

const m = (id: string, name: string, isActive = true): Material => ({
  id,
  name,
  category: null,
  defaultUnit: null,
  hsnCode: null,
  displayOrder: 0,
  isActive,
  createdAt: "",
  updatedAt: "",
});
const MATERIALS = [m("m1", "OPC 53 Cement"), m("m2", "TMT Steel"), m("m3", "Old Primer", false)];

afterEach(cleanup);

function open() {
  fireEvent.pointerDown(screen.getByRole("combobox", { name: "Filter by material" }), { button: 0, pointerType: "mouse" });
}
function choose(name: string | RegExp) {
  fireEvent.click(screen.getByRole("option", { name }));
}

describe("MaterialFilterSelect", () => {
  it("shows names, grouped: materials, archived, and unlinked older-order names", () => {
    render(<MaterialFilterSelect value={{}} onChange={() => {}} materials={MATERIALS} unlinkedNames={["Emulsion Paint"]} />);
    open();
    const listbox = screen.getByRole("listbox");
    expect(within(listbox).getByRole("option", { name: "OPC 53 Cement" })).toBeTruthy();
    expect(within(listbox).getByRole("option", { name: "Old Primer (archived)" })).toBeTruthy();
    expect(within(listbox).getByRole("option", { name: "“Emulsion Paint”" })).toBeTruthy();
    expect(within(listbox).queryByText(/^m1$/)).toBeNull(); // never a raw id
  });

  it("choosing a material stores its ID and clears any name", () => {
    const onChange = vi.fn();
    render(<MaterialFilterSelect value={{ material: "Emulsion Paint" }} onChange={onChange} materials={MATERIALS} unlinkedNames={["Emulsion Paint"]} />);
    open();
    choose("OPC 53 Cement");
    expect(onChange).toHaveBeenCalledWith({ materialId: "m1", material: undefined });
  });

  it("an archived material is still choosable, by id", () => {
    const onChange = vi.fn();
    render(<MaterialFilterSelect value={{}} onChange={onChange} materials={MATERIALS} />);
    open();
    choose("Old Primer (archived)");
    expect(onChange).toHaveBeenCalledWith({ materialId: "m3", material: undefined });
  });

  it("choosing an older-order name stores the recorded NAME and clears the id", () => {
    const onChange = vi.fn();
    render(<MaterialFilterSelect value={{ materialId: "m1" }} onChange={onChange} materials={MATERIALS} unlinkedNames={["Emulsion Paint"]} />);
    open();
    choose("“Emulsion Paint”");
    expect(onChange).toHaveBeenCalledWith({ materialId: undefined, material: "Emulsion Paint" });
  });

  it("'Any material' clears both", () => {
    const onChange = vi.fn();
    render(<MaterialFilterSelect value={{ materialId: "m1" }} onChange={onChange} materials={MATERIALS} />);
    open();
    choose("Any material");
    expect(onChange).toHaveBeenCalledWith({ materialId: undefined, material: undefined });
  });

  it("a name from an old link that is not an option still renders as what it is", () => {
    render(<MaterialFilterSelect value={{ material: "cement" }} onChange={() => {}} materials={MATERIALS} unlinkedNames={[]} />);
    expect(screen.getByRole("combobox", { name: "Filter by material" }).textContent).toBe("Recorded as “cement”");
  });

  it("the selected material shows its CURRENT name (a rename relabels it)", () => {
    render(<MaterialFilterSelect value={{ materialId: "m1" }} onChange={() => {}} materials={MATERIALS} />);
    expect(screen.getByRole("combobox", { name: "Filter by material" }).textContent).toBe("OPC 53 Cement");
  });
});

describe("materialFilterLabel (the active-filter chip)", () => {
  it("names the material, marks archived, and shows the recorded-name form distinctly", () => {
    expect(materialFilterLabel({ materialId: "m1" }, MATERIALS)).toBe("Material: OPC 53 Cement");
    expect(materialFilterLabel({ materialId: "m3" }, MATERIALS)).toBe("Material: Old Primer (archived)");
    expect(materialFilterLabel({ material: "Cement" }, MATERIALS)).toBe("Recorded as: “Cement”");
    expect(materialFilterLabel({ materialId: "m1", material: "Cement" }, MATERIALS)).toBe("Material: OPC 53 Cement");
    expect(materialFilterLabel({}, MATERIALS)).toBeNull();
  });
});
