import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import { ALL_PERMISSIONS, type Permission } from "@/features/rbac/permissions";
import type { CreatePOInput } from "../types";

/**
 * A purchase order is a commercial document. Two properties have to hold no
 * matter what the client sends:
 *
 *   the name on the line is the master's name, not whatever was posted; and
 *   an ordinary edit does not quietly strip the canonical reference off a line.
 *
 * The second is the subtle one — PO updates delete and recreate every line, so
 * materialId survives only because it is explicitly carried across.
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
    project: { findFirst: vi.fn() },
    vendor: { findFirst: vi.fn() },
    material: { findMany: vi.fn() },
    company: { findUnique: vi.fn() },
    purchaseOrder: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    pOLineItem: { deleteMany: vi.fn() },
    vendorPayment: { findMany: vi.fn() },
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

import { createPurchaseOrder, updatePurchaseOrder } from "./actions";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const mat = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  companyId: "c1",
  name,
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

const baseInput = (lines: CreatePOInput["lineItems"]): CreatePOInput => ({
  vendorId: "v1",
  projectId: "p1",
  purchaseDate: "2026-01-05",
  lineItems: lines,
});
const line = (over: Partial<CreatePOInput["lineItems"][number]> = {}) => ({
  material: "Free text cement",
  quantity: 10,
  unit: "bag",
  ratePaise: 40_000,
  gstRateBps: 1800,
  ...over,
});

/** The line rows create() / update() would have written. */
function writtenLines(call: { data: { lineItems: { create: unknown[] } } }) {
  return call.data.lineItems.create as Record<string, unknown>[];
}

beforeEach(() => {
  h.user = OWNER;
  Object.values(h.prisma).forEach((m) => {
    if (typeof m === "function") return;
    Object.values(m).forEach((f) => (f as ReturnType<typeof vi.fn>).mockReset());
  });
  h.prisma.$transaction.mockReset();
  h.prisma.$transaction.mockResolvedValue([]);
  h.prisma.project.findFirst.mockResolvedValue({ id: "p1" });
  h.prisma.vendor.findFirst.mockResolvedValue({ id: "v1" });
  h.prisma.material.findMany.mockResolvedValue([]);
  h.prisma.company.findUnique.mockResolvedValue({ settings: { poApprovalRequired: false } });
  h.prisma.purchaseOrder.findFirst.mockResolvedValue(null);
  h.prisma.purchaseOrder.create.mockResolvedValue({ id: "po1" });
  h.prisma.purchaseOrder.update.mockResolvedValue({ id: "po1" });
  h.prisma.vendorPayment.findMany.mockResolvedValue([]);
});

describe("createPurchaseOrder — legacy free text", () => {
  it("still accepts a line with only material text", async () => {
    // create/update end by re-reading the PO through getPurchaseOrder, which the
    // stubbed client cannot satisfy. The trailing rejection is swallowed on
    // purpose; every assertion below is on what was WRITTEN, and the tests that
    // care about refusals use `.rejects` instead, before any write happens.
    await createPurchaseOrder(baseInput([line()])).catch(() => {});

    const rows = writtenLines(h.prisma.purchaseOrder.create.mock.calls[0][0]);
    expect(rows[0].material).toBe("Free text cement");
    expect(rows[0].materialId).toBeNull();
    // No material lookup is even attempted when no line names one.
    expect(h.prisma.material.findMany).not.toHaveBeenCalled();
  });
});

