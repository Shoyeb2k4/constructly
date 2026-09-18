import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import { ALL_PERMISSIONS, type Permission } from "@/features/rbac/permissions";

/**
 * Pass 7 — server filter shapes. The canonical filters must query IDENTITY
 * (`POLineItem.materialId`, `VendorMaterial.materialId`), never snapshot text or
 * the legacy vendor mirror; the name forms are compatibility paths with an
 * exact, documented rule.
 */

function user(permissions: Permission[]): SessionUser {
  return { id: "u1", email: "u@x.com", fullName: "U", role: "PROJECT_MANAGER", permissions, company: { id: "c1", name: "Co" } };
}
const OWNER = user([...ALL_PERMISSIONS]);

const h = vi.hoisted(() => ({
  user: null as SessionUser | null,
  prisma: {
    vendor: { findMany: vi.fn() },
    purchaseOrder: { findMany: vi.fn() },
    pOLineItem: { findMany: vi.fn() },
    material: { findMany: vi.fn() },
    vendorPayment: { findMany: vi.fn() },
    vendorFavorite: { findMany: vi.fn() },
    company: { findUnique: vi.fn() },
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

import { listPurchaseOrders, listVendors, listUnlinkedMaterialNames } from "./actions";

const M1 = "90000000-0000-0000-0000-000000000001";

beforeEach(() => {
  h.user = OWNER;
  Object.values(h.prisma).forEach((m) => Object.values(m).forEach((f) => (f as ReturnType<typeof vi.fn>).mockReset()));
  h.prisma.purchaseOrder.findMany.mockResolvedValue([]);
  h.prisma.pOLineItem.findMany.mockResolvedValue([]);
  h.prisma.material.findMany.mockResolvedValue([]);
  h.prisma.vendor.findMany.mockResolvedValue([]);
  h.prisma.vendorPayment.findMany.mockResolvedValue([]);
  h.prisma.vendorFavorite.findMany.mockResolvedValue([]);
  h.prisma.company.findUnique.mockResolvedValue({ settings: {} });
  h.prisma.vendorMaterial.findMany.mockResolvedValue([]);
});

/** The `where` of the PO list query (the first purchaseOrder.findMany call). */
const poWhere = () => h.prisma.purchaseOrder.findMany.mock.calls[0][0].where;
const vendorWhere = () => h.prisma.vendor.findMany.mock.calls[0][0].where;
const json = (v: unknown) => JSON.stringify(v);

describe("PO list — material filter", () => {
  it("1/3. a canonical filter queries POLineItem.materialId — never the snapshot text", async () => {
    await listPurchaseOrders({ materialId: M1 });
    expect(poWhere().AND).toContainEqual({ lineItems: { some: { materialId: M1 } } });
    // Identity only: renaming the Material cannot change what this matches.
    expect(json(poWhere().AND)).not.toContain('"material":');
    expect(h.prisma.pOLineItem.findMany).not.toHaveBeenCalled();
  });

  it("2. similar names cannot cross-match: the filter is an id equality", async () => {
    await listPurchaseOrders({ materialId: M1 });
    expect(json(poWhere())).not.toContain("contains");
  });

  it("5/6. the recorded-name path (old ?material= links, older apps) matches normalized snapshot text exactly", async () => {
    h.prisma.pOLineItem.findMany.mockResolvedValue([
      { purchaseOrderId: "po-a", material: "cement" },
      { purchaseOrderId: "po-b", material: "  CEMENT  " },
      { purchaseOrderId: "po-c", material: "OPC Cement" }, // contains the word — must NOT match
      { purchaseOrderId: "po-a", material: "Cement" },
    ]);
    await listPurchaseOrders({ material: "Cement" });
    // One narrowing query, company-scoped.
    expect(h.prisma.pOLineItem.findMany).toHaveBeenCalledTimes(1);
    expect(h.prisma.pOLineItem.findMany.mock.calls[0][0].where).toMatchObject({
      purchaseOrder: { companyId: "c1" },
      material: { contains: "Cement", mode: "insensitive" },
    });
    expect(poWhere().AND).toContainEqual({ id: { in: ["po-a", "po-b"] } });
  });

  it("8. materialId wins over a name when both arrive — no second constraint, no name query", async () => {
    await listPurchaseOrders({ materialId: M1, material: "Cement" });
    expect(h.prisma.pOLineItem.findMany).not.toHaveBeenCalled();
    expect(poWhere().AND).toContainEqual({ lineItems: { some: { materialId: M1 } } });
    expect(json(poWhere().AND)).not.toContain('"in"');
  });

  it("12. an empty material filter produces no constraint", async () => {
    for (const f of [{}, { materialId: "ALL" }, { material: "ALL" }, { material: "  " }, { materialId: "" }]) {
      h.prisma.purchaseOrder.findMany.mockClear();
      await listPurchaseOrders(f);
      expect(poWhere().AND.filter((c: object) => Object.keys(c).length > 0), json(f)).toEqual([]);
    }
    expect(h.prisma.pOLineItem.findMany).not.toHaveBeenCalled();
  });

  it("composes with the category filter instead of overwriting it", async () => {
    await listPurchaseOrders({ materialId: M1, category: "Cement" });
    expect(poWhere().AND).toEqual(
      expect.arrayContaining([
        { lineItems: { some: { materialId: M1 } } },
        { lineItems: { some: { category: "Cement" } } },
      ]),
    );
  });

  it("free-text search also finds a renamed material by its CURRENT name", async () => {
    await listPurchaseOrders({ search: "OPC" });
    expect(poWhere().OR).toContainEqual({
      lineItems: { some: { materialRef: { name: { contains: "OPC", mode: "insensitive" } } } },
    });
  });
});

describe("vendor list — material filter and search", () => {
  it("9/10. filters through the VendorMaterial relation, not the legacy mirror", async () => {
    await listVendors({ materialId: M1 });
    expect(vendorWhere().AND).toContainEqual({ materials: { some: { materialId: M1 } } });
    expect(json(vendorWhere())).not.toContain("materialsSupplied");
  });

  it("11. search covers name, contact and MAPPED material names (relation, insensitive) — not the mirror", async () => {
    await listVendors({ search: "steel" });
    const search = vendorWhere().AND.find((c: { OR?: unknown }) => c.OR);
    expect(search.OR).toEqual([
      { businessName: { contains: "steel", mode: "insensitive" } },
      { contactPerson: { contains: "steel", mode: "insensitive" } },
      { materials: { some: { material: { name: { contains: "steel", mode: "insensitive" } } } } },
    ]);
    expect(json(vendorWhere())).not.toContain("materialsSupplied");
  });

  it("older apps' name filter: a mapped Material by normalized name (archived too), or an unmapped legacy name", async () => {
    h.prisma.material.findMany.mockResolvedValue([
      { id: M1, name: "Cement" },
      { id: "m-old", name: "cement " }, // an archived one with the same normalized name
      { id: "m-x", name: "OPC Cement" },
    ]);
    await listVendors({ material: "CEMENT" });
    expect(h.prisma.material.findMany.mock.calls[0][0].where).toEqual({ companyId: "c1" });
    const where = vendorWhere().AND[0];
    expect(where.OR).toEqual([
      { materials: { some: { materialId: { in: [M1, "m-old"] } } } },
      { materialsSupplied: { hasSome: ["CEMENT"] } },
    ]);
  });

  it("material filter and search combine (AND), neither overwriting the other", async () => {
    await listVendors({ materialId: M1, search: "acme" });
    expect(vendorWhere().AND).toHaveLength(2);
  });
});

describe("unlinked recorded names (filter options for older orders)", () => {
  it("reads unlinked lines only, company-scoped, one DISTINCT query, deduped by normalized name", async () => {
    h.prisma.pOLineItem.findMany.mockResolvedValue([{ material: "cement" }, { material: "Cement" }, { material: "Wall Putty" }]);
    await expect(listUnlinkedMaterialNames()).resolves.toEqual(["Cement", "Wall Putty"]);
    expect(h.prisma.pOLineItem.findMany).toHaveBeenCalledTimes(1);
    expect(h.prisma.pOLineItem.findMany.mock.calls[0][0]).toMatchObject({
      where: { materialId: null, purchaseOrder: { companyId: "c1" } },
      distinct: ["material"],
    });
  });

  it("respects the PO list's project scope for users without view_all", async () => {
    h.user = user(["purchase_orders.view"]);
    await listUnlinkedMaterialNames();
    expect(h.prisma.pOLineItem.findMany.mock.calls[0][0].where.purchaseOrder).toEqual({
      companyId: "c1",
      project: { pmId: "u1" },
    });
  });

  it("requires purchase_orders.view", async () => {
    h.user = user([]);
    await expect(listUnlinkedMaterialNames()).rejects.toThrow("FORBIDDEN");
  });
});
