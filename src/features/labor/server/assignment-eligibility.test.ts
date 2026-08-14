/**
 * Contractor-first eligibility: a contractor may only be attributed to a
 * (project, subcategory) attendance row when they SUPPLY that subcategory on the
 * project — i.e. a ProjectContractorLabourRate exists for
 * (company, project, contractor, subcategory). Subcategory-exact; the client
 * never asserts eligibility. Also covers rate resolution + fallback.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  prisma: {
    projectContractorLabourRate: { findFirst: vi.fn() },
    labourSubcategory: { findFirst: vi.fn() },
    contractorContract: { findMany: vi.fn() },
    contractScopeItem: { findFirst: vi.fn() },
    contractScopeRateRevision: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: h.prisma }));

import {
  eligibleAgreements,
  isAgreementAttributionEligible,
  isAttributionEligible,
  findProjectContractorRate,
  resolveAgreementRateOn,
  resolveAttendanceRate,
} from "./assignment-eligibility";

beforeEach(() => {
  h.prisma.projectContractorLabourRate.findFirst.mockReset();
  h.prisma.labourSubcategory.findFirst.mockReset();
  h.prisma.contractorContract.findMany.mockReset();
  h.prisma.contractScopeItem.findFirst.mockReset();
  h.prisma.contractScopeRateRevision.findMany.mockReset();
});

describe("isAttributionEligible", () => {
  it("false when the contractor doesn't supply the subcategory on the project", async () => {
    h.prisma.projectContractorLabourRate.findFirst.mockResolvedValue(null);
    expect(await isAttributionEligible("c1", "p1", "pappu", "tiles-sub")).toBe(false);
    // The lookup is scoped through the ProjectContractor join (company+project+contractor).
    expect(h.prisma.projectContractorLabourRate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: "c1",
          labourSubcategoryId: "tiles-sub",
          projectContractor: { is: { companyId: "c1", projectId: "p1", contractorId: "pappu" } },
        }),
      }),
    );
  });

  it("true when a project-contractor rate exists for that subcategory", async () => {
    h.prisma.projectContractorLabourRate.findFirst.mockResolvedValue({ id: "r1", ratePaise: 85000 });
    expect(await isAttributionEligible("c1", "p1", "pappu", "centering")).toBe(true);
  });
});

describe("findProjectContractorRate", () => {
  it("returns the configured rate row or null", async () => {
    h.prisma.projectContractorLabourRate.findFirst.mockResolvedValue({ id: "r1", ratePaise: 95000 });
    expect(await findProjectContractorRate("c1", "p1", "pappu", "mason")).toEqual({ id: "r1", ratePaise: 95000 });
    h.prisma.projectContractorLabourRate.findFirst.mockResolvedValue(null);
    expect(await findProjectContractorRate("c1", "p1", "pappu", "mason")).toBeNull();
  });
});

describe("resolveAttendanceRate", () => {
  it("uses the project+contractor rate + provenance when configured", async () => {
    h.prisma.projectContractorLabourRate.findFirst.mockResolvedValue({ id: "r1", ratePaise: 85000 });
    expect(await resolveAttendanceRate("c1", "p1", "pappu", "centering")).toEqual({
      ratePaise: 85000,
      projectContractorLabourRateId: "r1",
      contractScopeRateRevisionId: null,
    });
    // No global-rate fallback needed.
    expect(h.prisma.labourSubcategory.findFirst).not.toHaveBeenCalled();
  });

  it("falls back to the subcategory global rate (no provenance) when unconfigured", async () => {
    h.prisma.projectContractorLabourRate.findFirst.mockResolvedValue(null);
    h.prisma.labourSubcategory.findFirst.mockResolvedValue({ dailyRatePaise: 60000 });
    expect(await resolveAttendanceRate("c1", "p1", "pappu", "mason")).toEqual({
      ratePaise: 60000,
      projectContractorLabourRateId: null,
      contractScopeRateRevisionId: null,
    });
  });

  it("falls back to the global rate for a null (unattributed) contractor", async () => {
    h.prisma.labourSubcategory.findFirst.mockResolvedValue({ dailyRatePaise: 40000 });
    expect(await resolveAttendanceRate("c1", "p1", null, "helper")).toEqual({
      ratePaise: 40000,
      projectContractorLabourRateId: null,
      contractScopeRateRevisionId: null,
    });
    // A null contractor never looks up a project-contractor rate.
    expect(h.prisma.projectContractorLabourRate.findFirst).not.toHaveBeenCalled();
  });
});

/* ── Agreement-aware attendance ─────────────────────────────────────────── */

describe("eligibleAgreements", () => {
  it("asks only for open, scoped agreements of this contractor on this project", async () => {
    h.prisma.contractorContract.findMany.mockResolvedValue([
      { id: "ag1", title: "Structure", reference: "AGR-1", status: "IN_PROGRESS" },
      { id: "ag2", title: "Compound Wall", reference: null, status: "NOT_STARTED" },
    ]);
    const rows = await eligibleAgreements("c1", "p1", "pappu");
    expect(rows.map((r) => r.contractId)).toEqual(["ag1", "ag2"]);

    const where = h.prisma.contractorContract.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      companyId: "c1",
      projectId: "p1",
      contractorId: "pappu",
      deletedAt: null,
    });
    // CANCELLED and SETTLED must not appear: one is void, the other was signed
    // off with nothing due, and new labour would silently reopen a balance.
    expect(where.status.in).not.toContain("CANCELLED");
    expect(where.status.in).not.toContain("SETTLED");
    // An agreement with no scope defines no labour types — a dead end.
    expect(where.scopeItems).toEqual({ some: { deletedAt: null } });
  });

  it("returns an empty list for the attendance-only contractor", async () => {
    h.prisma.contractorContract.findMany.mockResolvedValue([]);
    expect(await eligibleAgreements("c1", "p1", "ramesh")).toEqual([]);
  });
});