describe("createPurchaseOrder — canonical material", () => {
  it("stores the master's name and ignores the client's text entirely", async () => {
    h.prisma.material.findMany.mockResolvedValue([mat("m1", "OPC 53 Cement")]);

    await createPurchaseOrder(
      baseInput([line({ materialId: "m1", material: "HACKED NAME" })]),
    ).catch(() => {});

    const rows = writtenLines(h.prisma.purchaseOrder.create.mock.calls[0][0]);
    expect(rows[0].material).toBe("OPC 53 Cement");
    expect(rows[0].materialId).toBe("m1");
  });

  it("resolves material ids under the caller's company only", async () => {
    h.prisma.material.findMany.mockResolvedValue([mat("m1", "Cement")]);
    await createPurchaseOrder(baseInput([line({ materialId: "m1" })])).catch(() => {});
    expect(h.prisma.material.findMany.mock.calls[0][0].where).toMatchObject({
      id: { in: ["m1"] },
      companyId: "c1",
    });
  });

  it("rejects a foreign material without revealing that it exists", async () => {
    h.prisma.material.findMany.mockResolvedValue([]); // scoped query finds nothing
    await expect(
      createPurchaseOrder(baseInput([line({ materialId: "foreign" })])),
    ).rejects.toThrow("NOT_FOUND");
    expect(h.prisma.purchaseOrder.create).not.toHaveBeenCalled();
  });

  it("rejects an unknown material id the same way", async () => {
    h.prisma.material.findMany.mockResolvedValue([]);
    await expect(createPurchaseOrder(baseInput([line({ materialId: "nope" })]))).rejects.toThrow(
      "NOT_FOUND",
    );
  });

  it("rejects a partially resolvable set — one bad id fails the whole order", async () => {
    h.prisma.material.findMany.mockResolvedValue([mat("m1", "Cement")]);
    await expect(
      createPurchaseOrder(
        baseInput([line({ materialId: "m1" }), line({ materialId: "foreign" })]),
      ),
    ).rejects.toThrow("NOT_FOUND");
    expect(h.prisma.purchaseOrder.create).not.toHaveBeenCalled();
  });

  it("will not let a NEW order use a deactivated material", async () => {
    h.prisma.material.findMany.mockResolvedValue([mat("m1", "Cement", { deletedAt: NOW })]);
    await expect(createPurchaseOrder(baseInput([line({ materialId: "m1" })]))).rejects.toThrow(
      "MATERIAL_ARCHIVED",
    );
    expect(h.prisma.purchaseOrder.create).not.toHaveBeenCalled();
  });

  it("does NOT require the vendor to supply the material", async () => {
    // The vendor mapping is a convenience catalogue. Requiring it would make the
    // planned "Other material" flow impossible.
    h.prisma.material.findMany.mockResolvedValue([mat("m1", "Cement")]);
    await createPurchaseOrder(baseInput([line({ materialId: "m1" })])).catch(() => {});

    expect(h.prisma.purchaseOrder.create).toHaveBeenCalled();
    // Nothing ever consults the mapping table.
    expect(h.prisma).not.toHaveProperty("vendorMaterial");
  });
});

describe("updatePurchaseOrder — materialId survives delete-and-recreate", () => {
  const draft = (lineMaterialIds: (string | null)[] = []) => ({
    status: "DRAFT",
    projectId: "p1",
    lineItems: lineMaterialIds.map((materialId) => ({ materialId })),
  });

  it("round-trips a materialId through the rebuild", async () => {
    h.prisma.purchaseOrder.findFirst.mockResolvedValue(draft(["m1"]));
    h.prisma.material.findMany.mockResolvedValue([mat("m1", "OPC 53 Cement")]);

    await updatePurchaseOrder("po1", baseInput([line({ materialId: "m1" })])).catch(() => {});

    const rows = writtenLines(h.prisma.purchaseOrder.update.mock.calls[0][0]);
    expect(rows[0].materialId).toBe("m1");
    expect(rows[0].material).toBe("OPC 53 Cement");
  });

  it("keeps a legacy free-text line valid on update", async () => {
    h.prisma.purchaseOrder.findFirst.mockResolvedValue(draft([null]));
    await updatePurchaseOrder("po1", baseInput([line()])).catch(() => {});

    const rows = writtenLines(h.prisma.purchaseOrder.update.mock.calls[0][0]);
    expect(rows[0].materialId).toBeNull();
    expect(rows[0].material).toBe("Free text cement");
  });

  it("lets an order keep a material archived AFTER it was raised", async () => {
    // The historical-edit rule: editing the notes on an old order must not be
    // blocked by a material retired since, and must not demote the line to text.
    h.prisma.purchaseOrder.findFirst.mockResolvedValue(draft(["m1"]));
    h.prisma.material.findMany.mockResolvedValue([mat("m1", "Retired Cement", { deletedAt: NOW })]);

    await updatePurchaseOrder("po1", baseInput([line({ materialId: "m1" })])).catch(() => {});

    const rows = writtenLines(h.prisma.purchaseOrder.update.mock.calls[0][0]);
    expect(rows[0].materialId).toBe("m1");
    expect(rows[0].material).toBe("Retired Cement");
  });

  it("still refuses to ADD a different archived material to that same order", async () => {
    h.prisma.purchaseOrder.findFirst.mockResolvedValue(draft(["m1"]));
    h.prisma.material.findMany.mockResolvedValue([
      mat("m1", "Retired Cement", { deletedAt: NOW }), // already on the order
      mat("m2", "Retired Sand", { deletedAt: NOW }), // newly added — not allowed
    ]);

    await expect(
      updatePurchaseOrder(
        "po1",
        baseInput([line({ materialId: "m1" }), line({ materialId: "m2" })]),
      ),
    ).rejects.toThrow("MATERIAL_ARCHIVED");
    expect(h.prisma.purchaseOrder.update).not.toHaveBeenCalled();
  });

  it("rejects a foreign material id on update too", async () => {
    h.prisma.purchaseOrder.findFirst.mockResolvedValue(draft([]));
    h.prisma.material.findMany.mockResolvedValue([]);
    await expect(
      updatePurchaseOrder("po1", baseInput([line({ materialId: "foreign" })])),
    ).rejects.toThrow("NOT_FOUND");
  });
});
