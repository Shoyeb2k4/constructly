/**
 * Category / subcategory deletion guards. A category is deletable only when it
 * has NEITHER recorded attendance (history) NOR project-contractor assignments
 * (config that must only change via the audited setContractorAssignments path).
 * The check + delete run in one transaction with FOR UPDATE locks so concurrent
 * attendance/assignment inserts can't slip in between check and delete.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import type { Permission } from "@/features/rbac/permissions";

const u = (permissions: Permission[]): SessionUser => ({
  id: "u1",
  email: "u@x.com",
  fullName: "U",
  role: "OWNER",
  permissions,
  company: { id: "c1", name: "Co" },
});

const h = vi.hoisted(() => ({
  user: null as SessionUser | null,
  prisma: {
    labourAttendance: { count: vi.fn() },
    projectContractorAssignment: { count: vi.fn() },
    labourCategory: { delete: vi.fn() },
    labourSubcategory: { delete: vi.fn() },
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

import { deleteCategory, deleteSubcategory } from "./actions";

beforeEach(() => {
  h.user = u(["labour.view", "labour.archive"]);
  h.prisma.labourAttendance.count.mockReset().mockResolvedValue(0);
  h.prisma.projectContractorAssignment.count.mockReset().mockResolvedValue(0);
  h.prisma.labourCategory.delete.mockReset().mockResolvedValue({ id: "cat1" });
  h.prisma.labourSubcategory.delete.mockReset().mockResolvedValue({ id: "sub1" });
  // Locks return the target row (found); callback transaction runs on the mock.
  h.prisma.$queryRaw.mockReset().mockResolvedValue([{ id: "cat1" }]);
  h.prisma.$transaction.mockReset().mockImplementation(async (fn: (tx: unknown) => unknown) => fn(h.prisma));
});

describe("deleteCategory", () => {
  it("blocks a category with recorded attendance (history preserved)", async () => {
    h.prisma.labourAttendance.count.mockResolvedValue(3);
    await expect(deleteCategory("cat1")).rejects.toThrow("CATEGORY_HAS_ATTENDANCE");
    expect(h.prisma.labourCategory.delete).not.toHaveBeenCalled();
  });

  it("blocks a category that has assignments but no attendance (config preserved)", async () => {
    h.prisma.labourAttendance.count.mockResolvedValue(0);
    h.prisma.projectContractorAssignment.count.mockResolvedValue(2);
    await expect(deleteCategory("cat1")).rejects.toThrow("CATEGORY_HAS_ASSIGNMENTS");
    expect(h.prisma.labourCategory.delete).not.toHaveBeenCalled();
  });

  it("deletes a genuinely unused category (no attendance, no assignments)", async () => {
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

  it("deletes an unused subcategory", async () => {
    await deleteSubcategory("sub1");
    expect(h.prisma.labourSubcategory.delete).toHaveBeenCalledWith({
      where: { id: "sub1", companyId: "c1" },
    });
  });
});
