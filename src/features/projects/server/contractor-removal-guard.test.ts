/**
 * The server-side guard on detaching a contractor from a project.
 *
 * The defect: `syncProjectContractors` refused removal when attendance existed
 * but said nothing about a live agreement. Nothing financial has a foreign key
 * to `ProjectContractor`, so removal destroyed no history — but the daily
 * attendance sheet is built by walking that table, so an agreement whose
 * relationship was gone could no longer take labour while still being owed.
 *
 * These tests pin the blocking rules, the isolation of the queries, and that a
 * refusal comes back as a typed RESULT rather than a masked throw.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import { ALL_PERMISSIONS, type Permission } from "@/features/rbac/permissions";

function u(permissions: Permission[]): SessionUser {
  return {
    id: "pm1",
    email: "pm@x.com",
    fullName: "PM",
    role: "PROJECT_MANAGER",
    permissions,
    company: { id: "c1", name: "Co" },
  };
}
const OWNER: SessionUser = { ...u([...ALL_PERMISSIONS]), id: "o1", role: "OWNER" };

const PROJECT = "22222222-2222-4222-8222-222222222222";
const PAPPU = "11111111-1111-4111-8111-111111111111";
const SURESH = "99999999-9999-4999-8999-999999999999";
const MASON = "65000000-0000-4000-8000-000000000005";

const h = vi.hoisted(() => ({
  user: null as SessionUser | null,
  prisma: {
    project: { findFirst: vi.fn() },
    contractor: { findMany: vi.fn(), count: vi.fn() },
    labourSubcategory: { count: vi.fn() },
    contractorContract: { findMany: vi.fn() },
    labourAttendance: { groupBy: vi.fn() },
    contractorSettlement: { groupBy: vi.fn() },
    projectContractor: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    projectContractorLabourRate: {
      createMany: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
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

import { setProjectContractors } from "./actions";

/**
 * The currently-configured relationship for Pappu on this project.
 *
 * Shaped to satisfy BOTH reads: the diff's `select`, and the success path's
 * `include` that builds the returned DTO.
 */
function pcRow(contractorId: string, id: string, name: string) {
  return {
    id,
    contractorId,
    contractRatePaise: null,
    contractRateUnit: null,
    contractor: { name },
    labourRates: [
      {
        id: `lr-${id}`,
        labourSubcategoryId: MASON,
        ratePaise: 80_000,
        rateUnit: "day",
        subcategory: { name: "Mason", categoryId: "cat-1", category: { name: "Masonry" } },
      },
    ],
  };
}
const existingPappu = () => [pcRow(PAPPU, "pc-1", "Pappu Contractor")];

/** Save with an EMPTY config — i.e. drop everyone currently assigned. */
const dropAll = () => setProjectContractors(PROJECT, []);

beforeEach(() => {
  h.user = OWNER;
  Object.values(h.prisma).forEach((m) => {
    if (typeof m === "object") {
      Object.values(m).forEach((f) => (f as ReturnType<typeof vi.fn>).mockReset?.());
    }
  });
  h.prisma.$transaction.mockReset().mockImplementation(async (fn: (tx: unknown) => unknown) =>
    typeof fn === "function" ? fn(h.prisma) : undefined,
  );
  h.prisma.project.findFirst.mockResolvedValue({ id: PROJECT, pmId: "o1", deletedAt: null });
  // validateProjectContractors proves company ownership by counting; return the
  // number asked for so ownership passes and the diff is what is under test.
  h.prisma.contractor.count.mockImplementation(
    async (a: { where: { id: { in: string[] } } }) => a.where.id.in.length,
  );
  h.prisma.labourSubcategory.count.mockImplementation(
    async (a: { where: { id: { in: string[] } } }) => a.where.id.in.length,
  );
  h.prisma.contractor.findMany.mockResolvedValue([
    { id: PAPPU, name: "Pappu Contractor" },
    { id: SURESH, name: "Suresh Masonry" },
  ]);
  h.prisma.projectContractor.findMany.mockResolvedValue(existingPappu());
  h.prisma.projectContractor.deleteMany.mockResolvedValue({ count: 1 });
  h.prisma.projectContractor.create.mockResolvedValue({ id: "pc-new" });
  h.prisma.projectContractorLabourRate.createMany.mockResolvedValue({ count: 1 });
  h.prisma.projectContractorLabourRate.deleteMany.mockResolvedValue({ count: 1 });
  // Nothing blocks unless a test says so.
  h.prisma.contractorContract.findMany.mockResolvedValue([]);
  h.prisma.labourAttendance.groupBy.mockResolvedValue([]);
  h.prisma.contractorSettlement.groupBy.mockResolvedValue([]);
});

