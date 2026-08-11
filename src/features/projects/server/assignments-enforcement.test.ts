/**
 * Server-side enforcement for the contractor-first project config: RBAC +
 * ownership gate on writes, company-ownership validation (cross-company
 * rejection), and deduping of contractors + labour types. Mirrors the mocking
 * style of projects-enforcement.test.ts.
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
    labourSubcategory: { count: vi.fn() },
    projectContractor: {
      deleteMany: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
    projectContractorLabourRate: { createMany: vi.fn() },
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

import { setProjectContractors, createProject } from "./actions";
import type { CreateProjectInput } from "../types";

// Valid UUIDs (the schema enforces uuid() before validation runs).
const K1 = "11111111-1111-4111-8111-111111111111";
const SUB1 = "22222222-2222-4222-8222-222222222222";
const FOREIGN = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  h.user = OWNER;
  h.prisma.project.findFirst.mockReset();
  h.prisma.project.create.mockReset();
  h.prisma.contractor.count.mockReset();
  h.prisma.labourSubcategory.count.mockReset();
  h.prisma.projectContractor.deleteMany.mockReset().mockResolvedValue({ count: 0 });
  h.prisma.projectContractor.create.mockReset().mockResolvedValue({ id: "pc1" });
  h.prisma.projectContractor.findMany.mockReset().mockResolvedValue([]);
  h.prisma.projectContractorLabourRate.createMany.mockReset().mockResolvedValue({ count: 0 });
  h.prisma.activityLog.create.mockReset().mockResolvedValue({ id: "a" });
  // Callback form runs fn(tx); array form runs the ops.
  h.prisma.$transaction.mockReset().mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(h.prisma) : Promise.all(arg as unknown[]),
  );
});

const row = (contractorId: string, subId = SUB1, ratePaise = 80000) => ({
  contractorId,
  labourRates: [{ labourSubcategoryId: subId, ratePaise }],
});

describe("setProjectContractors — RBAC + ownership", () => {
  it("rejects a PM who does not own the project (FORBIDDEN), no write", async () => {
    h.user = PM;
    h.prisma.project.findFirst.mockResolvedValue({ pmId: "someone-else" });
    await expect(setProjectContractors("p1", [row(K1)])).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.projectContractor.create).not.toHaveBeenCalled();
    expect(h.prisma.projectContractor.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects a caller lacking projects.edit before any DB lookup", async () => {
    h.user = { ...PM, permissions: ["projects.view"] };
    await expect(setProjectContractors("p1", [row(K1)])).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.project.findFirst).not.toHaveBeenCalled();
  });
});

describe("setProjectContractors — company ownership (tenancy)", () => {
  it("rejects a cross-company contractor/subcategory (INVALID_ASSIGNMENT), no write", async () => {
    h.user = OWNER;
    h.prisma.project.findFirst.mockResolvedValue({ pmId: "o1" });
    h.prisma.contractor.count.mockResolvedValue(0); // foreign contractor
    h.prisma.labourSubcategory.count.mockResolvedValue(1);
    await expect(setProjectContractors("p1", [row(FOREIGN)])).rejects.toThrow("INVALID_ASSIGNMENT");
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("dedupes duplicate contractors + labour types and writes the unique set", async () => {
    h.user = OWNER;
    h.prisma.project.findFirst.mockResolvedValue({ pmId: "o1" });
    h.prisma.contractor.count.mockResolvedValue(1); // 1 distinct contractor
    h.prisma.labourSubcategory.count.mockResolvedValue(1); // 1 distinct subcategory
    await setProjectContractors("p1", [
      { contractorId: K1, labourRates: [{ labourSubcategoryId: SUB1, ratePaise: 80000 }, { labourSubcategoryId: SUB1, ratePaise: 90000 }] },
      row(K1), // duplicate contractor
    ]);
    expect(h.prisma.projectContractor.deleteMany).toHaveBeenCalled();
    // One contractor created; its labour rates deduped to a single subcategory.
    expect(h.prisma.projectContractor.create).toHaveBeenCalledTimes(1);
    const rateCall = h.prisma.projectContractorLabourRate.createMany.mock.calls[0][0];
    expect(rateCall.data).toHaveLength(1);
    expect(rateCall.data[0]).toMatchObject({ companyId: "c1", projectContractorId: "pc1", labourSubcategoryId: SUB1 });
  });
});

describe("createProject — contractor validation is transactional", () => {
  it("rejects a cross-company contractor before creating the project", async () => {
    h.user = OWNER;
    h.prisma.contractor.count.mockResolvedValue(0); // foreign contractor
    h.prisma.labourSubcategory.count.mockResolvedValue(1);
    await expect(
      createProject({
        name: "New",
        type: "COMMERCIAL",
        budgetPaise: 0,
        contractValuePaise: 0,
        contractors: [row(FOREIGN)],
      } as CreateProjectInput),
    ).rejects.toThrow("INVALID_ASSIGNMENT");
    expect(h.prisma.project.create).not.toHaveBeenCalled();
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
});
