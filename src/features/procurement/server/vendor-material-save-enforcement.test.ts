import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import { ALL_PERMISSIONS, type Permission } from "@/features/rbac/permissions";

/**
 * Saving a vendor together with its supplied materials.
 *
 * The vendor screens now send `materialIds` on createVendor / updateVendor, and
 * the server writes the vendor, its mappings and the legacy mirror in ONE
 * statement. These tests pin what that must never do: reach across tenants,
 * newly attach an archived material, mint a material from free text, or record
 * the same change twice in the audit trail.
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
    vendor: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    material: { findMany: vi.fn() },
    vendorMaterial: { findMany: vi.fn() },
    activityLog: { create: vi.fn() },
    purchaseOrder: { findMany: vi.fn() },
    vendorPayment: { findMany: vi.fn() },
    vendorFavorite: { findMany: vi.fn() },
    company: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/auth/current-user", () => ({
  requireUser: async () => {
    if (!h.user) throw new Error("UNAUTHENTICATED");
    return h.user;
  },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: h.prisma }));

import { createVendor, updateVendor } from "./actions";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const mat = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  deletedAt: null,
  ...over,
});
const VENDOR_ROW = {
  id: "v1",
  businessName: "Shree Building Supplies",
  contactPerson: null,
  phone: null,
  email: null,
  gstin: null,
  pan: null,
  address: null,
  materialsSupplied: [],
  paymentTerms: null,
  status: "ACTIVE",
  notes: null,
};

/** A vendor's CURRENT mappings, in the shape loadMappingState reads. */
const current = (...rows: [string, string, (Date | null)?][]) =>
  rows.map(([id, name, deletedAt = null]) => ({ material: { id, name, deletedAt } }));

const auditActions = () =>
  h.prisma.activityLog.create.mock.calls.map((c) => c[0].data.action as string);

beforeEach(() => {
  h.user = OWNER;
  Object.values(h.prisma).forEach((m) =>
    Object.values(m).forEach((f) => (f as ReturnType<typeof vi.fn>).mockReset()),
  );
  h.prisma.vendor.create.mockResolvedValue(VENDOR_ROW);
  h.prisma.vendor.update.mockResolvedValue(VENDOR_ROW);
  h.prisma.vendor.findFirst.mockResolvedValue({ id: "v1" });
  h.prisma.material.findMany.mockResolvedValue([]);
  h.prisma.vendorMaterial.findMany.mockResolvedValue([]);
  h.prisma.activityLog.create.mockResolvedValue({});
  h.prisma.purchaseOrder.findMany.mockResolvedValue([]);
  h.prisma.vendorPayment.findMany.mockResolvedValue([]);
  h.prisma.vendorFavorite.findMany.mockResolvedValue([]);
  h.prisma.company.findUnique.mockResolvedValue({ settings: {} });
});

