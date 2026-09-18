import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import { ALL_PERMISSIONS, type Permission } from "@/features/rbac/permissions";

/**
 * The material master is company-wide data every purchase order is raised
 * against. Two failure modes matter more than the rest and are both easy to
 * introduce by accident:
 *
 *   - locking a PO creator out of the catalogue they must pick from, and
 *   - letting the ability to raise an order become the ability to reshape it.
 *
 * Everything below exists to keep those apart.
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
    material: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    vendor: { findMany: vi.fn(), findFirst: vi.fn() },
    company: { findUnique: vi.fn() },
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

import {
  listMaterialMaster,
  listMaterials,
  getMaterial,
  createMaterial,
  updateMaterial,
  setMaterialArchived,
} from "./actions";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const row = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "m1",
  companyId: "c1",
  name: "Cement",
  category: "Cement",
  defaultUnit: "bag",
  hsnCode: null,
  displayOrder: 0,
  deletedAt: null,
  deletedById: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

beforeEach(() => {
  h.user = OWNER;
  Object.values(h.prisma).forEach((m) =>
    Object.values(m).forEach((f) => (f as ReturnType<typeof vi.fn>).mockReset()),
  );
  h.prisma.material.findMany.mockResolvedValue([]);
  h.prisma.material.findFirst.mockResolvedValue(null);
  h.prisma.material.count.mockResolvedValue(0);
  h.prisma.material.create.mockResolvedValue(row());
  h.prisma.material.update.mockResolvedValue(row());
  h.prisma.vendor.findMany.mockResolvedValue([]);
  h.prisma.company.findUnique.mockResolvedValue({
    settings: { materialCategories: ["Cement", "Steel", "Tiles"] },
  });
  h.prisma.activityLog.create.mockResolvedValue({});
});

describe("reading the catalogue for selection", () => {
  it("a user with materials.view can list", async () => {
    h.user = user(["materials.view"]);
    await expect(listMaterialMaster()).resolves.toEqual([]);
  });

  it("a PO creator WITHOUT materials.view can still read material options", async () => {
    // The regression this whole permission set exists to prevent: a Project
    // Manager blocked mid-order by a master-data permission.
    h.user = user(["purchase_orders.create"]);
    await expect(listMaterialMaster()).resolves.toEqual([]);
    await expect(listMaterials()).resolves.toEqual([]);
    await expect(getMaterial("m1")).resolves.toBeNull();
  });

  it("someone who can only VIEW purchase orders can too — the list filter needs it", async () => {
    h.user = user(["purchase_orders.view"]);
    await expect(listMaterialMaster()).resolves.toEqual([]);
  });

  it("a vendors.view holder keeps the access listMaterials always had", async () => {
    h.user = user(["vendors.view"]);
    await expect(listMaterials()).resolves.toEqual([]);
  });

  it("a user with none of those permissions is refused", async () => {
    h.user = user(["attendance.mark", "projects.view"]);
    await expect(listMaterialMaster()).rejects.toThrow("FORBIDDEN");
    await expect(listMaterials()).rejects.toThrow("FORBIDDEN");
    await expect(getMaterial("m1")).rejects.toThrow("FORBIDDEN");
  });

  it("hides deactivated materials unless they are asked for", async () => {
    h.user = user(["materials.view"]);
    await listMaterialMaster();
    expect(h.prisma.material.findMany.mock.calls[0][0].where.deletedAt).toBeNull();

    h.prisma.material.findMany.mockClear();
    await listMaterialMaster({ includeArchived: true });
    expect(h.prisma.material.findMany.mock.calls[0][0].where).not.toHaveProperty("deletedAt");
  });

  it("getMaterial resolves an archived material, so history can still read it", async () => {
    h.user = user(["materials.view"]);
    h.prisma.material.findFirst.mockResolvedValue(row({ deletedAt: NOW }));
    const m = await getMaterial("m1");
    expect(m?.isActive).toBe(false);
    // No deletedAt / companyId / deletedById leaks into the DTO.
    expect(Object.keys(m!).sort()).toEqual([
      "category", "createdAt", "defaultUnit", "displayOrder", "hsnCode",
      "id", "isActive", "name", "updatedAt",
    ]);
  });

  it("listMaterials unions master names with legacy vendor strings", async () => {
    // The transitional contract: dropping a legacy spelling would make those
    // vendors unreachable through the existing filters.
    h.user = user(["vendors.view"]);
    h.prisma.material.findMany.mockResolvedValue([{ name: "Cement" }, { name: "TMT Steel" }]);
    h.prisma.vendor.findMany.mockResolvedValue([
      { materialsSupplied: ["cement", "Binding Wire"] },
      { materialsSupplied: ["Cement"] },
    ]);
    await expect(listMaterials()).resolves.toEqual(["Binding Wire", "Cement", "TMT Steel", "cement"]);
  });
});

describe("reading never implies managing", () => {
  it("purchase_orders.create cannot create, edit or archive a material", async () => {
    h.user = user(["purchase_orders.create", "purchase_orders.edit"]);
    await expect(createMaterial({ name: "X" })).rejects.toThrow("FORBIDDEN");
    await expect(updateMaterial("m1", { name: "X" })).rejects.toThrow("FORBIDDEN");
    await expect(setMaterialArchived("m1", true)).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.material.create).not.toHaveBeenCalled();
    expect(h.prisma.material.update).not.toHaveBeenCalled();
  });

  it("each management verb needs its own permission", async () => {
    h.user = user(["materials.view", "materials.create"]);
    await expect(updateMaterial("m1", { name: "X" })).rejects.toThrow("FORBIDDEN");
    await expect(setMaterialArchived("m1", true)).rejects.toThrow("FORBIDDEN");

    h.user = user(["materials.edit"]);
    await expect(createMaterial({ name: "X" })).rejects.toThrow("FORBIDDEN");
    await expect(setMaterialArchived("m1", true)).rejects.toThrow("FORBIDDEN");
  });
});

describe("createMaterial", () => {
  it("requires materials.create", async () => {
    h.user = user([]);
    await expect(createMaterial({ name: "Cement" })).rejects.toThrow("FORBIDDEN");
  });

  it("trims the name and binds the record to the caller's company", async () => {
    h.user = user(["materials.create"]);
    await createMaterial({ name: "  Cement  ", category: "Cement", defaultUnit: "bag" });
    const data = h.prisma.material.create.mock.calls[0][0].data;
    expect(data.name).toBe("Cement");
    expect(data.companyId).toBe("c1");
  });

  it("rejects a duplicate active name case-insensitively", async () => {
    h.user = user(["materials.create"]);
    h.prisma.material.findFirst.mockResolvedValue({ id: "other" });
    await expect(createMaterial({ name: "cement" })).rejects.toThrow("MATERIAL_NAME_TAKEN");
    expect(h.prisma.material.create).not.toHaveBeenCalled();
    // The lookup itself must be insensitive, not just the fixture.
    expect(h.prisma.material.findFirst.mock.calls[0][0].where.name).toEqual({
      equals: "cement",
      mode: "insensitive",
    });
  });

  it("turns the database's unique-index violation into the same domain error", async () => {
    // The pre-check can lose a race; the partial unique index is the authority.
    h.user = user(["materials.create"]);
    const { Prisma } = await import("@/generated/prisma");
    h.prisma.material.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "6" }),
    );
    await expect(createMaterial({ name: "Cement" })).rejects.toThrow("MATERIAL_NAME_TAKEN");
  });

  it("accepts a unit from the canonical list and rejects anything else", async () => {
    h.user = user(["materials.create"]);
    await expect(createMaterial({ name: "Sand", defaultUnit: "brass" })).resolves.toBeTruthy();
    await expect(createMaterial({ name: "Sand", defaultUnit: "truckload" })).rejects.toThrow(
      "INVALID_UNIT",
    );
  });

  it("rejects a category that is not in the company's list", async () => {
    h.user = user(["materials.create"]);
    await expect(createMaterial({ name: "Sand", category: "Imaginary" })).rejects.toThrow(
      "INVALID_CATEGORY",
    );
    await expect(createMaterial({ name: "Sand", category: "Steel" })).resolves.toBeTruthy();
    await expect(createMaterial({ name: "Sand", category: null })).resolves.toBeTruthy();
  });

  it("logs the creation", async () => {
    h.user = user(["materials.create"]);
    await createMaterial({ name: "Cement" });
    expect(h.prisma.activityLog.create.mock.calls[0][0].data.action).toBe("material.created");
  });
});

describe("updateMaterial", () => {
  it("requires materials.edit", async () => {
    h.user = user(["materials.view"]);
    await expect(updateMaterial("m1", { name: "X" })).rejects.toThrow("FORBIDDEN");
  });

  it("treats a material from another company as NOT_FOUND", async () => {
    h.user = user(["materials.edit"]);
    h.prisma.material.findFirst.mockResolvedValue(null); // scoped query finds nothing
    await expect(updateMaterial("foreign", { name: "X" })).rejects.toThrow("NOT_FOUND");
    // The lookup was company-scoped, so existence elsewhere is never revealed.
    expect(h.prisma.material.findFirst.mock.calls[0][0].where).toMatchObject({
      id: "foreign",
      companyId: "c1",
    });
    expect(h.prisma.material.update).not.toHaveBeenCalled();
  });

  it("never lets a patch move a material to another tenant", async () => {
    h.user = user(["materials.edit"]);
    // First call resolves the target; second is the name-availability check.
    h.prisma.material.findFirst.mockResolvedValueOnce(row()).mockResolvedValueOnce(null);
    await updateMaterial("m1", { name: "Cement OPC" } as never);
    expect(h.prisma.material.update.mock.calls[0][0].data).not.toHaveProperty("companyId");
  });

  it("keeps a category that Settings has since dropped, so the record stays editable", async () => {
    h.user = user(["materials.edit"]);
    h.prisma.material.findFirst.mockResolvedValue(row({ category: "Retired" }));
    // "Retired" is no longer in the company list, but it is this record's own
    // value — editing the unit must not be blocked by it.
    await expect(
      updateMaterial("m1", { category: "Retired", defaultUnit: "kg" }),
    ).resolves.toBeTruthy();
    // A DIFFERENT unlisted category is still refused.
    h.prisma.material.findFirst.mockResolvedValue(row({ category: "Retired" }));
    await expect(updateMaterial("m1", { category: "Imaginary" })).rejects.toThrow(
      "INVALID_CATEGORY",
    );
  });

  it("does not touch purchase order line snapshots when renaming", async () => {
    h.user = user(["materials.edit"]);
    h.prisma.material.findFirst.mockResolvedValueOnce(row()).mockResolvedValueOnce(null);
    await updateMaterial("m1", { name: "OPC 53 Cement" });
    // The ONLY write is to this material row. A PO line's frozen `material`
    // text is never rewritten — there is no pOLineItem client here to call.
    expect(h.prisma).not.toHaveProperty("pOLineItem");
    expect(h.prisma.material.update).toHaveBeenCalledTimes(1);
    expect(h.prisma.material.update.mock.calls[0][0].where).toEqual({ id: "m1" });
  });

  it("logs which fields changed", async () => {
    h.user = user(["materials.edit"]);
    h.prisma.material.findFirst.mockResolvedValue(row());
    await updateMaterial("m1", { defaultUnit: "kg" });
    const entry = h.prisma.activityLog.create.mock.calls[0][0].data;
    expect(entry.action).toBe("material.updated");
    expect(entry.meta.fields).toEqual(["defaultUnit"]);
  });
});

describe("setMaterialArchived", () => {
  it("requires materials.archive in BOTH directions", async () => {
    h.user = user(["materials.view", "materials.create", "materials.edit"]);
    await expect(setMaterialArchived("m1", true)).rejects.toThrow("FORBIDDEN");
    await expect(setMaterialArchived("m1", false)).rejects.toThrow("FORBIDDEN");
  });

  it("deactivates rather than deleting, so history keeps resolving", async () => {
    h.user = user(["materials.archive"]);
    h.prisma.material.findFirst.mockResolvedValue(row());
    h.prisma.material.update.mockResolvedValue(row({ deletedAt: NOW }));

    const m = await setMaterialArchived("m1", true);

    expect(m.isActive).toBe(false);
    const data = h.prisma.material.update.mock.calls[0][0].data;
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(data.deletedById).toBe("u1");
    // Nothing anywhere near a delete.
    expect(h.prisma.material).not.toHaveProperty("delete");
    expect(h.prisma.material).not.toHaveProperty("deleteMany");
  });

  it("restores by clearing the deactivation", async () => {
    h.user = user(["materials.archive"]);
    h.prisma.material.findFirst.mockResolvedValueOnce(row({ deletedAt: NOW })).mockResolvedValueOnce(null);
    await setMaterialArchived("m1", false);
    expect(h.prisma.material.update.mock.calls[0][0].data).toEqual({
      deletedAt: null,
      deletedById: null,
    });
  });

  it("refuses to restore onto a name another active material has taken", async () => {
    h.user = user(["materials.archive"]);
    h.prisma.material.findFirst
      .mockResolvedValueOnce(row({ deletedAt: NOW })) // the target
      .mockResolvedValueOnce({ id: "m2" }); // a live namesake
    await expect(setMaterialArchived("m1", false)).rejects.toThrow("MATERIAL_NAME_TAKEN");
  });

  it("treats a foreign id as NOT_FOUND", async () => {
    h.user = user(["materials.archive"]);
    h.prisma.material.findFirst.mockResolvedValue(null);
    await expect(setMaterialArchived("foreign", true)).rejects.toThrow("NOT_FOUND");
  });

  it("logs archive and restore distinctly", async () => {
    h.user = user(["materials.archive"]);
    h.prisma.material.findFirst.mockResolvedValue(row());
    await setMaterialArchived("m1", true);
    expect(h.prisma.activityLog.create.mock.calls[0][0].data.action).toBe("material.archived");

    h.prisma.activityLog.create.mockClear();
    h.prisma.material.findFirst.mockResolvedValue(row({ deletedAt: null }));
    await setMaterialArchived("m1", false);
    expect(h.prisma.activityLog.create.mock.calls[0][0].data.action).toBe("material.restored");
  });
});