/* ── Allowed ────────────────────────────────────────────────────────────── */

describe("removal with no dependency", () => {
  it("detaches the contractor", async () => {
    const res = await dropAll();
    expect(res).not.toHaveProperty("blockedRemovals");
    expect(h.prisma.projectContractor.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["pc-1"] } },
    });
  });

  it("does not touch the relationship when the contractor is kept", async () => {
    await setProjectContractors(PROJECT, [
      { contractorId: PAPPU, labourRates: [{ labourSubcategoryId: MASON, ratePaise: 80_000 }] },
    ]);
    expect(h.prisma.projectContractor.deleteMany).not.toHaveBeenCalled();
  });
});

/* ── Blocked ────────────────────────────────────────────────────────────── */

describe("blockers", () => {
  it("refuses when a live agreement still needs the relationship", async () => {
    h.prisma.contractorContract.findMany.mockResolvedValue([
      { id: "ag-structure", contractorId: PAPPU, title: "Structure Labour Contract", status: "IN_PROGRESS" },
    ]);

    const res = await dropAll();
    expect(res).toHaveProperty("blockedRemovals");
    const [b] = (res as { blockedRemovals: unknown[] }).blockedRemovals as {
      contractorName: string;
      agreements: { title: string }[];
    }[];
    expect(b.contractorName).toBe("Pappu Contractor");
    expect(b.agreements[0].title).toBe("Structure Labour Contract");
    // Nothing was deleted — the refusal happens before any write.
    expect(h.prisma.projectContractor.deleteMany).not.toHaveBeenCalled();
  });

  it("keeps refusing when attendance exists — the pre-existing rule survives", async () => {
    h.prisma.labourAttendance.groupBy.mockResolvedValue([
      { contractorId: PAPPU, _count: { _all: 12 } },
    ]);
    const res = await dropAll();
    const [b] = (res as { blockedRemovals: { attendanceCount: number }[] }).blockedRemovals;
    expect(b.attendanceCount).toBe(12);
    expect(h.prisma.projectContractor.deleteMany).not.toHaveBeenCalled();
  });

  it("refuses when a settlement has been recorded on this project", async () => {
    h.prisma.contractorSettlement.groupBy.mockResolvedValue([
      { contractorId: PAPPU, _count: { _all: 2 } },
    ]);
    const res = await dropAll();
    const [b] = (res as { blockedRemovals: { settlementCount: number }[] }).blockedRemovals;
    expect(b.settlementCount).toBe(2);
  });

  it("reports every blocker at once, so one save fixes everything", async () => {
    h.prisma.contractorContract.findMany.mockResolvedValue([
      { id: "ag-structure", contractorId: PAPPU, title: "Structure", status: "ON_HOLD" },
      { id: "ag-wall", contractorId: PAPPU, title: "Compound Wall", status: "NOT_STARTED" },
    ]);
    h.prisma.labourAttendance.groupBy.mockResolvedValue([
      { contractorId: PAPPU, _count: { _all: 3 } },
    ]);
    h.prisma.contractorSettlement.groupBy.mockResolvedValue([
      { contractorId: PAPPU, _count: { _all: 1 } },
    ]);

    const res = await dropAll();
    const [b] = (res as {
      blockedRemovals: { agreements: unknown[]; attendanceCount: number; settlementCount: number }[];
    }).blockedRemovals;
    expect(b.agreements).toHaveLength(2);
    expect(b.attendanceCount).toBe(3);
    expect(b.settlementCount).toBe(1);
  });

  it("blocks the right contractor when several are dropped at once", async () => {
    h.prisma.projectContractor.findMany.mockResolvedValue([
      ...existingPappu(),
      pcRow(SURESH, "pc-2", "Suresh Masonry"),
    ]);
    h.prisma.contractorContract.findMany.mockResolvedValue([
      { id: "ag-structure", contractorId: PAPPU, title: "Structure", status: "IN_PROGRESS" },
    ]);

    const res = await dropAll();
    const blocked = (res as { blockedRemovals: { contractorId: string }[] }).blockedRemovals;
    // Only Pappu is in the way; Suresh is clean. Neither is deleted, because the
    // save is one transaction — the user resolves Pappu and saves again.
    expect(blocked.map((b) => b.contractorId)).toEqual([PAPPU]);
    expect(h.prisma.projectContractor.deleteMany).not.toHaveBeenCalled();
  });
});

