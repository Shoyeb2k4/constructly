/**
 * The PO editor's material picking, end to end: the real editor, the real
 * hooks, the real picker and form, and the DEMO repositories underneath (demo
 * mode is switched on, so projects, budgets and procurement all run on seeded
 * data). Nothing about the data layer is stubbed.
 *
 * Demo seed used here: UltraTech Cement usually supplies Cement, Concrete and
 * AAC Blocks; Sanghvi Steel supplies TMT Steel, Structural Steel and Binding
 * Wire. "Cement" defaults to Cement / bag; "TMT Steel" to Steel / ton.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// These drive the real editor — Radix selects, sheets, react-hook-form and the
// demo repository — end to end, and several take 3–5s of jsdom work each. At
// the 5s default they time out intermittently under parallel load; the budget
// is for the machine, not for anything the tests wait on.
vi.setConfig({ testTimeout: 15_000 });
import * as React from "react";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Permission } from "@/features/rbac/permissions";
import type { PurchaseOrderDetail } from "../types";

// Radix Select needs these under jsdom.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

const h = vi.hoisted(() => ({
  permissions: new Set<string>(),
  push: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/env", async (orig) => ({ ...((await orig()) as object), isDemoMode: true }));
vi.mock("@/features/rbac/permission-context", () => ({
  useCan: () => (p: Permission) => h.permissions.has(p),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/procurement",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({ toast: { error: h.toastError, success: h.toastSuccess } }));

import { POEditorSheet } from "./po-editor-sheet";
import { demoProcurementRepository as repo } from "../demo/demo-repository";

const CREATOR: Permission[] = ["purchase_orders.view", "purchase_orders.create", "purchase_orders.edit"];

function renderEditor(props: { editPo?: PurchaseOrderDetail } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <POEditorSheet open onOpenChange={() => {}} editPo={props.editPo} />
    </QueryClientProvider>,
  );
}

/** Open a Radix Select by its trigger and choose an option. */
function choose(trigger: HTMLElement, option: string) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  fireEvent.click(screen.getByRole("option", { name: option }));
}
const triggerWithText = (text: string) => screen.getByText(text).closest("button")!;
const materialButton = (n: number) => screen.getByRole("button", { name: new RegExp(`^Material for line ${n}:`) });
const picker = () => within(screen.getByRole("dialog", { name: "Choose material" }));
const group = (name: string) => within(picker().getByRole("region", { name }));

async function startNewOrder(vendor = "UltraTech Cement") {
  renderEditor();
  await waitFor(() => expect(screen.getByText("Select project")).toBeTruthy());
  await waitFor(() => {
    fireEvent.pointerDown(triggerWithText("Select project"), { button: 0, ctrlKey: false, pointerType: "mouse" });
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
  });
  fireEvent.click(screen.getAllByRole("option")[0]);
  await waitFor(() => expect(screen.getByText("Select vendor")).toBeTruthy());
  await waitFor(() => {
    fireEvent.pointerDown(triggerWithText("Select vendor"), { button: 0, ctrlKey: false, pointerType: "mouse" });
    expect(screen.getByRole("option", { name: vendor })).toBeTruthy();
  });
  fireEvent.click(screen.getByRole("option", { name: vendor }));
}

async function pickMaterial(line: number, groupName: string, material: RegExp) {
  await waitFor(() => expect(materialButton(line)).not.toHaveProperty("disabled", true));
  fireEvent.click(materialButton(line));
  await waitFor(() => expect(group(groupName).getByRole("button", { name: material })).toBeTruthy());
  fireEvent.click(group(groupName).getByRole("button", { name: material }));
}

async function save() {
  fireEvent.click(screen.getByRole("button", { name: /Create purchase order|Save changes/ }));
}

async function newestPO() {
  const list = await repo.listPurchaseOrders();
  return (await repo.getPurchaseOrder(list[0].id))!;
}

