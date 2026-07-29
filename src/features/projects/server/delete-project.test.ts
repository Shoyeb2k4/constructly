import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import { ALL_PERMISSIONS } from "@/features/rbac/permissions";

const OWNER: SessionUser = {
  id: "o1",
  email: "owner@x.com",
  fullName: "Owner",
  role: "OWNER",
  permissions: [...ALL_PERMISSIONS],
  company: { id: "c1", name: "Co" },
};
// A project manager holds no projects.delete → delete/restore must be forbidden.
const PM: SessionUser = { ...OWNER, id: "pm1", role: "PROJECT_MANAGER", permissions: [] };

const h = vi.hoisted(() => ({
  user: null as SessionUser | null,
  verifyPassword: vi.fn(),
  prisma: {
    project: { findFirst: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
    activityLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth/current-user", () => ({ requireUser: async () => h.user }));
vi.mock("@/lib/auth/verify-password", () => ({ verifyPassword: h.verifyPassword }));
vi.mock("@/lib/db/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/features/budget/server-actions", () => ({
  spendByProject: vi.fn(async () => ({})),
  projectSpend: vi.fn(async () => ({ laborPaise: 0, procurementPaise: 0 })),
}));

import { removeProject, restoreProject } from "./actions";

const liveProject = {
  id: "p1",
  code: "PRJ-0001",
  name: "Riverside Villa",
  pmId: null,
  _count: {
    purchaseOrders: 3,
    vendorPayments: 2,
    goodsReceipts: 0,
    labourAttendance: 10,
    contractorSettlements: 1,
    documents: 4,
    notes: 5,
  },
};

const listRow = {
  id: "p1",
  code: "PRJ-0001",
  name: "Riverside Villa",
  type: "RESIDENTIAL",
  stage: "CREATED",
  budgetPaise: BigInt(0),
  contractValuePaise: BigInt(0),
  procurementBudgetPaise: null,
  startDate: null,
  expectedCompletionDate: null,
  tags: [],
  archivedAt: null,
  deletedAt: null,
  deletedReason: null,
  updatedAt: new Date("2026-01-01"),
  pm: null,
  deletedBy: null,
  favorites: [],
};

beforeEach(() => {
  h.user = OWNER;
  h.verifyPassword.mockReset().mockResolvedValue(true);
  h.prisma.project.findFirst.mockReset().mockResolvedValue(liveProject);
  h.prisma.project.update.mockReset().mockResolvedValue({ id: "p1" });
  h.prisma.project.findUniqueOrThrow.mockReset().mockResolvedValue(listRow);
  h.prisma.activityLog.create.mockReset().mockResolvedValue({ id: "a1" });
  h.prisma.$transaction
    .mockReset()
    .mockImplementation(async (ops: unknown) =>
      Array.isArray(ops) ? Promise.all(ops) : (ops as (t: unknown) => unknown)(h.prisma),
    );
});

describe("removeProject — authorization", () => {
  it("rejects a non-owner before doing anything", async () => {
    h.user = PM;
    await expect(removeProject("p1", { password: "pw" })).rejects.toThrow("FORBIDDEN");
    expect(h.verifyPassword).not.toHaveBeenCalled();
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("is company-scoped: a foreign/missing project is NOT_FOUND and never checks the password", async () => {
    h.prisma.project.findFirst.mockResolvedValue(null);
    await expect(removeProject("other-co", { password: "pw" })).rejects.toThrow("NOT_FOUND");
    expect(h.prisma.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ companyId: "c1", deletedAt: null }) }),
    );
    expect(h.verifyPassword).not.toHaveBeenCalled();
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("removeProject — password re-auth", () => {
  it("throws INVALID_PASSWORD and does not delete when the password is wrong", async () => {
    h.verifyPassword.mockResolvedValue(false);
    await expect(removeProject("p1", { password: "nope" })).rejects.toThrow("INVALID_PASSWORD");
    expect(h.verifyPassword).toHaveBeenCalledWith("owner@x.com", "nope");
    expect(h.prisma.project.update).not.toHaveBeenCalled();
    expect(h.prisma.activityLog.create).not.toHaveBeenCalled();
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("removeProject — soft delete + audit", () => {
  it("soft-deletes (never hard-deletes) with actor + reason and writes an audit entry", async () => {
    await removeProject("p1", { password: "correct", reason: "duplicate entry" });

    // Soft delete: sets deletedAt/deletedById/deletedReason — no physical delete API used.
    expect(h.prisma.project.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p1" },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          deletedById: "o1",
          deletedReason: "duplicate entry",
        }),
      }),
    );
    // Audit log captures who/what.
    expect(h.prisma.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          companyId: "c1",
          actorId: "o1",
          action: "project.deleted",
          entityType: "project",
          entityId: "p1",
        }),
      }),
    );
    // The write happens inside one transaction.
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("stores a null reason when none is given", async () => {
    await removeProject("p1", { password: "correct" });
    expect(h.prisma.project.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ deletedReason: null }) }),
    );
  });
});

describe("restoreProject", () => {
  it("rejects a non-owner", async () => {
    h.user = PM;
    await expect(restoreProject("p1")).rejects.toThrow("FORBIDDEN");
  });

  it("clears the deletion metadata and logs the restore", async () => {
    h.prisma.project.findFirst.mockResolvedValue({ id: "p1", code: "PRJ-0001", name: "Riverside Villa", pmId: null });
    await restoreProject("p1");
    // Scoped to a currently-deleted project.
    expect(h.prisma.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ companyId: "c1", deletedAt: { not: null } }),
      }),
    );
    expect(h.prisma.project.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { deletedAt: null, deletedById: null, deletedReason: null },
      }),
    );
    expect(h.prisma.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "project.recovered" }) }),
    );
  });

  it("is company-scoped: restoring a foreign project is NOT_FOUND", async () => {
    h.prisma.project.findFirst.mockResolvedValue(null);
    await expect(restoreProject("foreign")).rejects.toThrow("NOT_FOUND");
    expect(h.prisma.project.update).not.toHaveBeenCalled();
  });
});
