import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import { ALL_PERMISSIONS, type Permission } from "@/features/rbac/permissions";

/**
 * Vendor-to-material links say only "this vendor normally supplies this". They
 * are configuration, and the tests below are mostly about what they are NOT:
 * not transactional, not a constraint on ordering, and not a way to reach across
 * tenants or to touch purchase history.
 *
 * Since Pass 5 a mapping replacement is ONE nested write on the vendor — delete
 * the links, recreate them, refresh the legacy `materialsSupplied` mirror — so
 * the assertions below read that single write rather than separate calls.
 */

function user(permissions: Permission[]): SessionUser {
  return {
    id: "u1",
    email: "u@x.com",
    fullName: "U",
    role: "PROJECT_MANAGER",
    permissions,
    company: { id: "c1", name: "Co" },
  };
}
const OWNER = user([...ALL_PERMISSIONS]);

const h = vi.hoisted(() => ({
  user: null as SessionUser | null,
  prisma: {
    vendor: { findFirst: vi.fn(), update: vi.fn() },
    material: { findMany: vi.fn() },
    vendorMaterial: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    activityLog: { create: vi.fn() },
  },
}));
vi.mock("@/lib/auth/current-user", () => ({
  requireUser: async () => {
    if (!h.user) throw new Error("UNAUTHENTICATED");
    return h.user;
  },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: h.prisma }));

import { listVendorMaterials, setVendorMaterials, addMaterialToVendor } from "./actions";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const mat = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  companyId: "c1",
  name: id.toUpperCase(),
  category: null,
  defaultUnit: null,
  hsnCode: null,
  displayOrder: 0,
  deletedAt: null,
  deletedById: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

/** A vendor's CURRENT mappings, in the shape loadMappingState reads (the
 *  material's id, name and status — names are needed to carry legacy-only text
 *  forward). */
const current = (...rows: [string, (Date | null)?][]) =>
  rows.map(([id, deletedAt = null]) => ({ material: { id, name: id.toUpperCase(), deletedAt } }));

/** The single nested write setVendorMaterials made. */
function mappingWrite() {
  const call = h.prisma.vendor.update.mock.calls[0][0];
  return { where: call.where, data: call.data };
}

beforeEach(() => {
  h.user = OWNER;
  Object.values(h.prisma).forEach((m) =>
    Object.values(m).forEach((f) => (f as ReturnType<typeof vi.fn>).mockReset()),
  );
  h.prisma.vendor.findFirst.mockResolvedValue({ id: "v1" });
  h.prisma.vendor.update.mockResolvedValue({ id: "v1" });
  h.prisma.material.findMany.mockResolvedValue([]);
  h.prisma.vendorMaterial.findMany.mockResolvedValue([]);
  h.prisma.vendorMaterial.createMany.mockResolvedValue({ count: 1 });
  h.prisma.activityLog.create.mockResolvedValue({});
});

describe("listVendorMaterials", () => {
  it("is readable by a PO creator, who needs it to group the picker", async () => {
    h.user = user(["purchase_orders.create"]);
    await expect(listVendorMaterials("v1")).resolves.toEqual([]);
  });

  it("refuses a caller with no procurement authority at all", async () => {
    h.user = user(["attendance.mark"]);
    await expect(listVendorMaterials("v1")).rejects.toThrow("FORBIDDEN");
  });

  it("treats a vendor from another company as NOT_FOUND", async () => {
    h.user = user(["vendors.view"]);
    h.prisma.vendor.findFirst.mockResolvedValue(null);
    await expect(listVendorMaterials("foreign")).rejects.toThrow("NOT_FOUND");
    expect(h.prisma.vendor.findFirst.mock.calls[0][0].where).toMatchObject({
      id: "foreign",
      companyId: "c1",
    });
  });

  it("returns only active materials — it feeds the PO picker, which must not offer archived ones", async () => {
    h.user = user(["vendors.view"]);
    await listVendorMaterials("v1");
    expect(h.prisma.vendorMaterial.findMany.mock.calls[0][0].where).toMatchObject({
      companyId: "c1",
      vendorId: "v1",
      material: { deletedAt: null },
    });
  });
});

