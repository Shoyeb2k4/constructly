/**
 * Category / subcategory deletion guards + Owner Force Delete.
 *
 * Normal delete: a category/type is deletable only when it has NEITHER recorded
 * attendance (history) NOR project-contractor rates (config). Owner Force Delete
 * is the ultimate-authority path: it SOFT-deletes (deactivates) a referenced
 * group/type — removing only pure config — so attendance/financial history is
 * never destroyed. Owner-only, typed-DELETE confirmation, audited.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { Permission } from "@/features/rbac/permissions";

const u = (permissions: Permission[], isOwner = false): SessionUser => ({
  id: "u1",
  email: "u@x.com",
  fullName: "U",
  role: isOwner ? "OWNER" : "PROJECT_MANAGER",
  permissions,
  isOwner,
  company: { id: "c1", name: "Co" },
});

const h = vi.hoisted(() => ({
  user: null as SessionUser | null,
  prisma: {
    labourAttendance: { count: vi.fn(), findMany: vi.fn() },
    projectContractorLabourRate: { count: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
    projectContractorAssignment: { count: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
    contractorSettlement: { count: vi.fn() },
    labourCategory: { delete: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
    labourSubcategory: {
      delete: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    activityLog: { create: vi.fn() },
    $queryRaw: vi.fn(),
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
  deleteCategory,
  deleteSubcategory,
  forceDeleteCategory,
  forceDeleteSubcategory,
  forceDeletePreview,
} from "./actions";

beforeEach(() => {
  h.user = u(["labour.view", "labour.archive"]);
  h.prisma.labourAttendance.count.mockReset().mockResolvedValue(0);
  h.prisma.labourAttendance.findMany.mockReset().mockResolvedValue([]);
  h.prisma.projectContractorLabourRate.count.mockReset().mockResolvedValue(0);
  h.prisma.projectContractorLabourRate.findMany.mockReset().mockResolvedValue([]);
  h.prisma.projectContractorLabourRate.deleteMany.mockReset().mockResolvedValue({ count: 0 });
  h.prisma.projectContractorAssignment.count.mockReset().mockResolvedValue(0);
  h.prisma.projectContractorAssignment.findMany.mockReset().mockResolvedValue([]);
  h.prisma.projectContractorAssignment.deleteMany.mockReset().mockResolvedValue({ count: 0 });
  h.prisma.contractorSettlement.count.mockReset().mockResolvedValue(0);
  h.prisma.labourCategory.delete.mockReset().mockResolvedValue({ id: "cat1" });
  h.prisma.labourCategory.update.mockReset().mockResolvedValue({ id: "cat1" });
  h.prisma.labourCategory.findFirst.mockReset().mockResolvedValue({ name: "Civil" });
  h.prisma.labourSubcategory.delete.mockReset().mockResolvedValue({ id: "sub1" });
  h.prisma.labourSubcategory.update.mockReset().mockResolvedValue({ id: "sub1" });
  h.prisma.labourSubcategory.updateMany.mockReset().mockResolvedValue({ count: 0 });
  h.prisma.labourSubcategory.findMany.mockReset().mockResolvedValue([{ id: "sub1" }]);
  h.prisma.labourSubcategory.findFirst.mockReset().mockResolvedValue({ name: "Mason" });
  h.prisma.activityLog.create.mockReset().mockResolvedValue({ id: "log1" });
  // Locks return the target row (found); callback transaction runs on the mock.
  h.prisma.$queryRaw.mockReset().mockResolvedValue([{ id: "cat1", name: "Civil" }]);
  h.prisma.$transaction
    .mockReset()
    .mockImplementation(async (fn: (tx: unknown) => unknown) => fn(h.prisma));
});

describe("deleteCategory", () => {
  it("blocks a category with recorded attendance (history preserved)", async () => {
    h.prisma.labourAttendance.count.mockResolvedValue(3);
    await expect(deleteCategory("cat1")).rejects.toThrow("CATEGORY_HAS_ATTENDANCE");
    expect(h.prisma.labourCategory.delete).not.toHaveBeenCalled();
  });

  it("blocks a category whose subcategory has a configured labour rate (config preserved)", async () => {
    h.prisma.labourAttendance.count.mockResolvedValue(0);
    h.prisma.projectContractorLabourRate.count.mockResolvedValue(2);
    await expect(deleteCategory("cat1")).rejects.toThrow("CATEGORY_HAS_ASSIGNMENTS");
    expect(h.prisma.labourCategory.delete).not.toHaveBeenCalled();
  });

  it("deletes a genuinely unused category (no attendance, no config)", async () => {
    await deleteCategory("cat1");
    expect(h.prisma.labourCategory.delete).toHaveBeenCalledWith({
      where: { id: "cat1", companyId: "c1" },
    });
  });

  it("takes a FOR UPDATE lock before checking (race-safe) and needs labour.archive", async () => {
    await deleteCategory("cat1");
    expect(h.prisma.$transaction).toHaveBeenCalled();
    // Two locks: the category row + its subcategories.
    expect(h.prisma.$queryRaw).toHaveBeenCalledTimes(2);

    h.user = u(["labour.view", "labour.edit"]); // no archive
    await expect(deleteCategory("cat1")).rejects.toThrow("FORBIDDEN");
  });
});

describe("deleteSubcategory", () => {
  it("blocks a subcategory with recorded attendance", async () => {
    h.prisma.labourAttendance.count.mockResolvedValue(1);
    await expect(deleteSubcategory("sub1")).rejects.toThrow("SUBCATEGORY_HAS_ATTENDANCE");
    expect(h.prisma.labourSubcategory.delete).not.toHaveBeenCalled();
  });

  it("blocks a subcategory with a configured project-contractor rate", async () => {
    h.prisma.labourAttendance.count.mockResolvedValue(0);
    h.prisma.projectContractorLabourRate.count.mockResolvedValue(1);
    await expect(deleteSubcategory("sub1")).rejects.toThrow("SUBCATEGORY_HAS_ASSIGNMENTS");
    expect(h.prisma.labourSubcategory.delete).not.toHaveBeenCalled();
  });

  it("deletes an unused subcategory", async () => {
    await deleteSubcategory("sub1");
    expect(h.prisma.labourSubcategory.delete).toHaveBeenCalledWith({
      where: { id: "sub1", companyId: "c1" },
    });
  });
});

describe("forceDeleteCategory (Owner)", () => {
  const owner = () => u(["labour.view", "labour.archive"], true);

  it("requires Owner authority", async () => {
    h.user = u(["labour.view", "labour.archive"]); // has archive but NOT owner
    await expect(forceDeleteCategory("cat1", "DELETE")).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.labourCategory.update).not.toHaveBeenCalled();
  });

  it("requires a typed DELETE confirmation", async () => {
    h.user = owner();
    await expect(forceDeleteCategory("cat1", "nope")).rejects.toThrow("CONFIRMATION_REQUIRED");
    expect(h.prisma.labourCategory.update).not.toHaveBeenCalled();
  });

  it("soft-deletes the group + its types and removes config, preserving attendance", async () => {
    h.user = owner();
    // Referenced: has attendance + rates (which the guard would normally block).
    h.prisma.labourAttendance.count.mockResolvedValue(37);
    h.prisma.projectContractorLabourRate.count.mockResolvedValue(4);

    await forceDeleteCategory("cat1", "DELETE");

    // Master row is SOFT-deleted (deletedAt set), never physically deleted.
    expect(h.prisma.labourCategory.delete).not.toHaveBeenCalled();
    expect(h.prisma.labourCategory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cat1", companyId: "c1" },
        data: expect.objectContaining({ deletedById: "u1" }),
      }),
    );
    // Types under the group are soft-deleted too.
    expect(h.prisma.labourSubcategory.updateMany).toHaveBeenCalled();
    // Pure config is hard-deleted.
    expect(h.prisma.projectContractorLabourRate.deleteMany).toHaveBeenCalled();
    expect(h.prisma.projectContractorAssignment.deleteMany).toHaveBeenCalledWith({
      where: { companyId: "c1", labourCategoryId: "cat1" },
    });
    // An audit entry is written.
    expect(h.prisma.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "labour_category.force_deleted", actorId: "u1" }),
      }),
    );
  });
});

describe("forceDeleteSubcategory (Owner)", () => {
  it("soft-deletes the type, removes its rates, keeps attendance", async () => {
    h.user = u(["labour.view", "labour.archive"], true);
    h.prisma.$queryRaw.mockResolvedValue([{ id: "sub1", name: "Mason" }]);
    h.prisma.labourAttendance.count.mockResolvedValue(12);

    await forceDeleteSubcategory("sub1", "DELETE");

    expect(h.prisma.labourSubcategory.delete).not.toHaveBeenCalled();
    expect(h.prisma.labourSubcategory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "sub1", companyId: "c1" },
        data: expect.objectContaining({ deletedById: "u1" }),
      }),
    );
    expect(h.prisma.projectContractorLabourRate.deleteMany).toHaveBeenCalledWith({
      where: { companyId: "c1", labourSubcategoryId: "sub1" },
    });
    expect(h.prisma.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "labour_subcategory.force_deleted" }),
      }),
    );
  });

  it("is Owner-only", async () => {
    h.user = u(["labour.view", "labour.archive"]); // not owner
    await expect(forceDeleteSubcategory("sub1", "DELETE")).rejects.toThrow("FORBIDDEN");
  });
});

describe("forceDeletePreview (Owner)", () => {
  it("returns removed-vs-preserved counts for a category", async () => {
    h.user = u(["labour.view"], true);
    h.prisma.labourSubcategory.findMany.mockResolvedValue([{ id: "sub1" }, { id: "sub2" }]);
    h.prisma.projectContractorLabourRate.count.mockResolvedValue(4);
    h.prisma.projectContractorAssignment.count.mockResolvedValue(1);
    h.prisma.labourAttendance.count.mockResolvedValue(37);

    const impact = await forceDeletePreview("category", "cat1");

    expect(impact).toMatchObject({
      kind: "category",
      name: "Civil",
      labourGroups: 1,
      labourTypes: 2,
      projectContractorRates: 4,
      projectContractorAssignments: 1,
      attendancePreserved: 37,
    });
  });

  it("is Owner-only", async () => {
    h.user = u(["labour.view"]); // not owner
    await expect(forceDeletePreview("category", "cat1")).rejects.toThrow("FORBIDDEN");
  });

  it("throws NOT_FOUND for a missing/soft-deleted target", async () => {
    h.user = u(["labour.view"], true);
    h.prisma.labourCategory.findFirst.mockResolvedValue(null);
    await expect(forceDeletePreview("category", "gone")).rejects.toThrow("NOT_FOUND");
  });
});