describe("isAgreementAttributionEligible", () => {
  it("requires the agreement to be this contractor's on this project AND to cover the labour type", async () => {
    h.prisma.contractScopeItem.findFirst.mockResolvedValue({ id: "si1" });
    expect(await isAgreementAttributionEligible("c1", "p1", "pappu", "ag1", "mason")).toBe(true);

    const where = h.prisma.contractScopeItem.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ companyId: "c1", contractId: "ag1", labourSubcategoryId: "mason", deletedAt: null });
    expect(where.contract.is).toMatchObject({ projectId: "p1", contractorId: "pappu", deletedAt: null });
  });

  it("false when the agreement's scope doesn't cover that labour type", async () => {
    h.prisma.contractScopeItem.findFirst.mockResolvedValue(null);
    expect(await isAgreementAttributionEligible("c1", "p1", "pappu", "ag1", "tiles")).toBe(false);
  });
});

describe("resolveAgreementRateOn", () => {
  it("asks for the latest revision effective ON OR BEFORE the row's own date", async () => {
    h.prisma.contractScopeItem.findFirst.mockResolvedValue({ id: "si1" });
    h.prisma.contractScopeRateRevision.findMany.mockResolvedValue([{ id: "rev1", ratePaise: 85000 }]);

    expect(await resolveAgreementRateOn("c1", "ag1", "mason", "2026-03-15")).toEqual({
      ratePaise: 85000,
      contractScopeRateRevisionId: "rev1",
    });

    const args = h.prisma.contractScopeRateRevision.findMany.mock.calls[0][0];
    expect(args.where.effectiveFrom).toEqual({ lte: new Date("2026-03-15") });
    // Latest effective date wins; a same-day correction is the one created last.
    expect(args.orderBy).toEqual([{ effectiveFrom: "desc" }, { createdAt: "desc" }]);
    expect(args.take).toBe(1);
  });

  it("null when no revision was yet in force on that date", async () => {
    h.prisma.contractScopeItem.findFirst.mockResolvedValue({ id: "si1" });
    h.prisma.contractScopeRateRevision.findMany.mockResolvedValue([]);
    expect(await resolveAgreementRateOn("c1", "ag1", "mason", "2025-01-01")).toBeNull();
  });

  it("null when the agreement doesn't cover the labour type at all", async () => {
    h.prisma.contractScopeItem.findFirst.mockResolvedValue(null);
    expect(await resolveAgreementRateOn("c1", "ag1", "tiles", "2026-03-15")).toBeNull();
    expect(h.prisma.contractScopeRateRevision.findMany).not.toHaveBeenCalled();
  });
});

describe("resolveAttendanceRate — agreement tier", () => {
  it("prefers the agreement rate and records its revision as provenance", async () => {
    h.prisma.contractScopeItem.findFirst.mockResolvedValue({ id: "si1" });
    h.prisma.contractScopeRateRevision.findMany.mockResolvedValue([{ id: "rev2", ratePaise: 90000 }]);

    expect(
      await resolveAttendanceRate("c1", "p1", "pappu", "mason", "ag1", "2026-04-02"),
    ).toEqual({
      ratePaise: 90000,
      projectContractorLabourRateId: null,
      contractScopeRateRevisionId: "rev2",
    });
    // Tier 1 answered, so the project-contractor rate is never consulted.
    expect(h.prisma.projectContractorLabourRate.findFirst).not.toHaveBeenCalled();
  });

  it("resolves as at the ROW'S date, so a later revision cannot retro-price it", async () => {
    h.prisma.contractScopeItem.findFirst.mockResolvedValue({ id: "si1" });
    h.prisma.contractScopeRateRevision.findMany.mockResolvedValue([{ id: "rev1", ratePaise: 85000 }]);

    await resolveAttendanceRate("c1", "p1", "pappu", "mason", "ag1", "2026-02-10");
    expect(h.prisma.contractScopeRateRevision.findMany.mock.calls[0][0].where.effectiveFrom).toEqual({
      lte: new Date("2026-02-10"),
    });
  });

  it("falls through to the project-contractor rate when the agreement prices nothing yet", async () => {
    h.prisma.contractScopeItem.findFirst.mockResolvedValue({ id: "si1" });
    h.prisma.contractScopeRateRevision.findMany.mockResolvedValue([]);
    h.prisma.projectContractorLabourRate.findFirst.mockResolvedValue({ id: "r1", ratePaise: 70000 });

    expect(
      await resolveAttendanceRate("c1", "p1", "pappu", "mason", "ag1", "2026-01-01"),
    ).toEqual({
      ratePaise: 70000,
      projectContractorLabourRateId: "r1",
      contractScopeRateRevisionId: null,
    });
  });

  it("skips tier 1 entirely when there is no agreement (backward compatible)", async () => {
    h.prisma.projectContractorLabourRate.findFirst.mockResolvedValue({ id: "r1", ratePaise: 70000 });
    await resolveAttendanceRate("c1", "p1", "pappu", "mason", null, "2026-04-02");
    expect(h.prisma.contractScopeItem.findFirst).not.toHaveBeenCalled();
  });
});