describe("setVendorMaterials", () => {
  it("requires vendors.edit — viewing a vendor is not enough", async () => {
    h.user = user(["vendors.view", "materials.view"]);
    await expect(setVendorMaterials("v1", ["m1"])).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.vendor.update).not.toHaveBeenCalled();
  });

  it("rejects a foreign vendor id without revealing it exists", async () => {
    h.user = user(["vendors.edit"]);
    h.prisma.vendor.findFirst.mockResolvedValue(null);
    await expect(setVendorMaterials("foreign", ["m1"])).rejects.toThrow("NOT_FOUND");
    expect(h.prisma.vendor.update).not.toHaveBeenCalled();
  });

  it("rejects a foreign material id the same way", async () => {
    h.user = user(["vendors.edit"]);
    h.prisma.material.findMany.mockResolvedValue([]); // company-scoped lookup finds nothing
    await expect(setVendorMaterials("v1", ["foreign-material"])).rejects.toThrow("NOT_FOUND");
    expect(h.prisma.material.findMany.mock.calls[0][0].where).toMatchObject({ companyId: "c1" });
    expect(h.prisma.vendor.update).not.toHaveBeenCalled();
  });

  it("refuses to NEWLY link a deactivated material, and says so distinctly", async () => {
    h.user = user(["vendors.edit"]);
    h.prisma.material.findMany.mockResolvedValue([mat("m1", { deletedAt: NOW })]);
    await expect(setVendorMaterials("v1", ["m1"])).rejects.toThrow("MATERIAL_ARCHIVED");
  });

  it("lets a vendor KEEP a material archived after it was mapped", async () => {
    // Otherwise saving any unrelated change to this vendor would fail, or the
    // link would be silently dropped — neither is acceptable.
    h.user = user(["vendors.edit"]);
    h.prisma.vendorMaterial.findMany.mockResolvedValueOnce(current(["m1", NOW])); // current
    h.prisma.material.findMany.mockResolvedValue([mat("m1", { deletedAt: NOW })]);

    await expect(setVendorMaterials("v1", ["m1"])).resolves.toEqual([]);
    expect(mappingWrite().data.materials.createMany.data).toEqual([
      { companyId: "c1", materialId: "m1" },
    ]);
  });

  it("replaces the set in one nested vendor write and stores no quantity", async () => {
    h.user = user(["vendors.edit"]);
    h.prisma.material.findMany.mockResolvedValue([mat("m1"), mat("m2")]);
    h.prisma.vendorMaterial.findMany.mockResolvedValueOnce(current(["m2"]));

    await setVendorMaterials("v1", ["m1", "m2"]);

    expect(h.prisma.vendor.update).toHaveBeenCalledTimes(1);
    const { where, data } = mappingWrite();
    expect(where).toEqual({ id: "v1", companyId: "c1" });
    // Delete-then-recreate inside the same statement: atomic by construction.
    expect(data.materials.deleteMany).toEqual({});
    expect(data.materials.createMany.data).toEqual([
      { companyId: "c1", materialId: "m1" },
      { companyId: "c1", materialId: "m2" },
    ]);
    // Eligibility only: nothing transactional may creep into these rows.
    for (const row of data.materials.createMany.data) {
      expect(Object.keys(row).sort()).toEqual(["companyId", "materialId"]);
    }
  });

  it("refreshes the legacy materialsSupplied mirror FROM the mapping", async () => {
    // The vendor list filter and search still match this column until Pass 7.
    h.user = user(["vendors.edit"]);
    h.prisma.material.findMany.mockResolvedValue([
      mat("m2", { name: "TMT Steel" }),
      mat("m1", { name: "Cement" }),
    ]);
    await setVendorMaterials("v1", ["m1", "m2"]);
    expect(mappingWrite().data.materialsSupplied).toEqual(["Cement", "TMT Steel"]);
  });

  it("touches only this vendor's links — never materials or purchase orders", async () => {
    h.user = user(["vendors.edit"]);
    h.prisma.material.findMany.mockResolvedValue([mat("m1")]);
    await setVendorMaterials("v1", ["m1"]);

    // The only write is the vendor update, scoped to this vendor in this company.
    expect(h.prisma.vendor.update).toHaveBeenCalledTimes(1);
    expect(h.prisma.vendorMaterial.deleteMany).not.toHaveBeenCalled();
    expect(h.prisma).not.toHaveProperty("purchaseOrder");
    expect(h.prisma).not.toHaveProperty("pOLineItem");
    expect(h.prisma.material).not.toHaveProperty("update");
    expect(h.prisma.material).not.toHaveProperty("delete");
  });

  it("collapses a repeated id rather than failing", async () => {
    h.user = user(["vendors.edit"]);
    h.prisma.material.findMany.mockResolvedValue([mat("m1")]);
    await setVendorMaterials("v1", ["m1", "m1", "m1"]);
    const { data } = mappingWrite();
    expect(data.materials.createMany.data).toHaveLength(1);
    expect(data.materials.createMany.skipDuplicates).toBe(true);
  });

  it("logs additions and removals as counts plus ids", async () => {
    h.user = user(["vendors.edit"]);
    h.prisma.material.findMany.mockResolvedValue([mat("m1")]);
    h.prisma.vendorMaterial.findMany.mockResolvedValueOnce(current(["m2"], ["m3"]));

    await setVendorMaterials("v1", ["m1"]);

    const entry = h.prisma.activityLog.create.mock.calls[0][0].data;
    expect(entry.action).toBe("vendor.materials_updated");
    expect(entry.entityId).toBe("v1");
    expect(entry.meta.addedCount).toBe(1);
    expect(entry.meta.removedCount).toBe(2);
    expect(entry.meta.addedIds).toEqual(["m1"]);
    expect(entry.meta.removedIds.sort()).toEqual(["m2", "m3"]);
  });

  it("writes no audit entry when nothing actually changed", async () => {
    h.user = user(["vendors.edit"]);
    h.prisma.material.findMany.mockResolvedValue([mat("m1")]);
    h.prisma.vendorMaterial.findMany.mockResolvedValueOnce(current(["m1"]));
    await setVendorMaterials("v1", ["m1"]);
    expect(h.prisma.activityLog.create).not.toHaveBeenCalled();
  });

  it("accepts an empty list, clearing the vendor's usual materials and the mirror", async () => {
    h.user = user(["vendors.edit"]);
    h.prisma.vendorMaterial.findMany.mockResolvedValueOnce(current(["m1"]));
    await setVendorMaterials("v1", []);
    const { data } = mappingWrite();
    expect(data.materials.createMany.data).toEqual([]);
    expect(data.materialsSupplied).toEqual([]);
    expect(h.prisma.activityLog.create.mock.calls[0][0].data.meta.removedCount).toBe(1);
  });
});

