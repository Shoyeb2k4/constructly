/**
 * Server-side enforcement for project ↔ contractor assignments: RBAC + ownership
 * gate on writes, company-ownership validation (cross-company rejection), and
 * deduping. Mirrors the mocking style of projects-enforcement.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import { ALL_PERMISSIONS } from "@/features/rbac/permissions";

const OWNER: SessionUser = {
  id: "o1",
  email: "o@x.com",
  fullName: "Owner",
  role: "OWNER",
  permissions: [...ALL_PERMISSIONS], // includes edit_all
  company: { id: "c1", name: "Co" },
};
const PM: SessionUser = {
  id: "pm1",
  email: "pm@x.com",
  fullName: "PM",
  role: "PROJECT_MANAGER",
  permissions: ["projects.view", "projects.edit"],
  company: { id: "c1", name: "Co" },
};

const h = vi.hoisted(() => ({
  user: null as SessionUser | null,
  prisma: {
    project: { findFirst: vi.fn(), create: vi.fn() },
    contractor: { count: vi.fn() },
    labourCategory: { count: vi.fn() },
    projectContractorAssignment: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn(),
    },
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
vi.mock("@/lib/auth/verify-password", () => ({ verifyPassword: async () => true }));
vi.mock("@/features/budget/server-actions", () => ({
  spendByProject: vi.fn(async () => ({})),
  projectSpend: vi.fn(async () => ({ laborPaise: 0, procurementPaise: 0 })),
}));

import { setContractorAssignments, createProject } from "./actions";
import type { CreateProjectInput } from "../types";

// Valid UUIDs (the assignment schema enforces uuid() before validation runs).
const K1 = "11111111-1111-4111-8111-111111111111";
const CAT1 = "22222222-2222-4222-8222-222222222222";
const FOREIGN = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  h.user = OWNER;
  h.prisma.project.findFirst.mockReset();
  h.prisma.project.create.mockReset();
  h.prisma.contractor.count.mockReset();
  h.prisma.labourCategory.count.mockReset();
  h.prisma.projectContractorAssignment.deleteMany.mockReset().mockResolvedValue({ count: 0 });
  h.prisma.projectContractorAssignment.createMany.mockReset().mockResolvedValue({ count: 0 });
  h.prisma.projectContractorAssignment.findMany.mockReset().mockResolvedValue([]);
  h.prisma.activityLog.create.mockReset().mockResolvedValue({ id: "a" });
  // Array form (setContractorAssignments) runs the ops; callback form runs fn(tx).
  h.prisma.$transaction.mockReset().mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(h.prisma) : Promise.all(arg as unknown[]),
  );
});

describe("setContractorAssignments — RBAC + ownership", () => {
  it("rejects a PM who does not own the project (FORBIDDEN), no write", async () => {
    h.user = PM;
    h.prisma.project.findFirst.mockResolvedValue({ pmId: "someone-else" });
    await expect(
      setContractorAssignments("p1", [{ contractorId: K1, labourCategoryId: CAT1 }]),
    ).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.projectContractorAssignment.createMany).not.toHaveBeenCalled();
    expect(h.prisma.projectContractorAssignment.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects a caller lacking projects.edit before any DB lookup", async () => {
    h.user = { ...PM, permissions: ["projects.view"] };
    await expect(
      setContractorAssignments("p1", [{ contractorId: K1, labourCategoryId: CAT1 }]),
    ).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.project.findFirst).not.toHaveBeenCalled();
  });
});

describe("setContractorAssignments — company ownership (tenancy)", () => {
  it("rejects a cross-company contractor/category (INVALID_ASSIGNMENT), no write", async () => {
    h.user = OWNER;
    h.prisma.project.findFirst.mockResolvedValue({ pmId: "o1" });
    // Only 0 of the 1 requested contractor ids belong to the company.
    h.prisma.contractor.count.mockResolvedValue(0);
    h.prisma.labourCategory.count.mockResolvedValue(1);
    await expect(
      setContractorAssignments("p1", [{ contractorId: FOREIGN, labourCategoryId: CAT1 }]),
    ).rejects.toThrow("INVALID_ASSIGNMENT");
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("dedupes exact-duplicate rows and writes the unique set", async () => {
    h.user = OWNER;
    h.prisma.project.findFirst.mockResolvedValue({ pmId: "o1" });
    h.prisma.contractor.count.mockResolvedValue(1); // 1 distinct contractor
    h.prisma.labourCategory.count.mockResolvedValue(1); // 1 distinct category
    await setContractorAssignments("p1", [
      { contractorId: K1, labourCategoryId: CAT1 },
      { contractorId: K1, labourCategoryId: CAT1 }, // duplicate
    ]);
    expect(h.prisma.projectContractorAssignment.deleteMany).toHaveBeenCalled();
    const created = h.prisma.projectContractorAssignment.createMany.mock.calls[0][0];
    expect(created.data).toHaveLength(1);
    expect(created.data[0]).toMatchObject({ companyId: "c1", projectId: "p1", contractorId: K1 });
  });
});

describe("createProject — assignment validation is transactional", () => {
  it("rejects a cross-company assignment before creating the project", async () => {
    h.user = OWNER;
    h.prisma.contractor.count.mockResolvedValue(0); // foreign contractor
    h.prisma.labourCategory.count.mockResolvedValue(1);
    await expect(
      createProject({
        name: "New",
        type: "COMMERCIAL",
        budgetPaise: 0,
        contractValuePaise: 0,
        contractorAssignments: [{ contractorId: FOREIGN, labourCategoryId: CAT1 }],
      } as CreateProjectInput),
    ).rejects.toThrow("INVALID_ASSIGNMENT");
    expect(h.prisma.project.create).not.toHaveBeenCalled();
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
});
