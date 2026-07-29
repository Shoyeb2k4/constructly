import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import { ALL_PERMISSIONS } from "@/features/rbac/permissions";

// Roles mirroring the seeded presets after Phase 2 reconcile.
const OWNER: SessionUser = {
  id: "o1",
  email: "o@x.com",
  fullName: "Owner",
  role: "OWNER",
  permissions: [...ALL_PERMISSIONS], // includes view_all + edit_all
  company: { id: "c1", name: "Co" },
};
const PM: SessionUser = {
  id: "pm1",
  email: "pm@x.com",
  fullName: "PM",
  role: "PROJECT_MANAGER",
  permissions: ["projects.view", "projects.edit", "projects.archive"],
  company: { id: "c1", name: "Co" },
};

const h = vi.hoisted(() => ({
  user: null as SessionUser | null,
  prisma: {
    project: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
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
vi.mock("@/lib/auth/verify-password", () => ({ verifyPassword: async () => true }));
vi.mock("@/features/budget/server-actions", () => ({
  spendByProject: vi.fn(async () => ({})),
  projectSpend: vi.fn(async () => ({ laborPaise: 0, procurementPaise: 0 })),
}));

import { createProject, changeStage, assignManager, listProjects } from "./actions";
import type { CreateProjectInput } from "../types";

const listRow = {
  id: "p1",
  code: "PRJ-0001",
  name: "Villa",
  type: "RESIDENTIAL",
  stage: "PLANNING",
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
  Object.values(h.prisma.project).forEach((f) => (f as ReturnType<typeof vi.fn>).mockReset());
  h.prisma.activityLog.create.mockReset().mockResolvedValue({ id: "a" });
  h.prisma.project.update.mockResolvedValue({ id: "p1" });
  h.prisma.project.findUniqueOrThrow.mockResolvedValue(listRow);
  h.prisma.project.findMany.mockResolvedValue([]);
});

describe("createProject — permission gate", () => {
  it("blocks a Project Manager (no projects.create) before any DB write", async () => {
    h.user = PM;
    await expect(createProject({ name: "X" } as CreateProjectInput)).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.project.create).not.toHaveBeenCalled();
  });
});

describe("assignManager — permission gate", () => {
  it("blocks a Project Manager (no projects.assign)", async () => {
    h.user = PM;
    await expect(assignManager("p1", "pm2")).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.project.findFirst).not.toHaveBeenCalled();
    expect(h.prisma.project.update).not.toHaveBeenCalled();
  });
});

describe("changeStage — permission AND ownership", () => {
  it("a PM may change stage on a project ASSIGNED to them", async () => {
    h.user = PM;
    h.prisma.project.findFirst.mockResolvedValue({ pmId: "pm1" }); // assigned
    await changeStage("p1", "CONSTRUCTION");
    expect(h.prisma.project.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "p1" }, data: { stage: "CONSTRUCTION" } }),
    );
  });

  it("a PM may NOT change stage on a project they are not assigned to (ownership)", async () => {
    h.user = PM;
    h.prisma.project.findFirst.mockResolvedValue({ pmId: "someone-else" });
    await expect(changeStage("p1", "CONSTRUCTION")).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.project.update).not.toHaveBeenCalled();
  });

  it("having projects.edit without ownership is not enough — proves permission ≠ ownership", async () => {
    h.user = { ...PM, id: "pm-other" }; // has projects.edit but is not the assignee
    h.prisma.project.findFirst.mockResolvedValue({ pmId: "pm1" });
    await expect(changeStage("p1", "CONSTRUCTION")).rejects.toThrow("FORBIDDEN");
  });

  it("an Owner (projects.edit_all) may change stage on ANY project", async () => {
    h.user = OWNER;
    h.prisma.project.findFirst.mockResolvedValue({ pmId: "someone-else" });
    await changeStage("p1", "CONSTRUCTION");
    expect(h.prisma.project.update).toHaveBeenCalled();
  });

  it("a role lacking projects.edit is blocked before the ownership lookup", async () => {
    h.user = { ...PM, permissions: ["projects.view"] };
    await expect(changeStage("p1", "CONSTRUCTION")).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.project.findFirst).not.toHaveBeenCalled();
  });
});

describe("listProjects — view scope (assignment)", () => {
  it("scopes a PM (no projects.view_all) to their assigned projects", async () => {
    h.user = PM;
    await listProjects();
    const where = h.prisma.project.findMany.mock.calls[0][0].where;
    expect(where.companyId).toBe("c1");
    expect(where.pmId).toBe("pm1");
  });

  it("an Owner (projects.view_all) sees the whole company (no pmId scope)", async () => {
    h.user = OWNER;
    await listProjects();
    const where = h.prisma.project.findMany.mock.calls[0][0].where;
    expect(where.companyId).toBe("c1");
    expect(where.pmId).toBeUndefined();
  });
});
