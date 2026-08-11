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
  },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: h.prisma }));

import {
  isAttributionEligible,
  findProjectContractorRate,
  resolveAttendanceRate,
} from "./assignment-eligibility";

beforeEach(() => {
  h.prisma.projectContractorLabourRate.findFirst.mockReset();
  h.prisma.labourSubcategory.findFirst.mockReset();
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
    });
  });

  it("falls back to the global rate for a null (unattributed) contractor", async () => {
    h.prisma.labourSubcategory.findFirst.mockResolvedValue({ dailyRatePaise: 40000 });
    expect(await resolveAttendanceRate("c1", "p1", null, "helper")).toEqual({
      ratePaise: 40000,
      projectContractorLabourRateId: null,
    });
    // A null contractor never looks up a project-contractor rate.
    expect(h.prisma.projectContractorLabourRate.findFirst).not.toHaveBeenCalled();
  });
});
