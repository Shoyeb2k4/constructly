/**
 * Server-side Phase 6 wiring: the agreement travels with every attendance
 * mutation, and the rate is resolved as at the row's own date.
 *
 * The failure these guard against is silent — a WHERE that drops `contractId`
 * still runs, still returns a sheet, and quietly clears or overwrites a
 * different agreement's day.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import { ALL_PERMISSIONS, type Permission } from "@/features/rbac/permissions";

function u(permissions: Permission[]): SessionUser {
  return {
    id: "pm1",
    email: "u@x.com",
    fullName: "U",
    role: "PROJECT_MANAGER",
    permissions,
    company: { id: "c1", name: "Co" },
  };
}
const OWNER = u([...ALL_PERMISSIONS]);

const h = vi.hoisted(() => ({
  user: null as SessionUser | null,
  prisma: {
    labourAttendance: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    projectContractor: { findMany: vi.fn() },
    projectContractorLabourRate: { findFirst: vi.fn() },
    contractorContract: { findMany: vi.fn() },
    contractScopeItem: { findFirst: vi.fn() },
    contractScopeRateRevision: { findMany: vi.fn() },
    labourSubcategory: { findFirst: vi.fn() },
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

import { setQuantity, getSheet } from "./actions";

const PROJECT = "p1";
const SUB = "sub-mason";
const CONTRACTOR = "pappu";
const STRUCTURE = "ag-structure";
const WALL = "ag-wall";
const DATE = "2026-06-15";

beforeEach(() => {
  h.user = OWNER;
  Object.values(h.prisma).forEach((m) =>
    Object.values(m).forEach((f) => (f as ReturnType<typeof vi.fn>).mockReset()),
  );
  h.prisma.project.findFirst.mockResolvedValue({ id: PROJECT });
  h.prisma.labourAttendance.findMany.mockResolvedValue([]);
  h.prisma.projectContractor.findMany.mockResolvedValue([]);
  h.prisma.contractorContract.findMany.mockResolvedValue([]);
  h.prisma.labourAttendance.deleteMany.mockResolvedValue({ count: 0 });
});

/** The agreement covers this labour type and prices it at `ratePaise`. */
function agreementCovers(ratePaise: number | null, revisionId = "rev1") {
  h.prisma.contractScopeItem.findFirst.mockResolvedValue({ id: "si1" });
  h.prisma.contractScopeRateRevision.findMany.mockResolvedValue(
    ratePaise == null ? [] : [{ id: revisionId, ratePaise }],
  );
}

