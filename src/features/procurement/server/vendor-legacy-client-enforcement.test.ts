import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import { ALL_PERMISSIONS } from "@/features/rbac/permissions";

/**
 * Gate 0 at the server boundary: the mobile build that shipped before the
 * Material Master calls createVendor / updateVendor with only
 * `materialsSupplied: string[]` — on every save, the complete list, as it last
 * showed it. These tests drive the real server actions with that exact shape
 * and assert the canonical mappings stay in step with it, without guessing,
 * minting materials, or losing text.
 */

const OWNER: SessionUser = {
  id: "u1",
  email: "u@x.com",
  fullName: "U",
  role: "OWNER",
  permissions: [...ALL_PERMISSIONS],
  company: { id: "c1", name: "Co" },
};

const h = vi.hoisted(() => ({
  prisma: {
    vendor: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    material: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    vendorMaterial: { findMany: vi.fn() },
    activityLog: { create: vi.fn() },
    purchaseOrder: { findMany: vi.fn() },
    vendorPayment: { findMany: vi.fn() },
    vendorFavorite: { findMany: vi.fn() },
    company: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/auth/current-user", () => ({ requireUser: async () => OWNER }));
vi.mock("@/lib/db/prisma", () => ({ prisma: h.prisma }));

import { createVendor, updateVendor, updateMaterial } from "./actions";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const MASTER = [
  { id: "m-cement", name: "Cement", deletedAt: null },
  { id: "m-opc", name: "OPC Cement", deletedAt: null },
  { id: "m-sand", name: "Sand", deletedAt: null },
];
/** The shape loadMappingState reads for a vendor's current mappings. */
const mapped = (...ids: string[]) =>
  ids.map((id) => ({ material: MASTER.find((m) => m.id === id)! }));

/** Set the vendor's current state: its legacy column and its mappings. */
function vendorState(column: string[], currentIds: string[]) {
  h.prisma.vendor.findFirst.mockResolvedValue({ id: "v1", materialsSupplied: column });
  h.prisma.vendorMaterial.findMany.mockResolvedValueOnce(mapped(...currentIds));
}

const write = () => h.prisma.vendor.update.mock.calls[0][0].data;
const writtenIds = () =>
  (write().materials?.createMany.data ?? []).map((r: { materialId: string }) => r.materialId).sort();

beforeEach(() => {
  Object.values(h.prisma).forEach((m) =>
    Object.values(m).forEach((f) => (f as ReturnType<typeof vi.fn>).mockReset()),
  );
  h.prisma.material.findMany.mockResolvedValue(MASTER);
  h.prisma.vendor.update.mockResolvedValue({ id: "v1", businessName: "V", materialsSupplied: [] });
  h.prisma.vendor.create.mockResolvedValue({ id: "v1", businessName: "V", materialsSupplied: [] });
  h.prisma.vendorMaterial.findMany.mockResolvedValue([]);
  h.prisma.vendor.findMany.mockResolvedValue([]);
  h.prisma.activityLog.create.mockResolvedValue({});
  h.prisma.purchaseOrder.findMany.mockResolvedValue([]);
  h.prisma.vendorPayment.findMany.mockResolvedValue([]);
  h.prisma.vendorFavorite.findMany.mockResolvedValue([]);
  h.prisma.company.findUnique.mockResolvedValue({ settings: {} });
});

describe("an old app editing a vendor", () => {
  it("adding a name that exists in the master maps it — no split-brain", async () => {
    // The reported case: legacy ["Cement", "Sand"], canonical [Cement].
    vendorState(["Cement"], ["m-cement"]);
    await updateVendor("v1", { materialsSupplied: ["Cement", "Sand"] });

    expect(writtenIds()).toEqual(["m-cement", "m-sand"]);
    expect(write().materialsSupplied).toEqual(["Cement", "Sand"]);
  });

  it("saving an unrelated field round-trips the list and changes no mapping", async () => {
    vendorState(["Cement", "Sand"], ["m-cement", "m-sand"]);
    await updateVendor("v1", { phone: "+919800000000", materialsSupplied: ["Cement", "Sand"] });

    expect(writtenIds()).toEqual(["m-cement", "m-sand"]);
    // …and therefore writes no mapping audit event, only the field edit.
    const actions = h.prisma.activityLog.create.mock.calls.map((c) => c[0].data.action);
    expect(actions).toEqual(["vendor.updated"]);
  });

  it("removing a chip the old app showed removes the mapping, and audits it", async () => {
    vendorState(["Cement", "Sand"], ["m-cement", "m-sand"]);
    await updateVendor("v1", { materialsSupplied: ["Cement"] });

    expect(writtenIds()).toEqual(["m-cement"]);
    const mapping = h.prisma.activityLog.create.mock.calls
      .map((c) => c[0].data)
      .find((d) => d.action === "vendor.materials_updated");
    expect(mapping.meta.removedIds).toEqual(["m-sand"]);
  });

  it("never fuzzy-matches — 'Cement' is not 'OPC Cement'", async () => {
    vendorState([], []);
    await updateVendor("v1", { materialsSupplied: ["Cement"] });
    expect(writtenIds()).toEqual(["m-cement"]);
  });

  it("keeps unmatched text in the legacy column and creates no material", async () => {
    vendorState(["Cement"], ["m-cement"]);
    await updateVendor("v1", { materialsSupplied: ["Cement", "Waterproofing Chemical"] });

    expect(writtenIds()).toEqual(["m-cement"]);
    expect(write().materialsSupplied).toEqual(["Cement", "Waterproofing Chemical"]);
    // No material is ever written by a vendor save.
    expect(h.prisma.material.update).not.toHaveBeenCalled();
    expect(h.prisma.material).not.toHaveProperty("create");
  });

  it("does not store the raw list as a column write of its own", async () => {
    vendorState([], []);
    await updateVendor("v1", { materialsSupplied: ["cement  "] });
    // The column is the DERIVED mirror (canonical spelling), not what was typed.
    expect(write().materialsSupplied).toEqual(["Cement"]);
    const fields = h.prisma.activityLog.create.mock.calls[0][0].data.meta.fields;
    expect(fields).not.toContain("materialsSupplied");
  });

  it("treats a foreign vendor as NOT_FOUND on this path too", async () => {
    h.prisma.vendor.findFirst.mockResolvedValue(null);
    await expect(updateVendor("foreign", { materialsSupplied: ["Cement"] })).rejects.toThrow(
      "NOT_FOUND",
    );
    expect(h.prisma.vendor.update).not.toHaveBeenCalled();
  });
});

describe("an old app creating a vendor", () => {
  it("maps exact matches and keeps the rest as text", async () => {
    await createVendor({ businessName: "Old App Vendor", materialsSupplied: ["sand", "Mystery Item"] });
    const data = h.prisma.vendor.create.mock.calls[0][0].data;
    expect(data.materials.createMany.data.map((r: { materialId: string }) => r.materialId)).toEqual([
      "m-sand",
    ]);
    expect(data.materialsSupplied).toEqual(["Sand", "Mystery Item"]);
  });
});

describe("the new UI must not delete what an old app recorded", () => {
  it("carries legacy-only names forward on a materialIds save", async () => {
    // An old app recorded "Waterproofing Chemical"; the web UI cannot show it
    // as a choice, so saving from the web must not be what destroys it.
    vendorState(["Cement", "Waterproofing Chemical"], ["m-cement"]);
    h.prisma.material.findMany.mockResolvedValue([MASTER[0], MASTER[2]]);
    await updateVendor("v1", { materialIds: ["m-cement", "m-sand"] });

    expect(writtenIds()).toEqual(["m-cement", "m-sand"]);
    expect(write().materialsSupplied).toEqual(["Cement", "Sand", "Waterproofing Chemical"]);
  });

  it("drops a legacy-only name once a real material with that name is mapped", async () => {
    vendorState(["Cement", "sand"], ["m-cement"]);
    h.prisma.material.findMany.mockResolvedValue([MASTER[0], MASTER[2]]);
    await updateVendor("v1", { materialIds: ["m-cement", "m-sand"] });
    expect(write().materialsSupplied).toEqual(["Cement", "Sand"]);
  });
});

describe("renaming a material keeps every mapped vendor's mirror current", () => {
  it("replaces only the matching entry, leaving legacy-only names beside it", async () => {
    h.prisma.material.findFirst
      .mockResolvedValueOnce({ id: "m-cement", name: "Cement", category: null })
      .mockResolvedValueOnce(null); // name available
    h.prisma.material.update.mockResolvedValue({
      id: "m-cement",
      name: "OPC 53 Cement",
      category: null,
      defaultUnit: null,
      hsnCode: null,
      displayOrder: 0,
      deletedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    h.prisma.vendor.findMany.mockResolvedValue([
      { id: "v1", materialsSupplied: ["cement", "Waterproofing Chemical"] },
    ]);

    await updateMaterial("m-cement", { name: "OPC 53 Cement" });

    expect(h.prisma.vendor.findMany.mock.calls[0][0].where).toMatchObject({
      companyId: "c1",
      materials: { some: { materialId: "m-cement" } },
    });
    expect(h.prisma.vendor.update.mock.calls[0][0]).toEqual({
      where: { id: "v1", companyId: "c1" },
      data: { materialsSupplied: ["OPC 53 Cement", "Waterproofing Chemical"] },
    });
  });

  it("does nothing to vendors when the name did not change", async () => {
    h.prisma.material.findFirst.mockResolvedValueOnce({ id: "m-cement", name: "Cement", category: null });
    h.prisma.material.update.mockResolvedValue({
      id: "m-cement",
      name: "Cement",
      category: null,
      defaultUnit: "bag",
      hsnCode: null,
      displayOrder: 0,
      deletedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await updateMaterial("m-cement", { defaultUnit: "bag" });
    expect(h.prisma.vendor.findMany).not.toHaveBeenCalled();
    expect(h.prisma.vendor.update).not.toHaveBeenCalled();
  });
});