describe("createVendor with materials", () => {
  it("creates the vendor and its mappings in the same write", async () => {
    h.prisma.material.findMany.mockResolvedValue([
      mat("m1", "OPC 53 Cement"),
      mat("m2", "Sand"),
    ]);
    await createVendor({ businessName: "Shree", materialIds: ["m1", "m2"] });

    expect(h.prisma.vendor.create).toHaveBeenCalledTimes(1);
    const data = h.prisma.vendor.create.mock.calls[0][0].data;
    expect(data.companyId).toBe("c1");
    expect(data.materials.createMany.data).toEqual([
      { companyId: "c1", materialId: "m1" },
      { companyId: "c1", materialId: "m2" },
    ]);
    // Legacy mirror derived from the mapping, not from anything typed.
    expect(data.materialsSupplied).toEqual(["OPC 53 Cement", "Sand"]);
  });

  it("resolves material ids under the caller's company only", async () => {
    h.prisma.material.findMany.mockResolvedValue([mat("m1", "Cement")]);
    await createVendor({ businessName: "Shree", materialIds: ["m1"] });
    expect(h.prisma.material.findMany.mock.calls[0][0].where).toMatchObject({
      id: { in: ["m1"] },
      companyId: "c1",
    });
  });

  it("rejects a foreign-company material without creating the vendor", async () => {
    h.prisma.material.findMany.mockResolvedValue([]); // scoped lookup finds nothing
    await expect(
      createVendor({ businessName: "Shree", materialIds: ["foreign"] }),
    ).rejects.toThrow("NOT_FOUND");
    // Resolved BEFORE writing, so no half-made vendor is left behind.
    expect(h.prisma.vendor.create).not.toHaveBeenCalled();
  });

  it("refuses to attach an archived material to a new vendor", async () => {
    h.prisma.material.findMany.mockResolvedValue([mat("m1", "Old", { deletedAt: NOW })]);
    await expect(
      createVendor({ businessName: "Shree", materialIds: ["m1"] }),
    ).rejects.toThrow("MATERIAL_ARCHIVED");
    expect(h.prisma.vendor.create).not.toHaveBeenCalled();
  });

  it("collapses a repeated id instead of duplicating the mapping", async () => {
    h.prisma.material.findMany.mockResolvedValue([mat("m1", "Cement")]);
    await createVendor({ businessName: "Shree", materialIds: ["m1", "m1"] });
    const data = h.prisma.vendor.create.mock.calls[0][0].data;
    expect(data.materials.createMany.data).toHaveLength(1);
    expect(data.materials.createMany.skipDuplicates).toBe(true);
  });

  it("allows a vendor with no materials, writing no mapping at all", async () => {
    await createVendor({ businessName: "Bare", materialIds: [] });
    const data = h.prisma.vendor.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("materials");
    expect(data.materialsSupplied).toEqual([]);
    expect(h.prisma.activityLog.create).not.toHaveBeenCalled();
  });

  it("logs the initial mappings once, as vendor.materials_updated", async () => {
    h.prisma.material.findMany.mockResolvedValue([mat("m1", "Cement"), mat("m2", "Sand")]);
    await createVendor({ businessName: "Shree", materialIds: ["m1", "m2"] });

    expect(auditActions()).toEqual(["vendor.materials_updated"]);
    const meta = h.prisma.activityLog.create.mock.calls[0][0].data.meta;
    expect(meta.addedIds).toEqual(["m1", "m2"]);
    expect(meta.removedCount).toBe(0);
  });

  it("an older client's unmatched free text is kept as text and never becomes a material", async () => {
    // Gate 0: an old app's names are now looked up (exact match only) — but a
    // name that matches nothing is still just kept, never minted.
    h.prisma.material.findMany.mockResolvedValue([]); // nothing in the master
    await createVendor({ businessName: "Legacy", materialsSupplied: ["mystery stuff"] });
    const data = h.prisma.vendor.create.mock.calls[0][0].data;
    expect(data.materialsSupplied).toEqual(["mystery stuff"]);
    expect(data).not.toHaveProperty("materials");
  });

  it("requires vendors.create", async () => {
    h.user = user(["vendors.view", "vendors.edit", "materials.create"]);
    await expect(createVendor({ businessName: "X", materialIds: [] })).rejects.toThrow("FORBIDDEN");
  });
});

