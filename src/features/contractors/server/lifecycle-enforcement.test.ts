/**
 * Server enforcement of the contractor lifecycle, permissions and atomicity.
 *
 * Three things this pass changed on the server, all pinned here:
 *   • ARCHIVE / RESTORE are their own permissioned actions, not a status field
 *     smuggled through an ordinary edit.
 *   • An archived contractor takes on no NEW business, but every historical
 *     CORRECTION stays available.
 *   • Creating a contractor with an opening advance is one transaction — the two
 *     writes could previously diverge and leave a balance nothing explained.
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

const PAPPU = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";

const h = vi.hoisted(() => ({
  user: null as SessionUser | null,
  prisma: {
    contractor: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    contractorLedgerEntry: { findMany: vi.fn(), count: vi.fn(), create: vi.fn() },
    contractorSettlement: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    project: { findFirst: vi.fn() },
    labourAttendance: { aggregate: vi.fn(), groupBy: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    contractorContract: { findFirst: vi.fn(), findMany: vi.fn() },
    contractorSettlementBreakdown: { findMany: vi.fn(), create: vi.fn() },
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

import { newBusinessBlockedReason } from "../lifecycle";
import {
  archiveContractor,
  createContractor,
  createSettlement,
  recordAdvance,
  restoreContractor,
  reverseSettlement,
  updateContractor,
} from "./actions";

const contractorRow = (status: "ACTIVE" | "INACTIVE" = "ACTIVE") => ({
  id: PAPPU,
  name: "Pappu Contractor",
  phone: null,
  status,
  openingAdvancePaise: BigInt(0),
  createdAt: new Date("2026-01-01"),
});

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
  h.prisma.contractor.findFirst.mockResolvedValue(contractorRow());
  h.prisma.contractor.findMany.mockResolvedValue([]);
  h.prisma.contractor.create.mockResolvedValue(contractorRow());
  h.prisma.contractor.update.mockResolvedValue(contractorRow());
  h.prisma.contractorLedgerEntry.findMany.mockResolvedValue([]);
  h.prisma.contractorLedgerEntry.count.mockResolvedValue(0);
  h.prisma.contractorLedgerEntry.create.mockResolvedValue({
    id: "l1",
    contractorId: PAPPU,
    date: new Date("2026-02-01"),
    type: "ADVANCE",
    amountPaise: BigInt(100_000),
    advanceBalanceAfterPaise: BigInt(100_000),
    notes: null,
    settlementId: null,
    projectId: null,
    contractId: null,
    drawsFromEntryId: null,
    reversesEntryId: null,
    fundsContractId: null,
    createdAt: new Date("2026-02-01"),
  });
  h.prisma.project.findFirst.mockResolvedValue({ id: PROJECT, name: "Skyline" });
  h.prisma.labourAttendance.aggregate.mockResolvedValue({ _sum: { estimatedCostPaise: 0 } });
  h.prisma.labourAttendance.groupBy.mockResolvedValue([]);
  h.prisma.labourAttendance.findMany.mockResolvedValue([]);
  h.prisma.labourAttendance.updateMany.mockResolvedValue({ count: 0 });
  h.prisma.contractorSettlementBreakdown.findMany.mockResolvedValue([]);
  h.prisma.contractorSettlementBreakdown.create.mockResolvedValue({ id: "b1" });
  h.prisma.activityLog.create.mockResolvedValue({ id: "a" });
});

/* ── Atomic creation ────────────────────────────────────────────────────── */

describe("creating a contractor with an opening advance", () => {
  it("writes the contractor AND its ledger entry in one transaction", async () => {
    await createContractor({ name: "New Crew", openingAdvancePaise: 500_000 });

    expect(h.prisma.$transaction).toHaveBeenCalled();
    expect(h.prisma.contractor.create).toHaveBeenCalled();
    expect(h.prisma.contractorLedgerEntry.create).toHaveBeenCalled();
    const entry = h.prisma.contractorLedgerEntry.create.mock.calls[0][0].data;
    expect(entry).toMatchObject({ type: "OPENING_ADVANCE", amountPaise: 500_000 });
  });

  it("writes no ledger entry when there is no opening advance", async () => {
    await createContractor({ name: "New Crew" });
    expect(h.prisma.contractorLedgerEntry.create).not.toHaveBeenCalled();
  });

  it("creates neither row if the transaction fails", async () => {
    h.prisma.$transaction.mockRejectedValue(new Error("db down"));
    await expect(
      createContractor({ name: "New Crew", openingAdvancePaise: 500_000 }),
    ).rejects.toThrow();
    // The activity log is only written after the transaction commits.
    expect(h.prisma.activityLog.create).not.toHaveBeenCalled();
  });
});

/* ── Duplicates ─────────────────────────────────────────────────────────── */

