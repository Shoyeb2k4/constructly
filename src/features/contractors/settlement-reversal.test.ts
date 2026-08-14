/**
 * Governed settlement reversal.
 *
 * Settled attendance is financially immutable, so reversal is the only way to
 * correct a mistyped headcount. The subtle part is the CASH: the net payment has
 * already left the bank and is not clawed back, so it must become an unapplied
 * advance. Restoring only the drawdown would make it disappear from the accounts
 * entirely.
 *
 *                                   balance     cash out   recognised
 *   advance ₹2,00,000               ₹2,00,000   ₹2,00,000          ₹0
 *   settle ₹6,00,000 (adj 2L net 4L)       ₹0   ₹6,00,000   ₹6,00,000
 *   reverse — restore only          ₹2,00,000   ₹6,00,000          ₹0  ← ₹4L lost
 *   reverse — correct               ₹6,00,000   ₹6,00,000          ₹0  ✓
 *
 * And when the settlement spanned several agreements, that cash returns PER
 * BUCKET from the settlement-time breakdown, so attribution already known is
 * never collapsed into anonymous project money.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import { ALL_PERMISSIONS, type Permission } from "@/features/rbac/permissions";
import { RS_2L, RS_3L, RS_4L, RS_6L, lakhs } from "@/features/contracts/__fixtures__/amounts";

function u(permissions: Permission[]): SessionUser {
  return {
    id: "o1",
    email: "o@x.com",
    fullName: "Owner",
    role: "OWNER",
    permissions,
    company: { id: "c1", name: "Co" },
  };
}
const OWNER = u([...ALL_PERMISSIONS]);

const h = vi.hoisted(() => ({
  user: null as SessionUser | null,
  prisma: {
    contractor: { findFirst: vi.fn() },
    project: { findFirst: vi.fn() },
    contractorContract: { findFirst: vi.fn() },
    contractorSettlement: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    contractorSettlementBreakdown: { findMany: vi.fn(), create: vi.fn() },
    contractorLedgerEntry: { findMany: vi.fn(), create: vi.fn() },
    labourAttendance: {
      updateMany: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
      aggregate: vi.fn(),
    },
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

import { reverseSettlement } from "./server/actions";

const SETTLEMENT = "st-1";
const CONTRACTOR = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const STRUCTURE = "ag-structure";
const COMPOUND_WALL = "ag-compound-wall";

/** The seeded pre-Phase-6 case: one unattributed bucket, ₹2L drawn, ₹4L net. */
function seedSingleBucket() {
  h.prisma.contractorSettlement.findFirst.mockResolvedValue({
    id: SETTLEMENT,
    companyId: "c1",
    contractorId: CONTRACTOR,
    projectId: PROJECT,
    labourBillPaise: BigInt(RS_6L),
    advanceAdjustmentPaise: BigInt(RS_2L),
    netPaymentPaise: BigInt(RS_4L),
    advanceBalanceAfterPaise: BigInt(0),
    reversedAt: null,
    contractor: { id: CONTRACTOR, name: "Pappu Contractor" },
    project: { id: PROJECT, name: "Project A", pmId: "o1" },
  });
  h.prisma.contractorLedgerEntry.findMany.mockImplementation(async (args: { where: { type?: string } }) =>
    args.where?.type === "ADJUSTMENT"
      ? [
          {
            id: "adj-1",
            amountPaise: BigInt(RS_2L),
            projectId: PROJECT,
            contractId: null,
          },
        ]
      : [],
  );
  h.prisma.contractorSettlementBreakdown.findMany.mockResolvedValue([
    {
      contractId: null,
      labourBillPaise: BigInt(RS_6L),
      advanceAdjustmentPaise: BigInt(RS_2L),
      netPaymentPaise: BigInt(RS_4L),
    },
  ]);
}

