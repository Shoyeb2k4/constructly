/**
 * The Add / Edit vendor sheet, with its "Materials supplied" picker.
 *
 * Materials are now a real form field (react-hook-form owns them), so the
 * things worth pinning are the ones that used to go wrong when they lived in
 * side state: what is actually submitted, that Edit starts from the vendor's
 * real mappings, that a reopened Add form is empty, and that a failed save
 * leaves the user's work where they left it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import type { Permission } from "@/features/rbac/permissions";
import type { Material, Vendor } from "../types";

const h = vi.hoisted(() => ({
  permissions: new Set<string>(),
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/features/rbac/permission-context", () => ({
  useCan: () => (p: Permission) => h.permissions.has(p),
}));

const mat = (id: string, name: string): Material => ({
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
  mat("m-cement", "OPC 53 Cement"),
  mat("m-steel", "TMT Steel 12mm"),
  mat("m-sand", "Sand"),
  mat("m-agg", "Aggregate 20mm"),
];

vi.mock("../hooks", () => ({
  useVendorMutations: () => ({
    create: { mutateAsync: h.create, isPending: false },
    update: { mutateAsync: h.update, isPending: false },
  }),
  useMaterialMaster: () => ({ data: CATALOGUE, isLoading: false }),
  useMaterialMutations: () => ({ create: { mutateAsync: vi.fn(), isPending: false } }),
  useMaterialCategories: () => ({ data: [] }),
}));

import { AddVendorSheet } from "./add-vendor-sheet";

const VENDOR: Vendor = {
  id: "v1",
  businessName: "Shree Building Supplies",
  contactPerson: null,
  phone: null,
  email: null,
  gstin: null,
  pan: null,
  address: null,
  materialsSupplied: ["OPC 53 Cement", "Sand"],
  materials: [
    { id: "m-cement", name: "OPC 53 Cement", isActive: true },
    { id: "m-sand", name: "Sand", isActive: true },
  ],
  unlinkedMaterialNames: [],
  paymentTerms: null,
  status: "ACTIVE",
  notes: null,
  isFavorite: false,
  totalPurchasedPaise: 0,
  outstandingPaise: 0,
  poCount: 0,
  projectsServed: 0,
};

const options = () => within(screen.getByRole("group", { name: "Materials" }));
const chips = () => within(screen.getByRole("list", { name: "Selected materials" }));
const tick = (name: string) => fireEvent.click(options().getByLabelText(name));

/** Mirrors the Vendors page: the Add sheet stays MOUNTED and only toggles open. */
function AddHarness() {
  const [open, setOpen] = React.useState(true);
  return (
    <>
      <button onClick={() => setOpen(true)}>reopen</button>
      <AddVendorSheet open={open} onOpenChange={setOpen} />
    </>
  );
}

beforeEach(() => {
  h.permissions = new Set(["vendors.create", "vendors.edit"]);
  h.create.mockReset().mockResolvedValue({ ...VENDOR, id: "new" });
  h.update.mockReset().mockResolvedValue(VENDOR);
});
afterEach(cleanup);

