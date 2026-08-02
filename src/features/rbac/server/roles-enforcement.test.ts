import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import { ALL_PERMISSIONS, type Permission } from "../permissions";

function u(permissions: Permission[]): SessionUser {
  return { id: "admin1", email: "a@x.com", fullName: "A", role: "PROJECT_MANAGER", permissions, company: { id: "c1", name: "Co" } };
}
const OWNER = u([...ALL_PERMISSIONS]);

const h = vi.hoisted(() => ({
  user: null as SessionUser | null,
  prisma: {
    companyRole: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    user: { findFirst: vi.fn(), update: vi.fn(), count: vi.fn() },
    userRole: { deleteMany: vi.fn(), create: vi.fn() },
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

import { createRole, updateRole, deleteRole, assignUserRole } from "./roles-actions";

beforeEach(() => {
  h.user = OWNER;
  Object.values(h.prisma).forEach((m) => {
    if (typeof m === "object") Object.values(m).forEach((f) => (f as ReturnType<typeof vi.fn>).mockReset?.());
  });
});

describe("createRole — permission + no escalation", () => {
  it("blocks a user without roles.create", async () => {
    h.user = u(["roles.view"]);
    await expect(createRole({ name: "New", permissions: [] })).rejects.toThrow("FORBIDDEN");
  });

  it("cannot grant a permission the creator doesn't hold", async () => {
    h.user = u(["roles.create", "projects.view"]); // no projects.delete
    await expect(createRole({ name: "New", permissions: ["projects.delete"] })).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.companyRole.create).not.toHaveBeenCalled();
  });
});

describe("updateRole — protected roles + manage_permissions", () => {
  it("refuses to edit a SYSTEM role (clone to customise)", async () => {
    h.user = u([...ALL_PERMISSIONS]);
    h.prisma.companyRole.findFirst.mockResolvedValue({ id: "r1", isSystem: true, isOwner: false, permissions: [] });
    await expect(updateRole("r1", { name: "X" })).rejects.toThrow("PROTECTED_ROLE");
    expect(h.prisma.companyRole.update).not.toHaveBeenCalled();
  });

  it("editing permissions requires roles.manage_permissions", async () => {
    h.user = u(["roles.edit"]); // custom role, but no manage_permissions
    h.prisma.companyRole.findFirst.mockResolvedValue({ id: "r1", isSystem: false, isOwner: false, permissions: [] });
    await expect(updateRole("r1", { permissions: ["projects.view"] })).rejects.toThrow("FORBIDDEN");
  });
});

describe("deleteRole — protected + members guard", () => {
  it("refuses to delete a system role", async () => {
    h.prisma.companyRole.findFirst.mockResolvedValue({ id: "r1", isSystem: true, isOwner: false, _count: { users: 0 } });
    await expect(deleteRole("r1")).rejects.toThrow("PROTECTED_ROLE");
  });

  it("refuses to delete a role that still has members", async () => {
    h.prisma.companyRole.findFirst.mockResolvedValue({ id: "r1", name: "Custom", isSystem: false, isOwner: false, _count: { users: 2 } });
    await expect(deleteRole("r1")).rejects.toThrow(/reassign/i);
    expect(h.prisma.companyRole.delete).not.toHaveBeenCalled();
  });
});

describe("assignUserRole — no escalation + last-owner", () => {
  it("a limited admin can't assign the Owner (all-permission) role", async () => {
    h.user = u(["roles.assign", "projects.view"]);
    h.prisma.companyRole.findFirst.mockResolvedValue({ id: "owner", isOwner: true, permissions: [] });
    h.prisma.user.findFirst.mockResolvedValue({ id: "t1", role: "PROJECT_MANAGER" });
    await expect(assignUserRole("t1", "owner")).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("can't demote the last active Owner", async () => {
    h.user = OWNER;
    h.prisma.companyRole.findFirst.mockResolvedValue({ id: "pm", isOwner: false, permissions: [] });
    h.prisma.user.findFirst.mockResolvedValue({ id: "t1", role: "OWNER" }); // currently an owner
    h.prisma.user.count.mockResolvedValue(1); // last active owner
    await expect(assignUserRole("t1", "pm")).rejects.toThrow(/last owner/i);
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
});
