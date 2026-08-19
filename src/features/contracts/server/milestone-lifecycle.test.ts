/**
 * Server-side lifecycle guards for milestones.
 *
 * Two things the milestone actions previously did not check, both found while
 * building the tab:
 *
 *   1. Nothing looked at the AGREEMENT's own status, so earned value could be
 *      recognised on a cancelled agreement, and a close-out signed off as SETTLED
 *      could be contradicted by reopening a milestone underneath it.
 *   2. Completion checked the earned-value ceiling but did not SERIALIZE, so two
 *      concurrent completions of different milestones could both pass it.
 *
 * Both are fixed without a schema change; these tests pin the fixes.
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

const CONTRACT = "33333333-3333-4333-8333-333333333333";
const MILESTONE = "44444444-4444-4444-8444-444444444444";

const h = vi.hoisted(() => ({
  user: null as SessionUser | null,
  prisma: {
    contractorContract: { findFirst: vi.fn(), findFirstOrThrow: vi.fn() },
    contractMilestone: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findFirstOrThrow: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    contractorContractPayment: { aggregate: vi.fn(), count: vi.fn() },
    activityLog: { create: vi.fn() },
    $queryRaw: vi.fn(),
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

import {
  createMilestone,
  deleteMilestone,
  reorderMilestones,
  setMilestoneStatus,
  updateMilestone,
} from "./milestones";

/** An agreement row shaped enough for `toSnapshot` / `toMilestones`. */
function agreement(status: string, milestones: unknown[] = []) {
  return {
    id: CONTRACT,
    companyId: "c1",
    contractorId: "ctr1",
    projectId: "p1",
    title: "Structure",
    status,
    originalAmountPaise: BigInt(600_000_000),
    currentAmountPaise: BigInt(600_000_000),
    contractor: { name: "Pappu" },
    project: { name: "Skyline" },
    amendments: [],
    milestones,
    payments: [],
    attendance: [],
  };
}

function milestoneRow(status = "NOT_STARTED") {
  return {
    id: MILESTONE,
    contractId: CONTRACT,
    title: "Slab 1",
    status,
    valuePaise: BigInt(100_000_000),
  };
}

beforeEach(() => {
  h.user = OWNER;
  Object.values(h.prisma).forEach((m) => {
    if (typeof m === "object") {
      Object.values(m).forEach((f) => (f as ReturnType<typeof vi.fn>).mockReset?.());
    }
  });
  h.prisma.$queryRaw.mockReset().mockResolvedValue([]);
  h.prisma.$transaction.mockReset().mockImplementation(async (fn: (tx: unknown) => unknown) =>
    typeof fn === "function" ? fn(h.prisma) : undefined,
  );
  h.prisma.contractorContract.findFirst.mockResolvedValue(agreement("IN_PROGRESS"));
  h.prisma.contractorContract.findFirstOrThrow.mockResolvedValue(agreement("IN_PROGRESS"));
  h.prisma.contractMilestone.findFirst.mockResolvedValue(milestoneRow());
  h.prisma.contractMilestone.findFirstOrThrow.mockResolvedValue({
    status: "NOT_STARTED",
    valuePaise: BigInt(100_000_000),
  });
  h.prisma.contractMilestone.findMany.mockResolvedValue([]);
  h.prisma.contractMilestone.count.mockResolvedValue(0);
  h.prisma.contractMilestone.create.mockResolvedValue({ id: MILESTONE });
  h.prisma.contractMilestone.update.mockResolvedValue({ id: MILESTONE });
  h.prisma.contractorContractPayment.aggregate.mockResolvedValue({ _sum: { amountPaise: null } });
  h.prisma.contractorContractPayment.count.mockResolvedValue(0);
});

/* ── Cancelled agreement ────────────────────────────────────────────────── */

describe("a cancelled agreement accepts no milestone change", () => {
  beforeEach(() => {
    h.prisma.contractorContract.findFirst.mockResolvedValue(agreement("CANCELLED"));
  });

  it("refuses creating a milestone", async () => {
    await expect(
      createMilestone({ contractId: CONTRACT, title: "Slab 7", valuePaise: 100_000_000 }),
    ).rejects.toThrow("AGREEMENT_CANCELLED");
    expect(h.prisma.contractMilestone.create).not.toHaveBeenCalled();
  });

  it("refuses completing a milestone", async () => {
    await expect(setMilestoneStatus(MILESTONE, "COMPLETED")).rejects.toThrow("AGREEMENT_CANCELLED");
    expect(h.prisma.contractMilestone.update).not.toHaveBeenCalled();
  });

  it("refuses deleting a milestone", async () => {
    await expect(deleteMilestone(MILESTONE)).rejects.toThrow("AGREEMENT_CANCELLED");
  });

  it("refuses reordering — nothing about a void agreement should move", async () => {
    await expect(reorderMilestones(CONTRACT, [])).rejects.toThrow("AGREEMENT_CANCELLED");
  });
});

/* ── Settled agreement ──────────────────────────────────────────────────── */