/* ── Cancelled agreements ───────────────────────────────────────────────── */

describe("a cancelled agreement does not block", () => {
  it("is excluded by the query itself", async () => {
    await dropAll();
    const where = h.prisma.contractorContract.findMany.mock.calls[0][0].where;
    expect(where.status).toEqual({ not: "CANCELLED" });
    expect(where.deletedAt).toBeNull();
  });

  it("lets the contractor be detached once the agreement is cancelled", async () => {
    // The query returns nothing precisely because the only agreement is cancelled.
    h.prisma.contractorContract.findMany.mockResolvedValue([]);
    const res = await dropAll();
    expect(res).not.toHaveProperty("blockedRemovals");
    expect(h.prisma.projectContractor.deleteMany).toHaveBeenCalled();
  });
});

/* ── Isolation ──────────────────────────────────────────────────────────── */

describe("isolation", () => {
  it("scopes every blocker query to this company AND this project", async () => {
    await dropAll();

    for (const call of [
      h.prisma.contractorContract.findMany.mock.calls[0][0],
      h.prisma.labourAttendance.groupBy.mock.calls[0][0],
      h.prisma.contractorSettlement.groupBy.mock.calls[0][0],
    ]) {
      expect(call.where.companyId).toBe("c1");
      expect(call.where.projectId).toBe(PROJECT);
    }
  });

  it("only asks about the contractors actually being dropped", async () => {
    h.prisma.projectContractor.findMany.mockResolvedValue([
      ...existingPappu(),
      pcRow(SURESH, "pc-2", "Suresh Masonry"),
    ]);
    // Keep Suresh, drop Pappu.
    await setProjectContractors(PROJECT, [{ contractorId: SURESH, labourRates: [] }]);
    const where = h.prisma.contractorContract.findMany.mock.calls[0][0].where;
    expect(where.contractorId).toEqual({ in: [PAPPU] });
  });

  it("asks nothing at all when no contractor is dropped", async () => {
    await setProjectContractors(PROJECT, [
      { contractorId: PAPPU, labourRates: [{ labourSubcategoryId: MASON, ratePaise: 80_000 }] },
    ]);
    expect(h.prisma.contractorContract.findMany).not.toHaveBeenCalled();
  });
});

/* ── Permission ─────────────────────────────────────────────────────────── */

describe("permission", () => {
  it("demands projects.edit before any database work", async () => {
    h.user = u(["projects.view"]);
    await expect(dropAll()).rejects.toThrow();
    expect(h.prisma.projectContractor.deleteMany).not.toHaveBeenCalled();
  });
});
