import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import { ALL_PERMISSIONS } from "@/features/rbac/permissions";

const OWNER: SessionUser = {
  id: "o1",
  email: "o@x.com",
  fullName: "Owner",
  role: "OWNER",
  permissions: [...ALL_PERMISSIONS], // includes approve + view_all + edit_all
  company: { id: "c1", name: "Co" },
};
// Legacy PM: raises + edits draft POs on assigned projects; no approve/delete.
const PM: SessionUser = {
  id: "pm1",
  email: "pm@x.com",
  fullName: "PM",
  role: "PROJECT_MANAGER",
  permissions: ["purchase_orders.view", "purchase_orders.create", "purchase_orders.edit"],
  company: { id: "c1", name: "Co" },
};
const VIEWER: SessionUser = { ...PM, id: "v1", permissions: ["purchase_orders.view"] };

const h = vi.hoisted(() => ({
  user: null as SessionUser | null,
  prisma: {
    purchaseOrder: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    vendorPayment: { findMany: vi.fn() },
    project: { findFirst: vi.fn() },
    vendor: { findFirst: vi.fn() },
    activityLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth/current-user", () => ({
  requireUser: async () => {
    if (!h.user) throw new Error("UNAUTHENTICATED");
    return h.user;
  },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: h.prisma }));

import {
  listPurchaseOrders,
  getPurchaseOrder,
  createPurchaseOrder,
  updatePurchaseOrder,
  approvePurchaseOrder,
  deletePurchaseOrder,
} from "./actions";
import type { CreatePOInput } from "../types";

const poRow = {
  id: "po1",
  poNumber: "PO-0001",
  status: "SUBMITTED" as const,
  purchaseDate: new Date("2026-01-01"),
  expectedDelivery: null,
  subtotalPaise: BigInt(0),
  gstPaise: BigInt(0),
  totalPaise: BigInt(0),
  invoiceNumber: null,
  vendorId: "v1",
  projectId: "p1",
  createdById: "o1",
  createdAt: new Date("2026-01-01"),
  vendor: { businessName: "Acme" },
  project: { name: "Villa", code: "PRJ-1" },
};

const validInput: CreatePOInput = {
  vendorId: "v1",
  projectId: "p1",
  purchaseDate: "2026-01-01",
  lineItems: [{ material: "Cement", quantity: 1, unit: "bag", ratePaise: 100, gstRateBps: 0 }],
};

beforeEach(() => {
  h.user = OWNER;
  Object.values(h.prisma).forEach((m) => {
    if (typeof m === "object") Object.values(m).forEach((f) => (f as ReturnType<typeof vi.fn>).mockReset?.());
  });
  h.prisma.vendorPayment.findMany.mockResolvedValue([]);
  h.prisma.purchaseOrder.findMany.mockResolvedValue([]);
});

describe("approvePurchaseOrder — dedicated approval permission", () => {
  it("blocks a Project Manager (has edit, but NOT purchase_orders.approve)", async () => {
    h.user = PM;
    await expect(approvePurchaseOrder("po1")).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.purchaseOrder.update).not.toHaveBeenCalled();
  });

  it("allows a user holding purchase_orders.approve", async () => {
    h.user = OWNER;
    h.prisma.purchaseOrder.update.mockResolvedValue(poRow);
    await approvePurchaseOrder("po1");
    expect(h.prisma.purchaseOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "APPROVED" }) }),
    );
  });
});

describe("createPurchaseOrder — permission + project ownership", () => {
  it("blocks a view-only user (no purchase_orders.create)", async () => {
    h.user = VIEWER;
    await expect(createPurchaseOrder(validInput)).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.purchaseOrder.create).not.toHaveBeenCalled();
  });

  it("blocks a PM raising a PO on a project NOT assigned to them (ownership)", async () => {
    h.user = PM;
    h.prisma.project.findFirst.mockResolvedValue(null); // not the assigned PM ⇒ no access
    await expect(createPurchaseOrder(validInput)).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: "c1", pmId: "pm1" }) }),
    );
    expect(h.prisma.purchaseOrder.create).not.toHaveBeenCalled();
  });
});

describe("updatePurchaseOrder — draft rule vs edit_all", () => {
  it("a PM (no edit_all) cannot edit a SUBMITTED PO → IMMUTABLE", async () => {
    h.user = PM;
    h.prisma.purchaseOrder.findFirst.mockResolvedValue({ status: "SUBMITTED", projectId: "p1" });
    h.prisma.project.findFirst.mockResolvedValue({ id: "p1" }); // assigned (access ok)
    h.prisma.vendor.findFirst.mockResolvedValue({ id: "v1" });
    await expect(updatePurchaseOrder("po1", validInput)).rejects.toThrow("IMMUTABLE");
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("deletePurchaseOrder — delete permission", () => {
  it("blocks a Project Manager (no purchase_orders.delete)", async () => {
    h.user = PM;
    await expect(deletePurchaseOrder("po1")).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.purchaseOrder.findFirst).not.toHaveBeenCalled();
  });
});

describe("view scope (assignment)", () => {
  it("scopes a PM (no view_all) to POs on their assigned projects", async () => {
    h.user = PM;
    await listPurchaseOrders();
    const where = h.prisma.purchaseOrder.findMany.mock.calls[0][0].where;
    expect(where.companyId).toBe("c1");
    expect(where.project).toEqual({ pmId: "pm1" });
  });

  it("an Owner (view_all) sees all company POs (no project scope)", async () => {
    h.user = OWNER;
    await listPurchaseOrders();
    const where = h.prisma.purchaseOrder.findMany.mock.calls[0][0].where;
    expect(where.project).toBeUndefined();
  });

  it("getPurchaseOrder applies the same assignment scope for a PM", async () => {
    h.user = PM;
    h.prisma.purchaseOrder.findFirst.mockResolvedValue(null);
    await getPurchaseOrder("po1");
    const where = h.prisma.purchaseOrder.findFirst.mock.calls[0][0].where;
    expect(where.project).toEqual({ pmId: "pm1" });
  });
});