describe("a settled agreement accepts no EARNED-VALUE change", () => {
  beforeEach(() => {
    h.prisma.contractorContract.findFirst.mockResolvedValue(agreement("SETTLED"));
  });

  it("refuses reopening a completed milestone", async () => {
    h.prisma.contractMilestone.findFirst.mockResolvedValue(milestoneRow("COMPLETED"));
    await expect(setMilestoneStatus(MILESTONE, "IN_PROGRESS")).rejects.toThrow("AGREEMENT_SETTLED");
    expect(h.prisma.contractMilestone.update).not.toHaveBeenCalled();
  });

  it("refuses adding a milestone", async () => {
    await expect(
      createMilestone({ contractId: CONTRACT, title: "Slab 7", valuePaise: 100_000_000 }),
    ).rejects.toThrow("AGREEMENT_SETTLED");
  });

  it("refuses changing a milestone's VALUE", async () => {
    await expect(updateMilestone(MILESTONE, { valuePaise: 200_000_000 })).rejects.toThrow(
      "AGREEMENT_SETTLED",
    );
  });

  it("still allows a cosmetic edit — a title moves no money", async () => {
    await expect(updateMilestone(MILESTONE, { title: "Slab one" })).resolves.toBeDefined();
    expect(h.prisma.contractMilestone.update).toHaveBeenCalled();
  });

  it("still allows reordering — presentation, not value", async () => {
    h.prisma.contractMilestone.findMany.mockResolvedValue([]);
    await expect(reorderMilestones(CONTRACT, [])).resolves.toBeDefined();
  });
});

/* ── Concurrency ────────────────────────────────────────────────────────── */

describe("completion serializes on the agreement", () => {
  it("locks the agreement row FOR UPDATE before reading milestone state", async () => {
    await setMilestoneStatus(MILESTONE, "COMPLETED");

    expect(h.prisma.$queryRaw).toHaveBeenCalled();
    const sql = h.prisma.$queryRaw.mock.calls[0][0].join("?");
    expect(sql).toMatch(/contractor_contracts/);
    expect(sql).toMatch(/FOR UPDATE/);
  });

  it("does nothing when the milestone is already in the target status", async () => {
    // The loser of a concurrent race: the winner already completed it.
    h.prisma.contractMilestone.findFirstOrThrow.mockResolvedValue({
      status: "COMPLETED",
      valuePaise: BigInt(100_000_000),
    });
    await setMilestoneStatus(MILESTONE, "COMPLETED");

    // No second status write, and no duplicate audit entry.
    expect(h.prisma.contractMilestone.update).not.toHaveBeenCalled();
    expect(h.prisma.activityLog.create).not.toHaveBeenCalled();
  });

  it("re-checks the ceiling against state read under the lock", async () => {
    // Under the lock the agreement is already fully earned, so this ₹10L
    // completion must be refused even though the pre-lock read allowed it.
    h.prisma.contractorContract.findFirstOrThrow.mockResolvedValue({
      ...agreement("IN_PROGRESS", [
        { id: "other", status: "COMPLETED", valuePaise: BigInt(600_000_000) },
      ]),
    });
    await expect(setMilestoneStatus(MILESTONE, "COMPLETED")).rejects.toThrow(
      "EARNED_VALUE_EXCEEDS_CONTRACT",
    );
    expect(h.prisma.contractMilestone.update).not.toHaveBeenCalled();
  });

  it("locks before raising a milestone's value too", async () => {
    await updateMilestone(MILESTONE, { valuePaise: 200_000_000 });
    const sql = h.prisma.$queryRaw.mock.calls[0][0].join("?");
    expect(sql).toMatch(/FOR UPDATE/);
  });

  it("does not lock for a cosmetic edit", async () => {
    await updateMilestone(MILESTONE, { title: "Slab one" });
    expect(h.prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

/* ── Permissions ────────────────────────────────────────────────────────── */

describe("permissions", () => {
  it("createMilestone demands contracts.edit before any database work", async () => {
    h.user = u(["contracts.view"]);
    await expect(
      createMilestone({ contractId: CONTRACT, title: "X", valuePaise: 1 }),
    ).rejects.toThrow();
    expect(h.prisma.contractMilestone.create).not.toHaveBeenCalled();
  });

  it("setMilestoneStatus demands contracts.complete, not merely edit", async () => {
    h.user = u(["contracts.view", "contracts.edit"]);
    await expect(setMilestoneStatus(MILESTONE, "COMPLETED")).rejects.toThrow();
    expect(h.prisma.contractMilestone.update).not.toHaveBeenCalled();
  });

  it("reorderMilestones demands contracts.edit", async () => {
    h.user = u(["contracts.view", "contracts.complete"]);
    await expect(reorderMilestones(CONTRACT, [])).rejects.toThrow();
  });

  it("deleteMilestone demands contracts.edit", async () => {
    h.user = u(["contracts.view", "contracts.complete"]);
    await expect(deleteMilestone(MILESTONE)).rejects.toThrow();
  });
});