/** Structure ₹4L + Compound Wall ₹2L, drawdowns ₹1L and ₹50k. */
function seedTwoBuckets() {
  h.prisma.contractorSettlement.findFirst.mockResolvedValue({
    id: SETTLEMENT,
    companyId: "c1",
    contractorId: CONTRACTOR,
    projectId: PROJECT,
    labourBillPaise: BigInt(RS_6L),
    advanceAdjustmentPaise: BigInt(lakhs(1.5)),
    netPaymentPaise: BigInt(lakhs(4.5)),
    advanceBalanceAfterPaise: BigInt(0),
    reversedAt: null,
    contractor: { id: CONTRACTOR, name: "Pappu Contractor" },
    project: { id: PROJECT, name: "Project A", pmId: "o1" },
  });
  h.prisma.contractorLedgerEntry.findMany.mockImplementation(async (args: { where: { type?: string } }) =>
    args.where?.type === "ADJUSTMENT"
      ? [
          { id: "adj-s", amountPaise: BigInt(lakhs(1)), projectId: PROJECT, contractId: STRUCTURE },
          { id: "adj-w", amountPaise: BigInt(lakhs(0.5)), projectId: PROJECT, contractId: COMPOUND_WALL },
        ]
      : [],
  );
  h.prisma.contractorSettlementBreakdown.findMany.mockResolvedValue([
    {
      contractId: STRUCTURE,
      labourBillPaise: BigInt(RS_4L),
      advanceAdjustmentPaise: BigInt(lakhs(1)),
      netPaymentPaise: BigInt(lakhs(3)),
    },
    {
      contractId: COMPOUND_WALL,
      labourBillPaise: BigInt(RS_2L),
      advanceAdjustmentPaise: BigInt(lakhs(0.5)),
      netPaymentPaise: BigInt(lakhs(1.5)),
    },
  ]);
}

/** The SETTLEMENT_REVERSAL rows written, as plain numbers. */
const reversalEntries = () =>
  h.prisma.contractorLedgerEntry.create.mock.calls
    .map((c) => c[0].data)
    .filter((d: { type: string }) => d.type === "SETTLEMENT_REVERSAL")
    .map((d: { amountPaise: bigint; contractId: string | null; reversesEntryId: string | null }) => ({
      amountPaise: Number(d.amountPaise),
      contractId: d.contractId,
      reversesEntryId: d.reversesEntryId,
    }));

const restores = () => reversalEntries().filter((e) => e.reversesEntryId !== null);
const unapplied = () => reversalEntries().filter((e) => e.reversesEntryId === null);
const sum = (rows: { amountPaise: number }[]) => rows.reduce((a, r) => a + r.amountPaise, 0);

beforeEach(() => {
  h.user = OWNER;
  Object.values(h.prisma).forEach((m) => {
    if (typeof m === "object") {
      Object.values(m).forEach((f) => (f as ReturnType<typeof vi.fn>).mockReset?.());
    }
  });
  h.prisma.$transaction.mockReset();
  h.prisma.$queryRaw.mockReset().mockResolvedValue([{ id: SETTLEMENT, reversed_at: null }]);
  h.prisma.project.findFirst.mockResolvedValue({ id: PROJECT });
  h.prisma.contractorContract.findFirst.mockResolvedValue({ id: STRUCTURE });
  h.prisma.contractorLedgerEntry.create.mockResolvedValue({ id: "l" });
  h.prisma.labourAttendance.updateMany.mockResolvedValue({ count: 3 });
  h.prisma.activityLog.create.mockResolvedValue({ id: "a" });
  h.prisma.contractorSettlement.update.mockImplementation(async () => ({
    id: SETTLEMENT,
    contractorId: CONTRACTOR,
    projectId: PROJECT,
    periodStart: new Date("2026-02-01"),
    periodEnd: new Date("2026-02-07"),
    labourBillPaise: BigInt(RS_6L),
    advanceAdjustmentPaise: BigInt(RS_2L),
    netPaymentPaise: BigInt(RS_4L),
    advanceBalanceAfterPaise: BigInt(0),
    notes: null,
    reversedAt: new Date(),
    reversalReason: "Wrong headcount",
    createdAt: new Date(),
  }));
  h.prisma.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(h.prisma) : Promise.all(arg as unknown[]),
  );
  seedSingleBucket();
});

/* ── Governance ─────────────────────────────────────────────────────────── */