describe("addMaterialToVendor", () => {
  it("requires vendors.edit", async () => {
    h.user = user(["purchase_orders.create", "materials.view"]);
    await expect(addMaterialToVendor("v1", "m1")).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.vendorMaterial.createMany).not.toHaveBeenCalled();
  });

  it("is idempotent: re-adding an existing link succeeds, writes nothing more and logs nothing", async () => {
    h.user = user(["vendors.edit"]);
    h.prisma.material.findMany.mockResolvedValue([mat("m1")]);
    h.prisma.vendorMaterial.createMany.mockResolvedValue({ count: 0 }); // skipDuplicates hit

    await expect(addMaterialToVendor("v1", "m1")).resolves.toEqual([]);
    expect(h.prisma.vendor.update).not.toHaveBeenCalled();
    expect(h.prisma.activityLog.create).not.toHaveBeenCalled();
  });

  it("when a link IS created, it refreshes the mirror and logs", async () => {
    h.user = user(["vendors.edit"]);
    h.prisma.material.findMany.mockResolvedValue([mat("m1")]);
    h.prisma.vendorMaterial.createMany.mockResolvedValue({ count: 1 });
    // The vendor's state is read BEFORE the insert: already Sand + Cement.
    h.prisma.vendorMaterial.findMany.mockResolvedValueOnce([
      { material: { id: "m-sand", name: "Sand", deletedAt: null } },
      { material: { id: "m-cement", name: "Cement", deletedAt: null } },
    ]);

    await addMaterialToVendor("v1", "m1");

    // Existing names plus the newly linked one ("M1").
    expect(h.prisma.vendor.update.mock.calls[0][0].data).toEqual({
      materialsSupplied: ["Cement", "M1", "Sand"],
    });
    const entry = h.prisma.activityLog.create.mock.calls[0][0].data;
    expect(entry.meta.addedIds).toEqual(["m1"]);
    expect(entry.meta.removedCount).toBe(0);
  });

  it("rejects cross-company vendor and material ids identically", async () => {
    h.user = user(["vendors.edit"]);
    h.prisma.vendor.findFirst.mockResolvedValue(null);
    await expect(addMaterialToVendor("foreign-vendor", "m1")).rejects.toThrow("NOT_FOUND");

    h.prisma.vendor.findFirst.mockResolvedValue({ id: "v1" });
    h.prisma.material.findMany.mockResolvedValue([]);
    await expect(addMaterialToVendor("v1", "foreign-material")).rejects.toThrow("NOT_FOUND");
  });

  it("will not add a deactivated material", async () => {
    h.user = user(["vendors.edit"]);
    h.prisma.material.findMany.mockResolvedValue([mat("m1", { deletedAt: NOW })]);
    await expect(addMaterialToVendor("v1", "m1")).rejects.toThrow("MATERIAL_ARCHIVED");
  });
});
