/**
 * Server-side guards on amendment approval.
 *
 * Two gaps this pass found and closed, both without a schema change:
 *
 *   1. Approval never looked at the AGREEMENT's status, so a proposal raised
 *      before a cancellation or close-out could still land afterwards.
 *   2. The floor (never below credited, never below earned) was checked only at
 *      PROPOSAL time. A reduction raised while little was earned stays PROPOSED
 *      while milestones carry earned value above it — and that does NOT make it
 *      stale, because `currentAmountPaise` never moved. Approving it would leave
 *      an agreement authorising less than it has already recognised as earned.
 *
 * Plus the concurrency lock: AMENDMENT_STALE alone cannot stop two simultaneous
 * approvals, because both read the same pre-commit value.
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
const AMENDMENT = "55555555-5555-4555-8555-555555555555";
const L = (lakhs: number) => lakhs * 100_000 * 100;

const h = vi.hoisted(() => ({
  user: null as SessionUser | null,
  prisma: {
    contractorContract: { findFirst: vi.fn(), findFirstOrThrow: vi.fn(), update: vi.fn() },
    contractAmendment: { findFirst: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn() },
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

import { approveAmendment, proposeAmendment, rejectAmendment } from "./amendments";

/** An agreement row complete enough for `toSnapshot` / `reconcileAgreement`. */
function agreement(over: {
  status?: string;
  currentAmountPaise?: number;
  milestones?: { id: string; status: string; valuePaise: bigint }[];
  payments?: { id: string; amountPaise: bigint; date: Date; type: string; deletedAt: Date | null }[];
} = {}) {
  return {
    id: CONTRACT,
    companyId: "c1",
    contractorId: "ctr1",
    projectId: "p1",
    title: "Structure",
    status: over.status ?? "IN_PROGRESS",
    originalAmountPaise: BigInt(L(60)),
    currentAmountPaise: BigInt(over.currentAmountPaise ?? L(60)),
    contractor: { name: "Pappu" },
    project: { name: "Skyline" },
    amendments: [],
    milestones: over.milestones ?? [],
    payments: over.payments ?? [],
    attendance: [],
  };
}

function proposedAmendment(revisedPaise = L(65), previousPaise = L(60)) {
  return {
    id: AMENDMENT,
    contractId: CONTRACT,
    status: "PROPOSED",
    previousAmountPaise: BigInt(previousPaise),
    revisedAmountPaise: BigInt(revisedPaise),
    deltaPaise: BigInt(revisedPaise - previousPaise),
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
  h.prisma.contractorContract.findFirst.mockResolvedValue(agreement());
  h.prisma.contractorContract.findFirstOrThrow.mockResolvedValue(agreement());
  h.prisma.contractorContract.update.mockResolvedValue({ id: CONTRACT });
  h.prisma.contractAmendment.findFirst.mockResolvedValue(proposedAmendment());
  h.prisma.contractAmendment.count.mockResolvedValue(0);
  h.prisma.contractAmendment.create.mockResolvedValue({ id: AMENDMENT });
  h.prisma.contractAmendment.update.mockResolvedValue({ id: AMENDMENT });
});

/* ── Agreement lifecycle ────────────────────────────────────────────────── */

describe("agreement lifecycle guards on approval", () => {
  it("refuses approval on a cancelled agreement", async () => {
    h.prisma.contractorContract.findFirst.mockResolvedValue(agreement({ status: "CANCELLED" }));
    await expect(approveAmendment(AMENDMENT)).rejects.toThrow("AGREEMENT_CANCELLED");
    expect(h.prisma.contractorContract.update).not.toHaveBeenCalled();
  });

  it("refuses approval on a settled agreement", async () => {
    h.prisma.contractorContract.findFirst.mockResolvedValue(agreement({ status: "SETTLED" }));
    await expect(approveAmendment(AMENDMENT)).rejects.toThrow("AGREEMENT_SETTLED");
    expect(h.prisma.contractorContract.update).not.toHaveBeenCalled();
  });

  it("still refuses a PROPOSAL on a cancelled agreement", async () => {
    h.prisma.contractorContract.findFirst.mockResolvedValue(agreement({ status: "CANCELLED" }));
    await expect(
      proposeAmendment({
        contractId: CONTRACT,
        type: "VARIATION",
        revisedAmountPaise: L(65),
        reason: "Extra work",
        effectiveDate: "2026-05-20",
      }),
    ).rejects.toThrow("AGREEMENT_CANCELLED");
    expect(h.prisma.contractAmendment.create).not.toHaveBeenCalled();
  });

  it("allows approval on an on-hold or completed agreement", async () => {
    for (const status of ["ON_HOLD", "COMPLETED"]) {
      h.prisma.contractorContract.findFirst.mockResolvedValue(agreement({ status }));
      h.prisma.contractorContract.findFirstOrThrow.mockResolvedValue(agreement({ status }));
      await expect(approveAmendment(AMENDMENT)).resolves.toBeDefined();
    }
  });
});

/* ── The floor, re-checked at approval ──────────────────────────────────── */

