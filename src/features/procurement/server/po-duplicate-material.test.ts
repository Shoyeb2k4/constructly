import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import { ALL_PERMISSIONS } from "@/features/rbac/permissions";

/**
 * Duplicate vs Revise and archived materials.
 *
 * A DUPLICATE is a new order. Carrying an archived material's id onto it would
 * let a retired material be re-ordered — and the id would then be grandfathered
 * on every later save of the copy. So the duplicate keeps the line and its name
 * but drops that id. A REVISE amends the SAME order and keeps what was ordered.
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
    purchaseOrder: { findFirstOrThrow: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    project: { findFirst: vi.fn() },
    material: { findMany: vi.fn() },
    vendorPayment: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/auth/current-user", () => ({ requireUser: async () => OWNER }));
vi.mock("@/lib/db/prisma", () => ({ prisma: h.prisma }));

import { duplicatePurchaseOrder, revisePurchaseOrder } from "./actions";

const SOURCE = {
  id: "po1",
  vendorId: "v1",
  projectId: "p1",
  purchaseDate: new Date("2026-01-01"),
  expectedDelivery: null,
  notes: null,
  subtotalPaise: BigInt(0),
  gstPaise: BigInt(0),
  totalPaise: BigInt(0),
  lineItems: [
    { material: "Cement", materialId: "m-live", category: null, quantity: 1, unit: "bag", ratePaise: 1, gstRateBps: 0, gstPaise: BigInt(0), amountPaise: BigInt(1), sortOrder: 0 },
    { material: "Retired Primer", materialId: "m-old", category: null, quantity: 1, unit: "litre", ratePaise: 1, gstRateBps: 0, gstPaise: BigInt(0), amountPaise: BigInt(1), sortOrder: 1 },
    { material: "Free text", materialId: null, category: null, quantity: 1, unit: "nos", ratePaise: 1, gstRateBps: 0, gstPaise: BigInt(0), amountPaise: BigInt(1), sortOrder: 2 },
  ],
};

const createdLines = () =>
  h.prisma.purchaseOrder.create.mock.calls[0][0].data.lineItems.create as {
    material: string;
    materialId: string | null;
  }[];

beforeEach(() => {
  Object.values(h.prisma).forEach((m) =>
    Object.values(m).forEach((f) => (f as ReturnType<typeof vi.fn>).mockReset()),
  );
  h.prisma.purchaseOrder.findFirstOrThrow.mockResolvedValue(SOURCE);
  h.prisma.purchaseOrder.findFirst.mockResolvedValue(null); // nextPoNumber + final read
  h.prisma.purchaseOrder.create.mockResolvedValue({ id: "po2" });
  h.prisma.project.findFirst.mockResolvedValue({ id: "p1" });
  // Only m-old is archived (the query asks for archived ones).
  h.prisma.material.findMany.mockResolvedValue([{ id: "m-old" }]);
  h.prisma.vendorPayment.findMany.mockResolvedValue([]);
});

describe("duplicating an order", () => {
  it("keeps an ACTIVE material's id and name", async () => {
    await duplicatePurchaseOrder("po1").catch(() => {});
    expect(createdLines()[0]).toMatchObject({ material: "Cement", materialId: "m-live" });
  });

  it("drops an ARCHIVED material's id but keeps the line and its name", async () => {
    await duplicatePurchaseOrder("po1").catch(() => {});
    expect(createdLines()[1]).toMatchObject({ material: "Retired Primer", materialId: null });
    expect(createdLines()).toHaveLength(3);
  });

  it("asks about archived status only within the caller's company", async () => {
    await duplicatePurchaseOrder("po1").catch(() => {});
    expect(h.prisma.material.findMany.mock.calls[0][0].where).toMatchObject({
      id: { in: ["m-live", "m-old"] },
      companyId: "c1",
      deletedAt: { not: null },
    });
  });

  it("leaves a legacy free-text line exactly as it was", async () => {
    await duplicatePurchaseOrder("po1").catch(() => {});
    expect(createdLines()[2]).toMatchObject({ material: "Free text", materialId: null });
  });
});

describe("revising an order", () => {
  it("keeps every id, archived included — it is the same order", async () => {
    await revisePurchaseOrder("po1").catch(() => {});
    expect(createdLines().map((l) => l.materialId)).toEqual(["m-live", "m-old", null]);
    expect(h.prisma.material.findMany).not.toHaveBeenCalled();
  });
});