describe("attendance identity carries the agreement", () => {
  it("a CLEAR deletes only the targeted agreement's row", async () => {
    h.prisma.labourAttendance.findFirst.mockResolvedValue(null); // nothing settled
    await setQuantity({
      projectId: PROJECT,
      date: DATE,
      subcategoryId: SUB,
      quantity: 0,
      contractorId: CONTRACTOR,
      contractId: STRUCTURE,
    });
    const where = h.prisma.labourAttendance.deleteMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      companyId: "c1",
      projectId: PROJECT,
      labourSubcategoryId: SUB,
      contractorId: CONTRACTOR,
      contractId: STRUCTURE,
    });
  });

  it("a clear on the attendance-only row targets contractId null, not 'any'", async () => {
    h.prisma.labourAttendance.findFirst.mockResolvedValue(null);
    await setQuantity({
      projectId: PROJECT,
      date: DATE,
      subcategoryId: SUB,
      quantity: 0,
      contractorId: CONTRACTOR,
    });
    expect(h.prisma.labourAttendance.deleteMany.mock.calls[0][0].where.contractId).toBeNull();
  });

  it("a new row stores the agreement and its rate provenance", async () => {
    agreementCovers(90_000, "rev-apr");
    h.prisma.labourAttendance.findFirst.mockResolvedValue(null);

    await setQuantity({
      projectId: PROJECT,
      date: DATE,
      subcategoryId: SUB,
      quantity: 6,
      contractorId: CONTRACTOR,
      contractId: STRUCTURE,
    });

    const data = h.prisma.labourAttendance.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      contractId: STRUCTURE,
      contractorId: CONTRACTOR,
      dailyRatePaiseSnapshot: 90_000,
      contractScopeRateRevisionId: "rev-apr",
      estimatedCostPaise: 6 * 90_000,
    });
  });

  it("looks the existing row up on the FULL five-field identity", async () => {
    agreementCovers(90_000);
    h.prisma.labourAttendance.findFirst.mockResolvedValue(null);
    await setQuantity({
      projectId: PROJECT,
      date: DATE,
      subcategoryId: SUB,
      quantity: 6,
      contractorId: CONTRACTOR,
      contractId: WALL,
    });
    // Call 0 = the settled guard, call 1 = the settled-elsewhere guard,
    // call 2 = the row lookup. All of them are keyed, none is a wildcard.
    const lookup = h.prisma.labourAttendance.findFirst.mock.calls.at(-1)![0].where;
    expect(lookup).toMatchObject({
      companyId: "c1",
      projectId: PROJECT,
      labourSubcategoryId: SUB,
      contractorId: CONTRACTOR,
      contractId: WALL,
    });
  });

  it("refuses an agreement whose scope doesn't cover the labour type", async () => {
    h.prisma.labourAttendance.findFirst.mockResolvedValue(null);
    h.prisma.contractScopeItem.findFirst.mockResolvedValue(null); // not in scope
    await expect(
      setQuantity({
        projectId: PROJECT,
        date: DATE,
        subcategoryId: SUB,
        quantity: 6,
        contractorId: CONTRACTOR,
        contractId: STRUCTURE,
      }),
    ).rejects.toThrow("AGREEMENT_SCOPE_MISMATCH");
    expect(h.prisma.labourAttendance.create).not.toHaveBeenCalled();
  });

  it("drops a stray agreement on an unattributed row — an agreement needs a contractor", async () => {
    h.prisma.labourAttendance.findFirst.mockResolvedValue(null);
    h.prisma.labourSubcategory.findFirst.mockResolvedValue({ dailyRatePaise: 50_000 });
    await setQuantity({
      projectId: PROJECT,
      date: DATE,
      subcategoryId: SUB,
      quantity: 3,
      contractorId: null,
      contractId: STRUCTURE,
    });
    expect(h.prisma.labourAttendance.create.mock.calls[0][0].data.contractId).toBeNull();
  });
});

describe("rate resolution uses the row's own date", () => {
  it("asks for the revision in force on the attendance date, not today", async () => {
    agreementCovers(85_000);
    h.prisma.labourAttendance.findFirst.mockResolvedValue(null);

    await setQuantity({
      projectId: PROJECT,
      date: "2026-02-20",
      subcategoryId: SUB,
      quantity: 4,
      contractorId: CONTRACTOR,
      contractId: STRUCTURE,
    });

    const where = h.prisma.contractScopeRateRevision.findMany.mock.calls[0][0].where;
    expect(where.effectiveFrom).toEqual({ lte: new Date("2026-02-20") });
  });

  it("keeps the original snapshot when editing an existing row", async () => {
    // The settled guards return null; the row lookup returns an existing row.
    h.prisma.labourAttendance.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "att1",
        dailyRatePaiseSnapshot: 85_000,
        projectContractorLabourRateId: null,
        contractScopeRateRevisionId: "rev-jan",
      });
    h.prisma.contractScopeItem.findFirst.mockResolvedValue({ id: "si1" });

    await setQuantity({
      projectId: PROJECT,
      date: "2026-02-20",
      subcategoryId: SUB,
      quantity: 7,
      contractorId: CONTRACTOR,
      contractId: STRUCTURE,
    });

    // No re-resolution at all — history is immutable (ADR-0022).
    expect(h.prisma.contractScopeRateRevision.findMany).not.toHaveBeenCalled();
    expect(h.prisma.labourAttendance.update.mock.calls[0][0].data).toMatchObject({
      quantityPresent: 7,
      estimatedCostPaise: 7 * 85_000,
    });
  });
});

