/**
 * Regression suite for the contractor-config PROVENANCE bug.
 *
 * `setProjectContractors` used to delete every ProjectContractor for a project
 * and recreate the set on each save. ProjectContractorLabourRate cascades from
 * it, so every rate row got a fresh id and every historical attendance row's
 * `projectContractorLabourRateId` (ON DELETE SET NULL) was silently nulled. The
 * money snapshot survived; the audit trail did not.
 *
 * These tests pin the corrected behaviour: the write is an in-place DIFF, ids of
 * unchanged mappings are stable, and a contractor with attendance can't be
 * dropped out from under its own history.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import { ALL_PERMISSIONS } from "@/features/rbac/permissions";

const OWNER: SessionUser = {
  id: "o1",
  email: "o@x.com",
  fullName: "Owner",
  role: "OWNER",
  permissions: [...ALL_PERMISSIONS],
  company: { id: "c1", name: "Co" },
};

const h = vi.hoisted(() => ({
  user: null as SessionUser | null,
  prisma: {
    project: { findFirst: vi.fn() },
    contractor: { count: vi.fn(), findMany: vi.fn() },
    labourSubcategory: { count: vi.fn() },
    projectContractor: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    projectContractorLabourRate: {
      createMany: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    // The removal guard now asks about agreements and settlements too, and
    // counts attendance per contractor rather than probing for one row.
    labourAttendance: { findFirst: vi.fn(), groupBy: vi.fn() },
    contractorContract: { findMany: vi.fn() },
    contractorSettlement: { groupBy: vi.fn() },
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

import { setProjectContractors } from "./actions";

const PAPPU = "11111111-1111-4111-8111-111111111111";
const SADDAM = "44444444-4444-4444-8444-444444444444";
const MASON = "22222222-2222-4222-8222-222222222222";
const HELPER = "55555555-5555-4555-8555-555555555555";

/** An existing persisted ProjectContractor with stable ids. */
const existingPappu = {
  id: "pc-pappu",
  contractorId: PAPPU,
  contractRatePaise: null,
  contractRateUnit: null,
  labourRates: [
    { id: "lr-mason", labourSubcategoryId: MASON, ratePaise: 90_000, rateUnit: "day" },
  ],
};

beforeEach(() => {
  h.user = OWNER;
  h.prisma.project.findFirst.mockReset().mockResolvedValue({ pmId: "o1" });
  h.prisma.contractor.count.mockReset().mockResolvedValue(1);
  h.prisma.labourSubcategory.count.mockReset().mockResolvedValue(1);
  h.prisma.projectContractor.findMany.mockReset().mockResolvedValue([]);
  h.prisma.projectContractor.create.mockReset().mockResolvedValue({ id: "pc-new" });
  h.prisma.projectContractor.update.mockReset().mockResolvedValue({ id: "pc-pappu" });
  h.prisma.projectContractor.deleteMany.mockReset().mockResolvedValue({ count: 0 });
  h.prisma.projectContractorLabourRate.createMany.mockReset().mockResolvedValue({ count: 0 });
  h.prisma.projectContractorLabourRate.update.mockReset().mockResolvedValue({ id: "lr-mason" });
  h.prisma.projectContractorLabourRate.deleteMany.mockReset().mockResolvedValue({ count: 0 });
  h.prisma.labourAttendance.findFirst.mockReset().mockResolvedValue(null);
  // Nothing blocks a removal unless a test says so.
  h.prisma.contractor.findMany.mockReset().mockResolvedValue([
    { id: PAPPU, name: "Pappu Contractor" },
    { id: SADDAM, name: "Saddam Crew" },
  ]);
  h.prisma.labourAttendance.groupBy.mockReset().mockResolvedValue([]);
  h.prisma.contractorContract.findMany.mockReset().mockResolvedValue([]);
  h.prisma.contractorSettlement.groupBy.mockReset().mockResolvedValue([]);
  h.prisma.activityLog.create.mockReset().mockResolvedValue({ id: "a" });
  h.prisma.$transaction.mockReset().mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(h.prisma) : Promise.all(arg as unknown[]),
  );
});

