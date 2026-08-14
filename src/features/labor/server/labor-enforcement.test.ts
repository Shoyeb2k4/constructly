import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import { ALL_PERMISSIONS, type Permission } from "@/features/rbac/permissions";

function u(permissions: Permission[]): SessionUser {
  return { id: "pm1", email: "u@x.com", fullName: "U", role: "PROJECT_MANAGER", permissions, company: { id: "c1", name: "Co" } };
}
const OWNER = u([...ALL_PERMISSIONS]);

const h = vi.hoisted(() => ({
  user: null as SessionUser | null,
  prisma: {
    labourCategory: { findMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    labourSubcategory: { count: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
    labourAttendance: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn(), create: vi.fn(), update: vi.fn() },
    projectContractor: { findMany: vi.fn() },
    projectContractorLabourRate: { findFirst: vi.fn() },
    contractorContract: { findMany: vi.fn() },
    project: { findFirst: vi.fn() },
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
  listCategories,
  createCategory,
  deleteCategory,
  getSheet,
  setQuantity,
  listAttendance,
} from "./actions";

beforeEach(() => {
  h.user = OWNER;
  Object.values(h.prisma).forEach((m) => Object.values(m).forEach((f) => (f as ReturnType<typeof vi.fn>).mockReset()));
  h.prisma.labourCategory.findMany.mockResolvedValue([]);
  h.prisma.labourAttendance.findMany.mockResolvedValue([]);
  h.prisma.projectContractor.findMany.mockResolvedValue([]);
  h.prisma.contractorContract.findMany.mockResolvedValue([]);
  h.prisma.project.findFirst.mockResolvedValue({ id: "p1" });
});

describe("labour master-data permissions", () => {
  it("listCategories requires labour.view", async () => {
    h.user = u([]);
    await expect(listCategories()).rejects.toThrow("FORBIDDEN");
  });

  it("createCategory requires labour.create — reaches DB when granted", async () => {
    h.user = u(["labour.create"]);
    h.prisma.labourCategory.count.mockResolvedValue(0);
    h.prisma.labourCategory.create.mockResolvedValue({ id: "cat1", name: "Mason", color: null, displayOrder: 0 });
    await createCategory({ name: "Mason" });
    expect(h.prisma.labourCategory.create).toHaveBeenCalled();
  });

  it("deleteCategory needs labour.archive — labour.edit is not enough", async () => {
    h.user = u(["labour.view", "labour.edit"]);
    await expect(deleteCategory("cat1")).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.labourCategory.delete).not.toHaveBeenCalled();
  });
});

describe("attendance permissions are a separate namespace", () => {
  it("a labour-only user (no attendance.mark) cannot mark attendance", async () => {
    h.user = u(["labour.view", "labour.create", "labour.edit", "labour.archive"]);
    await expect(setQuantity({ projectId: "p1", date: "2026-07-20", subcategoryId: "sub1", quantity: 3 })).rejects.toThrow("FORBIDDEN");
  });

  it("an attendance-only user (no labour.create) cannot create categories", async () => {
    h.user = u(["attendance.view", "attendance.mark"]);
    await expect(createCategory({ name: "X" })).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.labourCategory.create).not.toHaveBeenCalled();
  });

  it("getSheet requires attendance.view", async () => {
    h.user = u(["labour.view"]);
    await expect(getSheet("p1", "2026-07-20")).rejects.toThrow("FORBIDDEN");
  });
});

describe("attendance ownership + view scope", () => {
  it("marking is blocked on a project the PM is not assigned to", async () => {
    h.user = u(["attendance.view", "attendance.mark"]);
    h.prisma.project.findFirst.mockResolvedValue(null); // not assigned
    await expect(setQuantity({ projectId: "p1", date: "2026-07-20", subcategoryId: "sub1", quantity: 3 })).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.labourAttendance.upsert).not.toHaveBeenCalled();
  });

  it("marking on an assigned project proceeds (quantity 0 clears the record)", async () => {
    h.user = u(["attendance.view", "attendance.mark"]);
    h.prisma.project.findFirst.mockResolvedValue({ id: "p1" });
    await setQuantity({ projectId: "p1", date: "2026-07-20", subcategoryId: "sub1", quantity: 0 });
    expect(h.prisma.labourAttendance.deleteMany).toHaveBeenCalled();
  });

  it("listAttendance scopes a PM without attendance.view_all to their projects", async () => {
    h.user = u(["attendance.view"]);
    await listAttendance({});
    const where = h.prisma.labourAttendance.findMany.mock.calls[0][0].where;
    expect(where.project).toEqual({ pmId: "pm1" });
  });

  it("attendance.view_all removes the project scope", async () => {
    h.user = u(["attendance.view", "attendance.view_all"]);
    await listAttendance({});
    const where = h.prisma.labourAttendance.findMany.mock.calls[0][0].where;
    expect(where.project).toBeUndefined();
  });
});
