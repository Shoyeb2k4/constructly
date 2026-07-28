import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  prisma: {
    project: { findMany: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    activityLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: h.prisma }));

import { findPurgeEligibleProjects, purgeProject } from "./retention-cleanup";

const DAY = 86_400_000;
const NOW = new Date("2026-06-01T00:00:00Z");

beforeEach(() => {
  h.prisma.project.findMany.mockReset();
  h.prisma.project.findUnique.mockReset();
  h.prisma.project.delete.mockReset().mockResolvedValue({ id: "p" });
  h.prisma.activityLog.create.mockReset().mockReturnValue({ __op: "log" });
  h.prisma.$transaction
    .mockReset()
    .mockImplementation(async (ops: unknown) => (Array.isArray(ops) ? Promise.all(ops) : ops));
});

describe("findPurgeEligibleProjects", () => {
  it("returns only projects past their retention window", async () => {
    h.prisma.project.findMany.mockResolvedValue([
      // deleted 100 days ago, 90-day policy → eligible
      {
        id: "old",
        companyId: "c1",
        code: "PRJ-1",
        name: "Old",
        deletedAt: new Date(NOW.getTime() - 100 * DAY),
        company: { projectRetentionDays: 90 },
      },
      // deleted 10 days ago, 90-day policy → NOT eligible
      {
        id: "recent",
        companyId: "c1",
        code: "PRJ-2",
        name: "Recent",
        deletedAt: new Date(NOW.getTime() - 10 * DAY),
        company: { projectRetentionDays: 90 },
      },
    ]);
    const out = await findPurgeEligibleProjects(NOW);
    expect(out.map((c) => c.id)).toEqual(["old"]);
    expect(out[0].eligibleAt).toBeInstanceOf(Date);
  });
});

describe("purgeProject", () => {
  it("refuses a project that is not soft-deleted", async () => {
    h.prisma.project.findUnique.mockResolvedValue({
      id: "p",
      companyId: "c1",
      code: "PRJ-1",
      name: "Live",
      deletedAt: null,
      company: { projectRetentionDays: 90 },
    });
    await expect(purgeProject("p", NOW)).rejects.toThrow(/NOT_ELIGIBLE/);
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a project still within its retention window", async () => {
    h.prisma.project.findUnique.mockResolvedValue({
      id: "p",
      companyId: "c1",
      code: "PRJ-1",
      name: "Recent",
      deletedAt: new Date(NOW.getTime() - 10 * DAY),
      company: { projectRetentionDays: 90 },
    });
    await expect(purgeProject("p", NOW)).rejects.toThrow(/NOT_ELIGIBLE/);
    expect(h.prisma.project.delete).not.toHaveBeenCalled();
  });

  it("never purges under indefinite retention (null policy)", async () => {
    h.prisma.project.findUnique.mockResolvedValue({
      id: "p",
      companyId: "c1",
      code: "PRJ-1",
      name: "Kept",
      deletedAt: new Date(NOW.getTime() - 3650 * DAY),
      company: { projectRetentionDays: null },
    });
    await expect(purgeProject("p", NOW)).rejects.toThrow(/NOT_ELIGIBLE/);
  });

  it("hard-deletes and logs an audit entry when eligible", async () => {
    h.prisma.project.findUnique.mockResolvedValue({
      id: "p",
      companyId: "c1",
      code: "PRJ-1",
      name: "Old",
      deletedAt: new Date(NOW.getTime() - 100 * DAY),
      company: { projectRetentionDays: 90 },
    });
    await purgeProject("p", NOW);
    expect(h.prisma.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "project.purged" }) }),
    );
    expect(h.prisma.project.delete).toHaveBeenCalledWith({ where: { id: "p" } });
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