describe("settled labour cannot be re-attributed", () => {
  it("refuses when the same day is already settled under another agreement", async () => {
    // First guard (this agreement) clean; second guard finds a settled row
    // under a DIFFERENT agreement.
    h.prisma.labourAttendance.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "att-settled" });

    await expect(
      setQuantity({
        projectId: PROJECT,
        date: DATE,
        subcategoryId: SUB,
        quantity: 6,
        contractorId: CONTRACTOR,
        contractId: WALL,
      }),
    ).rejects.toThrow("ATTENDANCE_SETTLED");
    expect(h.prisma.labourAttendance.create).not.toHaveBeenCalled();

    const where = h.prisma.labourAttendance.findFirst.mock.calls[1][0].where;
    expect(where.contractId).toEqual({ not: WALL });
    expect(where.settlementId).toEqual({ not: null });
  });
});

describe("the sheet is Contractor → Agreement → Labour Type", () => {
  const pappu = {
    contractorId: CONTRACTOR,
    contractor: { name: "Pappu Contractor" },
    contractRatePaise: null,
    contractRateUnit: null,
    labourRates: [
      {
        labourSubcategoryId: SUB,
        ratePaise: 100_000,
        subcategory: {
          name: "Mason",
          categoryId: "cat-m",
          displayOrder: 0,
          category: { name: "Mason" },
        },
      },
    ],
  };
  const scopeItem = (subId: string, name: string, ratePaise: number | null) => ({
    labourSubcategoryId: subId,
    subcategory: { name, categoryId: "cat-m", displayOrder: 0, category: { name: "Mason" } },
    revisions: ratePaise == null ? [] : [{ ratePaise }],
  });

  it("offers one section per agreement, each limited to its own scope", async () => {
    h.prisma.projectContractor.findMany.mockResolvedValue([pappu]);
    h.prisma.contractorContract.findMany.mockResolvedValue([
      {
        id: STRUCTURE,
        contractorId: CONTRACTOR,
        title: "Structure",
        reference: "AGR-1",
        status: "IN_PROGRESS",
        scopeItems: [scopeItem(SUB, "Mason", 90_000), scopeItem("sub-helper", "Mason Helper", 60_000)],
      },
      {
        id: WALL,
        contractorId: CONTRACTOR,
        title: "Compound Wall",
        reference: null,
        status: "NOT_STARTED",
        scopeItems: [scopeItem(SUB, "Mason", 80_000)],
      },
    ]);

    const sheet = await getSheet(PROJECT, DATE);
    const g = sheet.groups[0];
    expect(g.requiresAgreementChoice).toBe(true);
    expect(g.agreements.map((a) => a.title)).toEqual(["Structure", "Compound Wall"]);

    const structure = g.rows.filter((r) => r.contractId === STRUCTURE);
    const wall = g.rows.filter((r) => r.contractId === WALL);
    expect(structure.map((r) => r.subcategoryId)).toEqual([SUB, "sub-helper"]);
    expect(wall.map((r) => r.subcategoryId)).toEqual([SUB]);
    // Same labour type, two agreements, two agreed rates.
    expect(structure[0].dailyRatePaise).toBe(90_000);
    expect(wall[0].dailyRatePaise).toBe(80_000);
    // The project labour rate does NOT also appear as an unattributed row.
    expect(g.rows.some((r) => r.contractId === null)).toBe(false);
  });

  it("a contractor with no agreements keeps the attendance-only rows", async () => {
    h.prisma.projectContractor.findMany.mockResolvedValue([pappu]);
    h.prisma.contractorContract.findMany.mockResolvedValue([]);

    const sheet = await getSheet(PROJECT, DATE);
    const g = sheet.groups[0];
    expect(g.agreements).toEqual([]);
    expect(g.requiresAgreementChoice).toBe(false);
    expect(g.rows).toHaveLength(1);
    expect(g.rows[0].contractId).toBeNull();
    expect(g.rows[0].dailyRatePaise).toBe(100_000); // the project-contractor rate
  });

  it("asks the database only for OPEN, scoped agreements as at the sheet date", async () => {
    await getSheet(PROJECT, "2026-03-01");
    const args = h.prisma.contractorContract.findMany.mock.calls[0][0];
    expect(args.where.status.in).not.toContain("CANCELLED");
    expect(args.where.status.in).not.toContain("SETTLED");
    expect(args.where.scopeItems).toEqual({ some: { deletedAt: null } });
    expect(args.select.scopeItems.select.revisions.where.effectiveFrom).toEqual({
      lte: new Date("2026-03-01"),
    });
  });
});