describe("reversal is governed", () => {
  it("needs contractors.settle_reverse — settle alone is not enough", async () => {
    h.user = u(["contractors.view", "contractors.settle"]);
    await expect(reverseSettlement(SETTLEMENT, "Wrong headcount")).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.contractorSettlement.findFirst).not.toHaveBeenCalled();
  });

  it("requires a reason", async () => {
    await expect(reverseSettlement(SETTLEMENT, "   ")).rejects.toThrow("REVERSAL_REASON_REQUIRED");
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a second reversal", async () => {
    h.prisma.contractorSettlement.findFirst.mockResolvedValue({
      id: SETTLEMENT,
      companyId: "c1",
      contractorId: CONTRACTOR,
      projectId: PROJECT,
      labourBillPaise: BigInt(RS_6L),
      advanceAdjustmentPaise: BigInt(RS_2L),
      netPaymentPaise: BigInt(RS_4L),
      reversedAt: new Date("2026-03-01"),
      contractor: { id: CONTRACTOR, name: "Pappu" },
      project: { id: PROJECT, name: "Project A", pmId: "o1" },
    });
    await expect(reverseSettlement(SETTLEMENT, "again")).rejects.toThrow(
      "SETTLEMENT_ALREADY_REVERSED",
    );
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("takes a row lock before deciding, so two reversals cannot both proceed", async () => {
    await reverseSettlement(SETTLEMENT, "Wrong headcount");
    expect(h.prisma.$queryRaw).toHaveBeenCalled();
  });

  it("writes nothing when the locked row turns out to be already reversed", async () => {
    h.prisma.$queryRaw.mockResolvedValue([{ id: SETTLEMENT, reversed_at: new Date() }]);
    await expect(reverseSettlement(SETTLEMENT, "race")).rejects.toThrow(
      "SETTLEMENT_ALREADY_REVERSED",
    );
    expect(h.prisma.contractorLedgerEntry.create).not.toHaveBeenCalled();
    expect(h.prisma.labourAttendance.updateMany).not.toHaveBeenCalled();
  });
});

/* ── The cash identity ──────────────────────────────────────────────────── */

describe("cash treatment", () => {
  it("restores the drawdown AND un-applies the net payment", async () => {
    await reverseSettlement(SETTLEMENT, "Wrong headcount");

    expect(sum(restores())).toBe(RS_2L); // the drawdown, back to its advance
    expect(sum(unapplied())).toBe(RS_4L); // the cash already paid out
    // Balance returns to the full ₹6,00,000 the contractor is actually holding.
    expect(sum(restores()) + sum(unapplied())).toBe(RS_6L);
  });

  it("satisfies both identities exactly", async () => {
    await reverseSettlement(SETTLEMENT, "Wrong headcount");
    // Σ restored + Σ unapplied = the original bill
    expect(sum(restores()) + sum(unapplied())).toBe(RS_6L);
    // Σ unapplied = the original net payment
    expect(sum(unapplied())).toBe(RS_4L);
  });

  it("traces every restore back to the adjustment it reverses", async () => {
    await reverseSettlement(SETTLEMENT, "Wrong headcount");
    expect(restores().map((e) => e.reversesEntryId)).toEqual(["adj-1"]);
  });

  it("writes no unapplied entry when the advance covered the whole bill", async () => {
    h.prisma.contractorSettlement.findFirst.mockResolvedValue({
      id: SETTLEMENT,
      companyId: "c1",
      contractorId: CONTRACTOR,
      projectId: PROJECT,
      labourBillPaise: BigInt(RS_2L),
      advanceAdjustmentPaise: BigInt(RS_2L),
      netPaymentPaise: BigInt(0),
      reversedAt: null,
      contractor: { id: CONTRACTOR, name: "Pappu" },
      project: { id: PROJECT, name: "Project A", pmId: "o1" },
    });
    h.prisma.contractorSettlementBreakdown.findMany.mockResolvedValue([
      {
        contractId: null,
        labourBillPaise: BigInt(RS_2L),
        advanceAdjustmentPaise: BigInt(RS_2L),
        netPaymentPaise: BigInt(0),
      },
    ]);
    await reverseSettlement(SETTLEMENT, "Wrong headcount");

    expect(sum(restores())).toBe(RS_2L);
    expect(unapplied()).toHaveLength(0); // zero-amount rows are not written
  });

  it("writes no restore when no advance was drawn", async () => {
    h.prisma.contractorSettlement.findFirst.mockResolvedValue({
      id: SETTLEMENT,
      companyId: "c1",
      contractorId: CONTRACTOR,
      projectId: PROJECT,
      labourBillPaise: BigInt(RS_6L),
      advanceAdjustmentPaise: BigInt(0),
      netPaymentPaise: BigInt(RS_6L),
      reversedAt: null,
      contractor: { id: CONTRACTOR, name: "Pappu" },
      project: { id: PROJECT, name: "Project A", pmId: "o1" },
    });
    h.prisma.contractorLedgerEntry.findMany.mockResolvedValue([]);
    h.prisma.contractorSettlementBreakdown.findMany.mockResolvedValue([
      {
        contractId: null,
        labourBillPaise: BigInt(RS_6L),
        advanceAdjustmentPaise: BigInt(0),
        netPaymentPaise: BigInt(RS_6L),
      },
    ]);
    await reverseSettlement(SETTLEMENT, "Wrong headcount");

    expect(restores()).toHaveLength(0);
    expect(sum(unapplied())).toBe(RS_6L);
  });
});

/* ── Multi-agreement attribution ────────────────────────────────────────── */

describe("multi-agreement cash keeps its provenance", () => {
  beforeEach(() => seedTwoBuckets());

  it("returns each bucket's cash as an advance scoped to THAT agreement", async () => {
    await reverseSettlement(SETTLEMENT, "Wrong headcount");

    const byBucket = new Map(unapplied().map((e) => [e.contractId, e.amountPaise]));
    expect(byBucket.get(STRUCTURE)).toBe(lakhs(3));
    expect(byBucket.get(COMPOUND_WALL)).toBe(lakhs(1.5));
  });

  it("strands nothing at project level when attribution was known", async () => {
    await reverseSettlement(SETTLEMENT, "Wrong headcount");
    // The failure this guards against: collapsing ₹4,50,000 into one anonymous
    // project advance a fully-attributed re-settlement could never consume.
    expect(unapplied().every((e) => e.contractId !== null)).toBe(true);
  });

  it("still satisfies both identities", async () => {
    await reverseSettlement(SETTLEMENT, "Wrong headcount");
    expect(sum(restores()) + sum(unapplied())).toBe(RS_6L);
    expect(sum(unapplied())).toBe(lakhs(4.5));
  });

  it("restores each drawdown to its own scoped advance", async () => {
    await reverseSettlement(SETTLEMENT, "Wrong headcount");
    const byBucket = new Map(restores().map((e) => [e.contractId, e.amountPaise]));
    expect(byBucket.get(STRUCTURE)).toBe(lakhs(1));
    expect(byBucket.get(COMPOUND_WALL)).toBe(lakhs(0.5));
  });

  it("reads the settlement-time breakdown, not today's attendance", async () => {
    await reverseSettlement(SETTLEMENT, "Wrong headcount");
    // Attendance attribution can change afterwards via the governed historical
    // workflow; the breakdown is what this settlement actually did.
    expect(h.prisma.contractorSettlementBreakdown.findMany).toHaveBeenCalled();
    expect(h.prisma.labourAttendance.groupBy).not.toHaveBeenCalled();
  });
});

/* ── Freeing the attendance ─────────────────────────────────────────────── */

describe("the attendance is freed", () => {
  it("un-stamps every row the settlement owned", async () => {
    await reverseSettlement(SETTLEMENT, "Wrong headcount");
    expect(h.prisma.labourAttendance.updateMany).toHaveBeenCalledWith({
      where: { companyId: "c1", settlementId: SETTLEMENT },
      data: { settlementId: null },
    });
  });

  it("keeps the settlement, marking it reversed with who and why", async () => {
    await reverseSettlement(SETTLEMENT, "Wrong headcount");
    const update = h.prisma.contractorSettlement.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: SETTLEMENT });
    expect(update.data.reversalReason).toBe("Wrong headcount");
    expect(update.data.reversedById).toBe("o1");
    expect(update.data.reversedAt).toBeInstanceOf(Date);
  });

  it("audits the reversal with the figures that moved", async () => {
    await reverseSettlement(SETTLEMENT, "Wrong headcount");
    const log = h.prisma.activityLog.create.mock.calls[0][0].data;
    expect(log.action).toBe("contractor.settlement_reversed");
    expect(log.meta).toMatchObject({
      settlementId: SETTLEMENT,
      reason: "Wrong headcount",
      restoredPaise: RS_2L,
      unappliedPaise: RS_4L,
      attendanceRowsFreed: 3,
    });
  });

  it("refuses if the identities do not balance", async () => {
    // A breakdown inconsistent with its settlement must never be applied.
    h.prisma.contractorSettlementBreakdown.findMany.mockResolvedValue([
      {
        contractId: null,
        labourBillPaise: BigInt(RS_6L),
        advanceAdjustmentPaise: BigInt(RS_2L),
        netPaymentPaise: BigInt(RS_3L), // should be ₹4,00,000
      },
    ]);
    await expect(reverseSettlement(SETTLEMENT, "Wrong headcount")).rejects.toThrow(
      "REVERSAL_IMBALANCE",
    );
  });
});