/**
 * The first read inside the diff is the existing set; the final read is the
 * fresh set returned to the caller. Both go through projectContractor.findMany.
 */
function withExisting(rows: unknown[]) {
  h.prisma.projectContractor.findMany
    .mockReset()
    .mockResolvedValueOnce(rows) // diff read
    .mockResolvedValue([]); // trailing read for the return value
}

describe("setProjectContractors — rate-row identity is stable (the provenance fix)", () => {
  it("re-saving an unchanged config touches no rate row at all", async () => {
    withExisting([existingPappu]);

    await setProjectContractors("p1", [
      { contractorId: PAPPU, labourRates: [{ labourSubcategoryId: MASON, ratePaise: 90_000 }] },
    ]);

    // The whole point: no delete, no recreate, no update — the id survives.
    expect(h.prisma.projectContractor.deleteMany).not.toHaveBeenCalled();
    expect(h.prisma.projectContractor.create).not.toHaveBeenCalled();
    expect(h.prisma.projectContractorLabourRate.deleteMany).not.toHaveBeenCalled();
    expect(h.prisma.projectContractorLabourRate.createMany).not.toHaveBeenCalled();
    expect(h.prisma.projectContractorLabourRate.update).not.toHaveBeenCalled();
  });

  it("a rate change updates the EXISTING row by id rather than replacing it", async () => {
    withExisting([existingPappu]);

    await setProjectContractors("p1", [
      { contractorId: PAPPU, labourRates: [{ labourSubcategoryId: MASON, ratePaise: 95_000 }] },
    ]);

    expect(h.prisma.projectContractorLabourRate.update).toHaveBeenCalledWith({
      where: { id: "lr-mason" },
      data: { ratePaise: 95_000, rateUnit: "day" },
    });
    expect(h.prisma.projectContractorLabourRate.createMany).not.toHaveBeenCalled();
    expect(h.prisma.projectContractorLabourRate.deleteMany).not.toHaveBeenCalled();
  });

  it("adding a labour type creates only the new row and leaves the existing id alone", async () => {
    withExisting([existingPappu]);
    h.prisma.labourSubcategory.count.mockResolvedValue(2);

    await setProjectContractors("p1", [
      {
        contractorId: PAPPU,
        labourRates: [
          { labourSubcategoryId: MASON, ratePaise: 90_000 },
          { labourSubcategoryId: HELPER, ratePaise: 60_000 },
        ],
      },
    ]);

    const created = h.prisma.projectContractorLabourRate.createMany.mock.calls[0][0];
    expect(created.data).toHaveLength(1);
    expect(created.data[0]).toMatchObject({
      projectContractorId: "pc-pappu",
      labourSubcategoryId: HELPER,
      ratePaise: 60_000,
    });
    expect(h.prisma.projectContractorLabourRate.update).not.toHaveBeenCalled();
    expect(h.prisma.projectContractorLabourRate.deleteMany).not.toHaveBeenCalled();
  });

  it("removing one labour type deletes only that row, by id", async () => {
    withExisting([
      {
        ...existingPappu,
        labourRates: [
          { id: "lr-mason", labourSubcategoryId: MASON, ratePaise: 90_000, rateUnit: "day" },
          { id: "lr-helper", labourSubcategoryId: HELPER, ratePaise: 60_000, rateUnit: "day" },
        ],
      },
    ]);

    await setProjectContractors("p1", [
      { contractorId: PAPPU, labourRates: [{ labourSubcategoryId: MASON, ratePaise: 90_000 }] },
    ]);

    expect(h.prisma.projectContractorLabourRate.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["lr-helper"] } },
    });
    expect(h.prisma.projectContractorLabourRate.createMany).not.toHaveBeenCalled();
  });

  it("adding a SECOND contractor leaves the first contractor's rows untouched", async () => {
    withExisting([existingPappu]);
    h.prisma.contractor.count.mockResolvedValue(2);

    await setProjectContractors("p1", [
      { contractorId: PAPPU, labourRates: [{ labourSubcategoryId: MASON, ratePaise: 90_000 }] },
      { contractorId: SADDAM, labourRates: [{ labourSubcategoryId: MASON, ratePaise: 85_000 }] },
    ]);

    expect(h.prisma.projectContractor.create).toHaveBeenCalledTimes(1);
    expect(h.prisma.projectContractor.create.mock.calls[0][0].data).toMatchObject({
      contractorId: SADDAM,
    });
    // Pappu's existing rate row is neither deleted nor rewritten.
    expect(h.prisma.projectContractorLabourRate.deleteMany).not.toHaveBeenCalled();
    expect(h.prisma.projectContractorLabourRate.update).not.toHaveBeenCalled();
  });

  it("updates the agreement rate in place when only it changed", async () => {
    withExisting([existingPappu]);

    await setProjectContractors("p1", [
      {
        contractorId: PAPPU,
        contractRatePaise: 1_500_000,
        contractRateUnit: "lumpsum",
        labourRates: [{ labourSubcategoryId: MASON, ratePaise: 90_000 }],
      },
    ]);

    expect(h.prisma.projectContractor.update).toHaveBeenCalledWith({
      where: { id: "pc-pappu" },
      data: { contractRatePaise: 1_500_000, contractRateUnit: "lumpsum" },
    });
    expect(h.prisma.projectContractor.create).not.toHaveBeenCalled();
  });
});

