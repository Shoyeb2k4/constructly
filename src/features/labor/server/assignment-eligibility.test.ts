/**
 * The attendance eligibility check must resolve the labour category SERVER-SIDE
 * from the submitted subcategory and require an exact
 * (company, project, contractor, category) assignment — the client never gets to
 * assert the category. Proves the "Pappu (Civil) cannot be written against Tiles"
 * guarantee at the unit level.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  prisma: {
    labourSubcategory: { findFirst: vi.fn() },
    projectContractorAssignment: { findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: h.prisma }));

import { isAttributionEligible } from "./assignment-eligibility";

beforeEach(() => {
  h.prisma.labourSubcategory.findFirst.mockReset();
  h.prisma.projectContractorAssignment.findFirst.mockReset();
});

describe("isAttributionEligible", () => {
  it("returns false when the subcategory is unknown in the company (no assignment lookup)", async () => {
    h.prisma.labourSubcategory.findFirst.mockResolvedValue(null);
    expect(await isAttributionEligible("c1", "p1", "pappu", "sub-x")).toBe(false);
    expect(h.prisma.projectContractorAssignment.findFirst).not.toHaveBeenCalled();
  });

  it("Pappu (assigned to Civil) against a Tiles subcategory → false", async () => {
    // Server resolves the category from the subcategory: this sub belongs to Tiles.
    h.prisma.labourSubcategory.findFirst.mockResolvedValue({ categoryId: "tiles" });
    // No assignment exists for (p1, pappu, tiles).
    h.prisma.projectContractorAssignment.findFirst.mockResolvedValue(null);

    expect(await isAttributionEligible("c1", "p1", "pappu", "tiles-sub")).toBe(false);
    // The assignment lookup used the SERVER-resolved category, not any client value.
    expect(h.prisma.projectContractorAssignment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: "c1",
          projectId: "p1",
          contractorId: "pappu",
          labourCategoryId: "tiles",
        }),
      }),
    );
  });

  it("Pappu against a Civil subcategory (his assigned category) → true", async () => {
    h.prisma.labourSubcategory.findFirst.mockResolvedValue({ categoryId: "civil" });
    h.prisma.projectContractorAssignment.findFirst.mockResolvedValue({ id: "a1" });
    expect(await isAttributionEligible("c1", "p1", "pappu", "civil-sub")).toBe(true);
  });
});