describe("a reduction is re-checked against committed state", () => {
  it("refuses when earned value has risen above the revised value since proposal", async () => {
    // Raised as ₹60,00,000 → ₹30,00,000 when little was earned. Six ₹10,00,000
    // slabs have completed since: ₹60,00,000 earned.
    h.prisma.contractAmendment.findFirst.mockResolvedValue(proposedAmendment(L(30)));
    const withEarned = agreement({
      milestones: Array.from({ length: 6 }, (_, i) => ({
        id: `m${i}`,
        status: "COMPLETED",
        valuePaise: BigInt(L(10)),
      })),
    });
    h.prisma.contractorContract.findFirst.mockResolvedValue(withEarned);
    h.prisma.contractorContract.findFirstOrThrow.mockResolvedValue(withEarned);

    await expect(approveAmendment(AMENDMENT)).rejects.toThrow("REVISION_BELOW_EARNED");
    // Nothing partial: neither the amendment nor the value moved.
    expect(h.prisma.contractorContract.update).not.toHaveBeenCalled();
  });

  it("refuses when the revised value is below what has been credited", async () => {
    h.prisma.contractAmendment.findFirst.mockResolvedValue(proposedAmendment(L(2)));
    const withCredit = agreement({
      payments: [
        { id: "p1", amountPaise: BigInt(L(8)), date: new Date("2026-03-01"), type: "INTERIM", deletedAt: null },
      ],
    });
    h.prisma.contractorContract.findFirst.mockResolvedValue(withCredit);
    h.prisma.contractorContract.findFirstOrThrow.mockResolvedValue(withCredit);

    await expect(approveAmendment(AMENDMENT)).rejects.toThrow("REVISION_BELOW_CREDITED");
    expect(h.prisma.contractorContract.update).not.toHaveBeenCalled();
  });

  it("allows a reduction that still clears the floor", async () => {
    h.prisma.contractAmendment.findFirst.mockResolvedValue(proposedAmendment(L(30)));
    const oneSlab = agreement({
      milestones: [{ id: "m1", status: "COMPLETED", valuePaise: BigInt(L(10)) }],
    });
    h.prisma.contractorContract.findFirst.mockResolvedValue(oneSlab);
    h.prisma.contractorContract.findFirstOrThrow.mockResolvedValue(oneSlab);

    await expect(approveAmendment(AMENDMENT)).resolves.toBeDefined();
    expect(h.prisma.contractorContract.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { currentAmountPaise: BigInt(L(30)) } }),
    );
  });
});

/* ── Staleness + concurrency ────────────────────────────────────────────── */

describe("staleness and concurrency", () => {
  it("refuses an amendment raised against a value that has since moved", async () => {
    h.prisma.contractorContract.findFirstOrThrow.mockResolvedValue(
      agreement({ currentAmountPaise: L(62) }),
    );
    await expect(approveAmendment(AMENDMENT)).rejects.toThrow("AMENDMENT_STALE");
    expect(h.prisma.contractorContract.update).not.toHaveBeenCalled();
  });

  it("locks the agreement row FOR UPDATE before reading it", async () => {
    await approveAmendment(AMENDMENT);
    expect(h.prisma.$queryRaw).toHaveBeenCalled();
    const sql = h.prisma.$queryRaw.mock.calls[0][0].join("?");
    expect(sql).toMatch(/contractor_contracts/);
    expect(sql).toMatch(/FOR UPDATE/);
  });

  it("applies the revised value exactly once on a clean approval", async () => {
    await approveAmendment(AMENDMENT);
    expect(h.prisma.contractorContract.update).toHaveBeenCalledTimes(1);
    expect(h.prisma.contractorContract.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { currentAmountPaise: BigInt(L(65)) } }),
    );
    expect(h.prisma.contractAmendment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "APPROVED" }) }),
    );
  });

  it("refuses an amendment that is no longer proposed", async () => {
    h.prisma.contractAmendment.findFirst.mockResolvedValue({
      ...proposedAmendment(),
      status: "APPROVED",
    });
    await expect(approveAmendment(AMENDMENT)).rejects.toThrow("AMENDMENT_NOT_PROPOSED");
  });
});

/* ── Maker / checker ────────────────────────────────────────────────────── */

describe("maker–checker", () => {
  it("proposing needs contracts.edit", async () => {
    h.user = u(["contracts.view", "contracts.amend_approve"]);
    await expect(
      proposeAmendment({
        contractId: CONTRACT,
        type: "VARIATION",
        revisedAmountPaise: L(65),
        reason: "Extra",
        effectiveDate: "2026-05-20",
      }),
    ).rejects.toThrow();
    expect(h.prisma.contractAmendment.create).not.toHaveBeenCalled();
  });

  it("contracts.edit alone cannot approve", async () => {
    h.user = u(["contracts.view", "contracts.edit"]);
    await expect(approveAmendment(AMENDMENT)).rejects.toThrow();
    expect(h.prisma.contractorContract.update).not.toHaveBeenCalled();
  });

  it("contracts.edit alone cannot reject either", async () => {
    h.user = u(["contracts.view", "contracts.edit"]);
    await expect(rejectAmendment(AMENDMENT, "No")).rejects.toThrow();
    expect(h.prisma.contractAmendment.update).not.toHaveBeenCalled();
  });

  it("contracts.amend_approve can approve and reject", async () => {
    h.user = u(["contracts.view", "contracts.amend_approve", "projects.view_all"]);
    await expect(approveAmendment(AMENDMENT)).resolves.toBeDefined();

    h.prisma.contractAmendment.findFirst.mockResolvedValue(proposedAmendment());
    await expect(rejectAmendment(AMENDMENT, "Not agreed")).resolves.toBeDefined();
  });

  it("rejection moves no value", async () => {
    await rejectAmendment(AMENDMENT, "Not agreed");
    expect(h.prisma.contractorContract.update).not.toHaveBeenCalled();
    expect(h.prisma.contractAmendment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "REJECTED", rejectedReason: "Not agreed" }),
      }),
    );
  });
});