describe("setProjectContractors — dropping a contractor is governed", () => {
  it("drops a contractor that has no attendance", async () => {
    withExisting([existingPappu]);
    h.prisma.labourAttendance.findFirst.mockResolvedValue(null);

    await setProjectContractors("p1", []);

    expect(h.prisma.projectContractor.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["pc-pappu"] } },
    });
  });

  it("refuses to drop a contractor that already has attendance", async () => {
    withExisting([existingPappu]);
    h.prisma.labourAttendance.groupBy.mockResolvedValue([
      { contractorId: PAPPU, _count: { _all: 1 } },
    ]);

    // Returned, not thrown: Next masks Server Action messages in production, so
    // the reason now travels as a typed result the client can turn into a
    // sentence naming what is in the way. The rule itself is unchanged.
    const res = await setProjectContractors("p1", []);
    expect(res).toHaveProperty("blockedRemovals");
    const [blocked] = (res as { blockedRemovals: { attendanceCount: number }[] }).blockedRemovals;
    expect(blocked.attendanceCount).toBe(1);
    expect(h.prisma.projectContractor.deleteMany).not.toHaveBeenCalled();
  });

  it("scopes the dependency checks to the dropped contractors only", async () => {
    withExisting([
      existingPappu,
      {
        id: "pc-saddam",
        contractorId: SADDAM,
        contractRatePaise: null,
        contractRateUnit: null,
        labourRates: [],
      },
    ]);

    await setProjectContractors("p1", [
      { contractorId: PAPPU, labourRates: [{ labourSubcategoryId: MASON, ratePaise: 90_000 }] },
    ]);

    const where = h.prisma.labourAttendance.groupBy.mock.calls[0][0].where;
    expect(where).toMatchObject({ companyId: "c1", projectId: "p1" });
    expect(where.contractorId).toEqual({ in: [SADDAM] });
  });

  it("never queries dependencies when nothing is being dropped", async () => {
    withExisting([existingPappu]);

    await setProjectContractors("p1", [
      { contractorId: PAPPU, labourRates: [{ labourSubcategoryId: MASON, ratePaise: 95_000 }] },
    ]);

    expect(h.prisma.labourAttendance.groupBy).not.toHaveBeenCalled();
    expect(h.prisma.contractorContract.findMany).not.toHaveBeenCalled();
  });
});
