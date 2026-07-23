/**
 * Vendor edit — server-side validation and the activity-log entry.
 * Drives the real server action with Prisma + auth mocked (no DB touched).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth/current-user", () => ({
  requireUser: vi.fn(async () => ({
    id: "u-owner",
    email: "owner@acme.test",
    fullName: "Owner",
    role: "OWNER",
    company: { id: "company-A", name: "Acme Builders" },
  })),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    vendor: { update: vi.fn(), findMany: vi.fn() },
    activityLog: { create: vi.fn() },
    purchaseOrder: { findMany: vi.fn() },
    vendorPayment: { findMany: vi.fn() },
    vendorFavorite: { findMany: vi.fn() },
    company: { findUnique: vi.fn() },
  },
}));

import { prisma } from "@/lib/db/prisma";
import { updateVendor } from "./server/actions";

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>;

const VENDOR_ROW = {
  id: "vendor-1",
  businessName: "UltraTech Cement",
  contactPerson: "Rajesh Iyer",
  phone: "+919845011001",
  email: "sales@ultratech.test",
  gstin: "29AAACL1234M1Z5",
  pan: "AAACL1234M",
  address: "Peenya, Bengaluru",
  materialsSupplied: ["Cement"],
  paymentTerms: "30 days",
  status: "ACTIVE",
  notes: null,
};

function happyPathMocks() {
  db.vendor.update.mockResolvedValue(VENDOR_ROW);
  db.activityLog.create.mockResolvedValue({});
  db.purchaseOrder.findMany.mockResolvedValue([]);
  db.vendorPayment.findMany.mockResolvedValue([]);
  db.vendorFavorite.findMany.mockResolvedValue([]);
  db.company.findUnique.mockResolvedValue({ settings: {} });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("updateVendor", () => {
  it("saves an edit and records an activity log entry", async () => {
    happyPathMocks();

    await updateVendor("vendor-1", {
      businessName: "UltraTech Cement Ltd",
      contactPerson: "Rajesh Iyer",
      phone: "+919845011001",
      email: "sales@ultratech.test",
      gstin: "29AAACL1234M1Z5",
      address: "Peenya, Bengaluru",
      status: "INACTIVE",
    });

    expect(db.vendor.update).toHaveBeenCalledTimes(1);
    const updateArg = db.vendor.update.mock.calls[0][0] as {
      where: { id: string; companyId: string };
      data: { businessName: string; status: string };
    };
    // Scoped to the caller's tenant, and the edited fields are persisted.
    expect(updateArg.where).toMatchObject({ id: "vendor-1", companyId: "company-A" });
    expect(updateArg.data.businessName).toBe("UltraTech Cement Ltd");
    expect(updateArg.data.status).toBe("INACTIVE");

    expect(db.activityLog.create).toHaveBeenCalledTimes(1);
    const logArg = db.activityLog.create.mock.calls[0][0] as {
      data: { action: string; entityType: string; entityId: string; companyId: string };
    };
    expect(logArg.data.action).toBe("vendor.updated");
    expect(logArg.data.entityType).toBe("vendor");
    expect(logArg.data.entityId).toBe("vendor-1");
    expect(logArg.data.companyId).toBe("company-A");
  });

  it("rejects an invalid email before writing", async () => {
    happyPathMocks();
    await expect(
      updateVendor("vendor-1", { email: "not-an-email" }),
    ).rejects.toThrow();
    expect(db.vendor.update).not.toHaveBeenCalled();
    expect(db.activityLog.create).not.toHaveBeenCalled();
  });

  it("rejects a too-short business name before writing", async () => {
    happyPathMocks();
    await expect(updateVendor("vendor-1", { businessName: "A" })).rejects.toThrow();
    expect(db.vendor.update).not.toHaveBeenCalled();
  });

  it("rejects an unknown status before writing", async () => {
    happyPathMocks();
    await expect(
      updateVendor("vendor-1", { status: "ARCHIVED" as never }),
    ).rejects.toThrow();
    expect(db.vendor.update).not.toHaveBeenCalled();
  });
});