describe("creating a vendor", () => {
  it("submits the selected materials as master ids, not free text", async () => {
    render(<AddVendorSheet open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("UltraTech Cement"), {
      target: { value: "Shree Building Supplies" },
    });
    tick("OPC 53 Cement");
    tick("TMT Steel 12mm");
    tick("Sand");
    fireEvent.click(screen.getByRole("button", { name: "Add vendor" }));

    await waitFor(() => expect(h.create).toHaveBeenCalled());
    const input = h.create.mock.calls[0][0];
    expect(input.materialIds).toEqual(["m-cement", "m-steel", "m-sand"]);
    // The legacy free-text list is no longer sent; the server derives it.
    expect(input).not.toHaveProperty("materialsSupplied");
  });

  it("allows a vendor with no materials — the field is optional", async () => {
    render(<AddVendorSheet open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("UltraTech Cement"), {
      target: { value: "Bare Vendor" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add vendor" }));
    await waitFor(() => expect(h.create).toHaveBeenCalled());
    expect(h.create.mock.calls[0][0].materialIds).toEqual([]);
  });

  it("a reopened Add form does not carry the last selection over", async () => {
    // The old chips lived in side state that reset() never touched.
    render(<AddHarness />);
    tick("OPC 53 Cement");
    expect(chips().getByText("OPC 53 Cement")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "reopen" }));

    await waitFor(() => expect(screen.getByText(/Optional — none selected/i)).toBeTruthy());
    expect((options().getByLabelText("OPC 53 Cement") as HTMLInputElement).checked).toBe(false);
  });

  it("a failed save keeps the sheet open with everything the user entered", async () => {
    h.create.mockRejectedValue(new Error("NOT_FOUND"));
    const onOpenChange = vi.fn();
    render(<AddVendorSheet open onOpenChange={onOpenChange} />);
    fireEvent.change(screen.getByPlaceholderText("UltraTech Cement"), {
      target: { value: "Shree Building Supplies" },
    });
    tick("OPC 53 Cement");
    tick("Sand");
    fireEvent.click(screen.getByRole("button", { name: "Add vendor" }));

    await waitFor(() => expect(h.create).toHaveBeenCalled());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect((screen.getByPlaceholderText("UltraTech Cement") as HTMLInputElement).value).toBe(
      "Shree Building Supplies",
    );
    expect(chips().getByText("OPC 53 Cement")).toBeTruthy();
    expect(chips().getByText("Sand")).toBeTruthy();
  });
});

describe("editing a vendor", () => {
  it("starts from the vendor's real mappings", () => {
    render(<AddVendorSheet open onOpenChange={() => {}} vendor={VENDOR} />);
    expect(chips().getByText("OPC 53 Cement")).toBeTruthy();
    expect(chips().getByText("Sand")).toBeTruthy();
    expect((options().getByLabelText("TMT Steel 12mm") as HTMLInputElement).checked).toBe(false);
  });

  it("adds a mapping and removes another in one save", async () => {
    render(<AddVendorSheet open onOpenChange={() => {}} vendor={VENDOR} />);
    tick("Aggregate 20mm");
    fireEvent.click(screen.getByRole("button", { name: "Remove Sand" }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(h.update).toHaveBeenCalled());
    const { id, patch } = h.update.mock.calls[0][0];
    expect(id).toBe("v1");
    expect(patch.materialIds).toEqual(["m-cement", "m-agg"]);
  });

  it("loads a vendor with no mappings cleanly", () => {
    render(<AddVendorSheet open onOpenChange={() => {}} vendor={{ ...VENDOR, materials: [] }} />);
    expect(screen.getByText(/Optional — none selected/i)).toBeTruthy();
  });

  it("keeps an archived mapping on an unrelated edit instead of dropping it", async () => {
    const withArchived: Vendor = {
      ...VENDOR,
      materials: [...VENDOR.materials, { id: "m-old", name: "Retired Cement", isActive: false }],
    };
    render(<AddVendorSheet open onOpenChange={() => {}} vendor={withArchived} />);
    expect(chips().getByText("Retired Cement")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("30 days"), { target: { value: "45 days" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(h.update).toHaveBeenCalled());
    expect(h.update.mock.calls[0][0].patch.materialIds).toContain("m-old");
  });

  it("does not send an unchanged status — so editing never needs archive rights", async () => {
    // Any status in the patch is treated server-side as a lifecycle change
    // needing vendors.archive / vendors.restore. Sending it on every save made
    // each edit by a Purchase Manager fail for a status they never touched.
    h.permissions = new Set(["vendors.edit"]);
    render(<AddVendorSheet open onOpenChange={() => {}} vendor={VENDOR} />);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(h.update).toHaveBeenCalled());
    expect(h.update.mock.calls[0][0].patch).not.toHaveProperty("status");
  });
});