beforeEach(() => {
  localStorage.clear();
  h.permissions = new Set(CREATOR);
  h.push.mockReset();
  h.toastError.mockReset();
  h.toastSuccess.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("vendor first", () => {
  it("offers no material choice until a vendor is selected", async () => {
    renderEditor();
    await waitFor(() => expect(materialButton(1)).toBeTruthy());
    expect((materialButton(1) as HTMLButtonElement).disabled).toBe(true);
    expect(materialButton(1).textContent).toMatch(/Select a vendor first/);
  });
});

describe("the vendor's usual materials, then everything else", () => {
  it("lists the vendor's materials first and every other active material below", async () => {
    await startNewOrder();
    await waitFor(() => expect((materialButton(1) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(materialButton(1));
    await waitFor(() => expect(group("Supplied by UltraTech Cement").getByRole("button", { name: /^Cement/ })).toBeTruthy());

    const usual = group("Supplied by UltraTech Cement");
    expect(usual.getByRole("button", { name: /^Concrete/ })).toBeTruthy();
    expect(usual.queryByRole("button", { name: /^TMT Steel/ })).toBeNull();
    // Not a restriction: other active materials are right there.
    expect(group("Other materials").getByRole("button", { name: /^TMT Steel/ })).toBeTruthy();
  });

  it("searches across both groups", async () => {
    await startNewOrder();
    await waitFor(() => expect((materialButton(1) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(materialButton(1));
    await waitFor(() => expect(picker().getByLabelText("Search materials")).toBeTruthy());
    fireEvent.change(picker().getByLabelText("Search materials"), { target: { value: "c" } });

    expect(group("Supplied by UltraTech Cement").getByRole("button", { name: /^Concrete/ })).toBeTruthy();
    expect(group("Other materials").getByRole("button", { name: /^Structural Steel/ })).toBeTruthy();
  });

  it("a vendor with no usual materials still reaches the whole Material Master", async () => {
    const bare = await repo.createVendor({ businessName: "Bare Supplier", materialIds: [] });
    await startNewOrder(bare.businessName);
    await waitFor(() => expect((materialButton(1) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(materialButton(1));
    await waitFor(() => expect(picker().getByText("No usual materials recorded for this vendor.")).toBeTruthy());
    expect(group("Other materials").getByRole("button", { name: /^Cement/ })).toBeTruthy();
  });

  it("never offers an archived material as a new choice", async () => {
    const m = await repo.createMaterial({ name: "Retired Primer" });
    await repo.setMaterialArchived(m.id, true);
    await startNewOrder();
    await waitFor(() => expect((materialButton(1) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(materialButton(1));
    await waitFor(() => expect(group("Other materials").getByRole("button", { name: /^TMT Steel/ })).toBeTruthy());
    expect(picker().queryByRole("button", { name: /^Retired Primer/ })).toBeNull();
  });
});

describe("saving a canonical material", () => {
  it("a usual material saves with its id, and the master's name as the snapshot", async () => {
    await startNewOrder();
    await pickMaterial(1, "Supplied by UltraTech Cement", /^Cement/);
    await save();

    await waitFor(() => expect(h.push).toHaveBeenCalled());
    const po = await newestPO();
    const cement = (await repo.listMaterialMaster()).find((x) => x.name === "Cement")!;
    expect(po.lineItems[0].materialId).toBe(cement.id);
    expect(po.lineItems[0].material).toBe("Cement");
  });

  it("an OTHER material saves too — the vendor mapping is never required", async () => {
    await startNewOrder();
    await pickMaterial(1, "Other materials", /^TMT Steel/);
    await save();

    await waitFor(() => expect(h.push).toHaveBeenCalled());
    const po = await newestPO();
    expect(po.lineItems[0].material).toBe("TMT Steel");
    expect(po.lineItems[0].materialId).toBeTruthy();
  });

  it("choosing an Other material does NOT change the vendor's usual materials", async () => {
    const vendorId = (await repo.listVendors()).find((v) => v.businessName === "UltraTech Cement")!.id;
    const before = (await repo.listVendorMaterials(vendorId)).map((m) => m.id).sort();

    await startNewOrder();
    await pickMaterial(1, "Other materials", /^TMT Steel/);
    await save();
    await waitFor(() => expect(h.push).toHaveBeenCalled());

    expect((await repo.listVendorMaterials(vendorId)).map((m) => m.id).sort()).toEqual(before);
  });
});

describe("unit and category defaults", () => {
  it("prefill from the chosen material", async () => {
    await startNewOrder();
    await pickMaterial(1, "Other materials", /^TMT Steel/);
    expect(screen.getByLabelText("Unit for line 1").textContent).toContain("ton");
    expect(screen.getByLabelText("Category for line 1").textContent).toContain("Steel");
  });

  it("the user can override both after choosing, and the override is what saves", async () => {
    await startNewOrder();
    await pickMaterial(1, "Other materials", /^TMT Steel/);
    choose(screen.getByLabelText("Unit for line 1"), "kg");
    choose(screen.getByLabelText("Category for line 1"), "Hardware");
    await save();

    await waitFor(() => expect(h.push).toHaveBeenCalled());
    const line = (await newestPO()).lineItems[0];
    expect(line.unit).toBe("kg");
    expect(line.category).toBe("Hardware");
  });

  it("changing the material re-applies its defaults", async () => {
    await startNewOrder();
    await pickMaterial(1, "Other materials", /^TMT Steel/);
    choose(screen.getByLabelText("Unit for line 1"), "kg");
    await pickMaterial(1, "Supplied by UltraTech Cement", /^Cement/);
    expect(screen.getByLabelText("Unit for line 1").textContent).toContain("bag");
  });
});

describe("also add to the vendor's usual materials", () => {
  it("is offered only to someone who can edit vendors", async () => {
    await startNewOrder();
    await pickMaterial(1, "Other materials", /^TMT Steel/);
    expect(screen.getByText(/Not in UltraTech Cement's usual materials/)).toBeTruthy();
    expect(screen.queryByLabelText(/Also add this material/)).toBeNull();
  });

  it("is unchecked by default and, when ticked, maps the material after the save", async () => {
    h.permissions = new Set([...CREATOR, "vendors.edit"]);
    const vendorId = (await repo.listVendors()).find((v) => v.businessName === "UltraTech Cement")!.id;

    await startNewOrder();
    await pickMaterial(1, "Other materials", /^TMT Steel/);
    const box = screen.getByLabelText(/Also add this material to UltraTech Cement's usual materials/) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    await save();

    await waitFor(() => expect(h.push).toHaveBeenCalled());
    const names = (await repo.listVendorMaterials(vendorId)).map((m) => m.name);
    expect(names).toContain("TMT Steel");
  });

  it("a failed mapping never costs the purchase order", async () => {
    h.permissions = new Set([...CREATOR, "vendors.edit"]);
    vi.spyOn(repo, "addMaterialToVendor").mockRejectedValue(new Error("boom"));

    await startNewOrder();
    await pickMaterial(1, "Other materials", /^TMT Steel/);
    fireEvent.click(screen.getByLabelText(/Also add this material/));
    await save();

    await waitFor(() => expect(h.push).toHaveBeenCalled());
    expect((await newestPO()).lineItems[0].material).toBe("TMT Steel");
    expect(h.toastError.mock.calls[0][0]).toMatch(/Purchase order saved, but 1 material couldn't be added/);
  });
});

describe("changing the vendor", () => {
  it("keeps every line and its material, and flags lines the new vendor doesn't usually supply", async () => {
    await startNewOrder();
    await pickMaterial(1, "Supplied by UltraTech Cement", /^Cement/);

    // Radix also renders a hidden native <select> in forms, so the name appears
    // twice — find the visible trigger by what it shows.
    const vendorTrigger = screen.getAllByRole("combobox").find((el) => el.textContent?.includes("UltraTech Cement"))!;
    choose(vendorTrigger, "Sanghvi Steel");

    await waitFor(() => expect(screen.getByText(/Not in Sanghvi Steel's usual materials/)).toBeTruthy());
    expect(materialButton(1).textContent).toContain("Cement");

    await save();
    await waitFor(() => expect(h.push).toHaveBeenCalled());
    const po = await newestPO();
    const cement = (await repo.listMaterialMaster()).find((x) => x.name === "Cement")!;
    expect(po.vendor.name).toBe("Sanghvi Steel");
    expect(po.lineItems[0].materialId).toBe(cement.id);
  });
});

describe("existing lines", () => {
  async function draftWith(line: { material: string; materialId?: string | null; unit?: string }) {
    const vendorId = (await repo.listVendors()).find((v) => v.businessName === "UltraTech Cement")!.id;
    const seed = await newestPO();
    return repo.createPurchaseOrder({
      vendorId,
      projectId: seed.project.id,
      purchaseDate: "2026-03-01",
      lineItems: [{ quantity: 1, unit: line.unit ?? "nos", ratePaise: 100, gstRateBps: 0, ...line }],
    });
  }

  it("a legacy line with no material id stays editable, as recorded", async () => {
    const po = await draftWith({ material: "Old Free Text Item" });
    renderEditor({ editPo: po });
    await waitFor(() => expect(materialButton(1).textContent).toContain("Old Free Text Item"));
    expect(screen.getByText(/Not linked to the Material Master/)).toBeTruthy();

    await save();
    await waitFor(() => expect(h.push).toHaveBeenCalled());
    const after = (await repo.getPurchaseOrder(po.id))!;
    expect(after.lineItems[0].materialId).toBeNull();
    expect(after.lineItems[0].material).toBe("Old Free Text Item");
  });

  it("choosing a material upgrades a legacy line to a canonical id", async () => {
    const po = await draftWith({ material: "Old Free Text Item" });
    renderEditor({ editPo: po });
    await pickMaterial(1, "Supplied by UltraTech Cement", /^Concrete/);
    await save();

    await waitFor(() => expect(h.push).toHaveBeenCalled());
    const after = (await repo.getPurchaseOrder(po.id))!;
    expect(after.lineItems[0].material).toBe("Concrete");
    expect(after.lineItems[0].materialId).toBeTruthy();
  });

  it("a line whose material was archived survives an unrelated edit, id intact", async () => {
    const m = await repo.createMaterial({ name: "Soon Retired" });
    const po = await draftWith({ material: m.name, materialId: m.id });
    await repo.setMaterialArchived(m.id, true);

    renderEditor({ editPo: po });
    await waitFor(() => expect(screen.getByText(/Archived material — kept on this order/)).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("INV-2045"), { target: { value: "INV-9" } });
    await save();

    await waitFor(() => expect(h.push).toHaveBeenCalled());
    const after = (await repo.getPurchaseOrder(po.id))!;
    expect(after.lineItems[0].materialId).toBe(m.id);
    expect(after.lineItems[0].material).toBe("Soon Retired");
  });

  it("reordering lines keeps each line's material id with it", async () => {
    const all = await repo.listMaterialMaster();
    const cement = all.find((x) => x.name === "Cement")!;
    const steel = all.find((x) => x.name === "TMT Steel")!;
    const seed = await newestPO();
    const vendorId = (await repo.listVendors()).find((v) => v.businessName === "UltraTech Cement")!.id;
    const po = await repo.createPurchaseOrder({
      vendorId,
      projectId: seed.project.id,
      purchaseDate: "2026-03-01",
      lineItems: [
        { material: "x", materialId: cement.id, quantity: 1, unit: "bag", ratePaise: 1, gstRateBps: 0 },
        { material: "y", materialId: steel.id, quantity: 1, unit: "ton", ratePaise: 1, gstRateBps: 0 },
      ],
    });

    renderEditor({ editPo: po });
    await waitFor(() => expect(materialButton(2).textContent).toContain("TMT Steel"));
    fireEvent.click(screen.getAllByRole("button", { name: "Move line up" })[1]);
    await save();

    await waitFor(() => expect(h.push).toHaveBeenCalled());
    const after = (await repo.getPurchaseOrder(po.id))!;
    expect(after.lineItems.map((l) => [l.material, l.materialId])).toEqual([
      ["TMT Steel", steel.id],
      ["Cement", cement.id],
    ]);
  });
});

describe("form lifecycle", () => {
  it("a failed save keeps the sheet open with every material choice intact", async () => {
    vi.spyOn(repo, "createPurchaseOrder").mockRejectedValueOnce(new Error("NOT_FOUND"));
    await startNewOrder();
    await pickMaterial(1, "Supplied by UltraTech Cement", /^Cement/);
    await save();

    await waitFor(() => expect(h.toastError).toHaveBeenCalled());
    expect(h.push).not.toHaveBeenCalled();
    expect(materialButton(1).textContent).toContain("Cement");
  });

  it("every line reads the same two cached queries — no request per line", async () => {
    const master = vi.spyOn(repo, "listMaterialMaster");
    const usual = vi.spyOn(repo, "listVendorMaterials");
    await startNewOrder();
    await pickMaterial(1, "Supplied by UltraTech Cement", /^Cement/);
    fireEvent.click(screen.getByRole("button", { name: /Add line item/ }));
    fireEvent.click(screen.getByRole("button", { name: /Add line item/ }));
    await pickMaterial(3, "Other materials", /^TMT Steel/);

    expect(master).toHaveBeenCalledTimes(1);
    expect(usual).toHaveBeenCalledTimes(1);
  });
});

describe("form reset", () => {
  it("closing and reopening a new order clears the previous material choices", async () => {
    function Harness() {
      const [open, setOpen] = React.useState(true);
      return (
        <>
          <button onClick={() => setOpen(true)}>reopen</button>
          <POEditorSheet open={open} onOpenChange={setOpen} />
        </>
      );
    }
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <Harness />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText("Select vendor")).toBeTruthy());
    await waitFor(() => {
      fireEvent.pointerDown(triggerWithText("Select vendor"), { button: 0, ctrlKey: false, pointerType: "mouse" });
      expect(screen.getByRole("option", { name: "UltraTech Cement" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("option", { name: "UltraTech Cement" }));
    await pickMaterial(1, "Supplied by UltraTech Cement", /^Cement/);
    expect(materialButton(1).textContent).toContain("Cement");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "reopen" }));

    await waitFor(() => expect(materialButton(1).textContent).toMatch(/Select a vendor first/));
  });
});
