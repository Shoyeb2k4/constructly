import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import { ALL_PERMISSIONS, type Permission } from "@/features/rbac/permissions";

function user(permissions: Permission[]): SessionUser {
  return { id: "u1", email: "u@x.com", fullName: "U", role: "PROJECT_MANAGER", permissions, company: { id: "c1", name: "Co" } };
}
const OWNER = user([...ALL_PERMISSIONS]);

const h = vi.hoisted(() => ({
  user: null as SessionUser | null,
  prisma: {
    vendor: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    purchaseOrder: { findMany: vi.fn() },
    vendorPayment: { findMany: vi.fn() },
    vendorFavorite: { findMany: vi.fn() },
    company: { findUnique: vi.fn() },
    activityLog: { create: vi.fn() },
    vendorMaterial: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/auth/current-user", () => ({
  requireUser: async () => {
    if (!h.user) throw new Error("UNAUTHENTICATED");
    return h.user;
  },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: h.prisma }));

import { listVendors, createVendor, updateVendor, setVendorStatus } from "./actions";

const vendorRow = {
  id: "v1",
  businessName: "Acme",
  contactPerson: null,
  phone: null,
  email: null,
  gstin: null,
  pan: null,
  address: null,
  materialsSupplied: [],
  paymentTerms: null,
  status: "INACTIVE",
  notes: null,
};

beforeEach(() => {
  h.user = OWNER;
  Object.values(h.prisma).forEach((m) => Object.values(m).forEach((f) => (f as ReturnType<typeof vi.fn>).mockReset()));
  h.prisma.purchaseOrder.findMany.mockResolvedValue([]);
  h.prisma.vendorPayment.findMany.mockResolvedValue([]);
  h.prisma.vendorFavorite.findMany.mockResolvedValue([]);
  h.prisma.company.findUnique.mockResolvedValue({ settings: {} });
  h.prisma.vendor.update.mockResolvedValue(vendorRow);
  h.prisma.activityLog.create.mockResolvedValue({});
  h.prisma.vendorMaterial.findMany.mockResolvedValue([]);
});

describe("vendor view/create/edit gates", () => {
  it("listVendors requires vendors.view", async () => {
    h.user = user([]); // no vendors.view
    await expect(listVendors()).rejects.toThrow("FORBIDDEN");
  });

  it("createVendor requires vendors.create", async () => {
    h.user = user(["vendors.view"]);
    await expect(createVendor({ businessName: "New" })).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.vendor.create).not.toHaveBeenCalled();
  });

  it("updateVendor requires vendors.edit", async () => {
    h.user = user(["vendors.view"]);
    await expect(updateVendor("v1", { businessName: "X" })).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.vendor.update).not.toHaveBeenCalled();
  });
});

describe("lifecycle permissions ≠ edit", () => {
  it("vendors.edit alone cannot DEACTIVATE (archive) a vendor", async () => {
    h.user = user(["vendors.view", "vendors.edit"]); // no vendors.archive
    await expect(setVendorStatus("v1", "INACTIVE")).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.vendor.update).not.toHaveBeenCalled();
  });

  it("archive and restore are distinct: restore cannot deactivate", async () => {
    h.user = user(["vendors.view", "vendors.restore"]); // has restore, not archive
    await expect(setVendorStatus("v1", "INACTIVE")).rejects.toThrow("FORBIDDEN");
  });

  it("archive cannot reactivate (needs restore)", async () => {
    h.user = user(["vendors.view", "vendors.archive"]);
    await expect(setVendorStatus("v1", "ACTIVE")).rejects.toThrow("FORBIDDEN");
  });

  it("vendors.archive can deactivate — logs vendor.archived", async () => {
    h.user = user(["vendors.view", "vendors.archive"]);
    await setVendorStatus("v1", "INACTIVE");
    expect(h.prisma.vendor.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "v1", companyId: "c1" }, data: { status: "INACTIVE" } }),
    );
    expect(h.prisma.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "vendor.archived" }) }),
    );
  });

  it("a status change smuggled through updateVendor still needs the lifecycle permission", async () => {
    h.user = user(["vendors.view", "vendors.edit"]); // edit but not archive
    await expect(updateVendor("v1", { status: "INACTIVE" })).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.vendor.update).not.toHaveBeenCalled();
  });
});