describe("updateVendor with materials", () => {
  it("requires vendors.edit — material rights do not stand in for it", async () => {
    h.user = user(["vendors.view", "materials.view", "materials.create", "materials.edit"]);
    await expect(updateVendor("v1", { materialIds: ["m1"] })).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.vendor.update).not.toHaveBeenCalled();
  });

  it("treats a foreign vendor as NOT_FOUND rather than leaking a database error", async () => {
    h.prisma.vendor.findFirst.mockResolvedValue(null);
    await expect(updateVendor("foreign", { materialIds: [] })).rejects.toThrow("NOT_FOUND");
    expect(h.prisma.vendor.findFirst.mock.calls[0][0].where).toMatchObject({
      id: "foreign",
      companyId: "c1",
    });
    expect(h.prisma.vendor.update).not.toHaveBeenCalled();
  });

  it("replaces the mappings in the vendor's own update, and never writes materialIds as a column", async () => {
    h.prisma.vendorMaterial.findMany.mockResolvedValueOnce(current(["m-sand", "Sand"])); // current
    h.prisma.material.findMany.mockResolvedValue([
      mat("m-cement", "OPC 53 Cement"),
      mat("m-agg", "Aggregate 20mm"),
    ]);

    await updateVendor("v1", { businessName: "Shree", materialIds: ["m-cement", "m-agg"] });

    expect(h.prisma.vendor.update).toHaveBeenCalledTimes(1);
    const { where, data } = h.prisma.vendor.update.mock.calls[0][0];
    expect(where).toEqual({ id: "v1", companyId: "c1" });
    expect(data).not.toHaveProperty("materialIds");
    expect(data.businessName).toBe("Shree");
    expect(data.materials.deleteMany).toEqual({});
    expect(data.materials.createMany.data.map((r: { materialId: string }) => r.materialId)).toEqual([
      "m-cement",
      "m-agg",
    ]);
    expect(data.materialsSupplied).toEqual(["Aggregate 20mm", "OPC 53 Cement"]);
  });

  it("keeps a mapping to a material archived after it was mapped", async () => {
    h.prisma.vendorMaterial.findMany.mockResolvedValueOnce(current(["m-old", "Retired", NOW]));
    h.prisma.material.findMany.mockResolvedValue([mat("m-old", "Retired", { deletedAt: NOW })]);
    await expect(updateVendor("v1", { materialIds: ["m-old"] })).resolves.toBeTruthy();
  });

  it("but will not newly attach an archived one", async () => {
    h.prisma.vendorMaterial.findMany.mockResolvedValueOnce([]);
    h.prisma.material.findMany.mockResolvedValue([mat("m-old", "Retired", { deletedAt: NOW })]);
    await expect(updateVendor("v1", { materialIds: ["m-old"] })).rejects.toThrow("MATERIAL_ARCHIVED");
    expect(h.prisma.vendor.update).not.toHaveBeenCalled();
  });

  it("rejects a foreign material id", async () => {
    h.prisma.material.findMany.mockResolvedValue([]);
    await expect(updateVendor("v1", { materialIds: ["foreign"] })).rejects.toThrow("NOT_FOUND");
    expect(h.prisma.vendor.update).not.toHaveBeenCalled();
  });

  it("audits the field edit and the mapping change separately, never twice", async () => {
    h.prisma.vendorMaterial.findMany.mockResolvedValueOnce(current(["m-sand", "Sand"]));
    h.prisma.material.findMany.mockResolvedValue([mat("m-cement", "Cement")]);

    await updateVendor("v1", { businessName: "Shree", materialIds: ["m-cement"] });

    expect(auditActions()).toEqual(["vendor.updated", "vendor.materials_updated"]);
    const [updated, mapping] = h.prisma.activityLog.create.mock.calls.map((c) => c[0].data);
    // The mapping is its own event, so it is NOT also listed as a changed field.
    expect(updated.meta.fields).toEqual(["businessName"]);
    expect(mapping.meta.addedIds).toEqual(["m-cement"]);
    expect(mapping.meta.removedIds).toEqual(["m-sand"]);
  });

  it("writes no mapping event when the materials did not change", async () => {
    h.prisma.vendorMaterial.findMany.mockResolvedValueOnce(current(["m-cement", "Cement"]));
    h.prisma.material.findMany.mockResolvedValue([mat("m-cement", "Cement")]);
    await updateVendor("v1", { businessName: "Shree", materialIds: ["m-cement"] });
    expect(auditActions()).toEqual(["vendor.updated"]);
  });

  it("without materialIds, leaves the mappings entirely alone", async () => {
    await updateVendor("v1", { businessName: "Renamed" });
    const data = h.prisma.vendor.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("materials");
    expect(data).not.toHaveProperty("materialsSupplied");
    expect(h.prisma.material.findMany).not.toHaveBeenCalled();
  });

  it("returns the vendor with its canonical materials attached", async () => {
    h.prisma.vendorMaterial.findMany.mockResolvedValue([
      { vendorId: "v1", material: { id: "m1", name: "Cement", deletedAt: null, displayOrder: 0 } },
      { vendorId: "v1", material: { id: "m2", name: "Old", deletedAt: NOW, displayOrder: 1 } },
    ]);
    const v = await updateVendor("v1", { businessName: "Shree" });
    expect(v.materials).toEqual([
      { id: "m1", name: "Cement", isActive: true },
      { id: "m2", name: "Old", isActive: false },
    ]);
  });
});