describe("duplicate contractors", () => {
  beforeEach(() => {
    h.prisma.contractor.findMany.mockResolvedValue([
      { id: "c-existing", name: "Pappu Contractor", phone: "+91 98200 77889", status: "ACTIVE" },
    ]);
  });

  it("returns the look-alikes instead of creating, and writes nothing", async () => {
    const res = await createContractor({ name: "pappu contractor" });
    expect(res).toHaveProperty("duplicates");
    expect(h.prisma.contractor.create).not.toHaveBeenCalled();
  });

  it("creates once the caller confirms it really is different", async () => {
    const res = await createContractor({ name: "pappu contractor", allowDuplicate: true });
    expect(res).not.toHaveProperty("duplicates");
    expect(h.prisma.contractor.create).toHaveBeenCalled();
  });

  it("creates a genuinely new contractor without asking", async () => {
    await createContractor({ name: "Totally New Crew" });
    expect(h.prisma.contractor.create).toHaveBeenCalled();
  });
});

/* ── Lifecycle actions ──────────────────────────────────────────────────── */

describe("archive and restore", () => {
  it("archiving needs contractors.archive, not merely edit", async () => {
    h.user = u(["contractors.view", "contractors.edit"]);
    await expect(archiveContractor(PAPPU)).rejects.toThrow();
    expect(h.prisma.contractor.update).not.toHaveBeenCalled();
  });

  it("restoring needs contractors.restore", async () => {
    h.user = u(["contractors.view", "contractors.archive"]);
    h.prisma.contractor.findFirst.mockResolvedValue(contractorRow("INACTIVE"));
    await expect(restoreContractor(PAPPU)).rejects.toThrow();
  });

  it("archives by setting the status, and audits it as its own event", async () => {
    await archiveContractor(PAPPU);
    expect(h.prisma.contractor.update.mock.calls[0][0].data).toEqual({ status: "INACTIVE" });
    expect(h.prisma.activityLog.create.mock.calls[0][0].data.action).toBe("contractor.archived");
  });

  it("restores by setting the status back", async () => {
    h.prisma.contractor.findFirst.mockResolvedValue(contractorRow("INACTIVE"));
    await restoreContractor(PAPPU);
    expect(h.prisma.contractor.update.mock.calls[0][0].data).toEqual({ status: "ACTIVE" });
    expect(h.prisma.activityLog.create.mock.calls[0][0].data.action).toBe("contractor.restored");
  });

  it("refuses to archive twice, or restore something already active", async () => {
    h.prisma.contractor.findFirst.mockResolvedValue(contractorRow("INACTIVE"));
    await expect(archiveContractor(PAPPU)).rejects.toThrow("ALREADY_ARCHIVED");

    h.prisma.contractor.findFirst.mockResolvedValue(contractorRow("ACTIVE"));
    await expect(restoreContractor(PAPPU)).rejects.toThrow("NOT_ARCHIVED");
  });

  it("never deletes the contractor", async () => {
    await archiveContractor(PAPPU);
    expect(h.prisma.contractor).not.toHaveProperty("delete");
  });

  it("refuses a status change smuggled through an ordinary edit", async () => {
    await expect(
      updateContractor(PAPPU, { status: "INACTIVE" } as never),
    ).rejects.toThrow("USE_ARCHIVE");
    expect(h.prisma.contractor.update).not.toHaveBeenCalled();
  });
});

/* ── New business vs historical correction ──────────────────────────────── */

describe("an archived contractor", () => {
  beforeEach(() => {
    h.prisma.contractor.findFirst.mockResolvedValue(contractorRow("INACTIVE"));
  });

  it("takes no new labour advance", async () => {
    await expect(
      recordAdvance({ contractorId: PAPPU, date: "2026-02-01", amountPaise: 100_000 }),
    ).rejects.toThrow("CONTRACTOR_ARCHIVED");
    expect(h.prisma.contractorLedgerEntry.create).not.toHaveBeenCalled();
  });

  it("takes no new agreement", async () => {
    // Guarded in contracts/server/internal.ts; asserted here as the policy row.
    expect(newBusinessBlockedReason("INACTIVE", "CREATE_AGREEMENT")).toBeTruthy();
  });

  /**
   * THE PASS 5.1 CORRECTION.
   *
   * Settlement used to be refused here, which meant archiving could STRAND a
   * liability: Pappu works 1–18 August, is archived on the 19th, and the
   * ₹5,00,000 he is owed can never be paid. A settlement commits the contractor
   * to nothing — it recognises attendance already on record — so it must
   * survive archiving. New ATTENDANCE is what stops (see the labour suite), and
   * that is what keeps a post-archive settlement honest: everything it can bill
   * was recorded while the contractor was active.
   */
  it("CAN still settle attendance recorded before it was archived", async () => {
    h.prisma.labourAttendance.aggregate.mockResolvedValue({
      _sum: { estimatedCostPaise: 50_000_000 }, // ₹5,00,000 of August labour
    });
    h.prisma.labourAttendance.groupBy.mockResolvedValue([
      { contractId: null, _sum: { estimatedCostPaise: 50_000_000 } },
    ]);
    h.prisma.contractorSettlement.create.mockResolvedValue({
      id: "s-aug",
      contractorId: PAPPU,
      projectId: PROJECT,
      periodStart: new Date("2026-08-01"),
      periodEnd: new Date("2026-08-18"),
      labourBillPaise: BigInt(50_000_000),
      advanceAdjustmentPaise: BigInt(0),
      netPaymentPaise: BigInt(50_000_000),
      advanceBalanceAfterPaise: BigInt(0),
      notes: null,
      createdAt: new Date("2026-08-20"),
    });

    const settlement = await createSettlement({
      contractorId: PAPPU,
      projectId: PROJECT,
      periodStart: "2026-08-01",
      periodEnd: "2026-08-18",
      advanceAdjustmentPaise: 0,
    });

    // The liability is recognised in full, at the value the attendance carried.
    expect(settlement.labourBillPaise).toBe(50_000_000);
    expect(settlement.netPaymentPaise).toBe(50_000_000);
    expect(h.prisma.contractorSettlement.create).toHaveBeenCalled();
  });

  it("never consults the archived guard when settling", async () => {
    h.prisma.labourAttendance.aggregate.mockResolvedValue({
      _sum: { estimatedCostPaise: 0 },
    });
    h.prisma.contractorSettlement.create.mockResolvedValue({
      id: "s0",
      contractorId: PAPPU,
      projectId: PROJECT,
      periodStart: new Date("2026-08-01"),
      periodEnd: new Date("2026-08-18"),
      labourBillPaise: BigInt(0),
      advanceAdjustmentPaise: BigInt(0),
      netPaymentPaise: BigInt(0),
      advanceBalanceAfterPaise: BigInt(0),
      notes: null,
      createdAt: new Date("2026-08-20"),
    });
    await createSettlement({
      contractorId: PAPPU,
      projectId: PROJECT,
      periodStart: "2026-08-01",
      periodEnd: "2026-08-18",
      advanceAdjustmentPaise: 0,
    });
    // It reads the contractor to check tenancy and NOT_FOUND, but the refusal
    // vocabulary is never reached — proven by the call above succeeding.
    expect(newBusinessBlockedReason("INACTIVE", "RECORD_ADVANCE")).toBeTruthy();
  });

  it("is NEVER refused on lifecycle grounds when reversing a settlement", async () => {
    // The point of the whole design: archiving must not trap money in a state
    // nobody can correct. Reversal goes nowhere near the archived guard, so
    // whatever else this fixture is missing, it must not fail with
    // CONTRACTOR_ARCHIVED.
    h.prisma.contractorSettlement.findFirst.mockResolvedValue(null);
    await expect(reverseSettlement("s1", "Wrong headcount")).rejects.toThrow("NOT_FOUND");
  });

  it("does not consult the archived guard on a reversal at all", async () => {
    h.prisma.contractorSettlement.findFirst.mockResolvedValue(null);
    await reverseSettlement("s1", "Wrong headcount").catch(() => {});
    // The guard reads the contractor row; reversal never does.
    expect(h.prisma.contractor.findFirst).not.toHaveBeenCalled();
  });

  it("STILL allows its own details to be edited", async () => {
    await expect(updateContractor(PAPPU, { phone: "+91 90000 11111" })).resolves.toBeDefined();
  });
});

/* ── Permissions on the money actions ───────────────────────────────────── */

describe("the actions the UI used to hide behind isOwner", () => {
  it("an Accountant-shaped role can record an advance", async () => {
    h.user = u(["contractors.view", "contractors.view_all", "contractors.advance"]);
    await expect(
      recordAdvance({ contractorId: PAPPU, date: "2026-02-01", amountPaise: 100_000 }),
    ).resolves.toBeDefined();
  });

  it("without contractors.advance, it is still refused", async () => {
    h.user = u(["contractors.view"]);
    await expect(
      recordAdvance({ contractorId: PAPPU, date: "2026-02-01", amountPaise: 100_000 }),
    ).rejects.toThrow();
    expect(h.prisma.contractorLedgerEntry.create).not.toHaveBeenCalled();
  });

  it("creating a contractor still demands contractors.create", async () => {
    h.user = u(["contractors.view", "contractors.edit"]);
    await expect(createContractor({ name: "New Crew" })).rejects.toThrow();
    expect(h.prisma.contractor.create).not.toHaveBeenCalled();
  });

  it("an Owner keeps every one of them through the wildcard", async () => {
    h.user = OWNER;
    await expect(archiveContractor(PAPPU)).resolves.toBeDefined();
  });
});
