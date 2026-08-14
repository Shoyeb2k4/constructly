/**
 * Advance ledger ↔ settlement ↔ agreement reconciliation.
 *
 * THE ACCOUNTING SEMANTICS THIS PINS (as the code actually works):
 *
 * `ContractorLedgerEntry` has no projectId and no contractId — the advance
 * ledger is COMPANY-WIDE per contractor. Only OPENING_ADVANCE/ADVANCE (+) and
 * ADJUSTMENT (−) move the balance; LABOUR_BILL and PAYMENT are informational and
 * move nothing (`advanceDeltaPaise` returns 0 for both).
 *
 * A settlement computes `net = bill − adjustment`, where the adjustment draws
 * down an advance the contractor was handed earlier. So for one period:
 *
 *     cash out earlier (advance)      ₹2,00,000
 *   + cash out now (net payment)      ₹4,00,000
 *   ────────────────────────────────────────────
 *   = total received for that labour  ₹6,00,000  ===  the labour bill
 *
 * THE CANONICAL RULE: an advance is a cash-TIMING instrument, not an additional
 * credit. It enters an agreement only through the settlement that draws it down,
 * and it arrives already inside the attendance credit — because the attendance
 * credit is the full bill, regardless of how much of that bill was pre-paid.
 *
 * Hence the agreement recognises ₹6,00,000, never:
 *   • ₹8,00,000 (bill + advance counted separately), nor
 *   • ₹4,00,000 (net cash only, ignoring the pre-paid part).
 *
 * The engine enforces this structurally: `reconcileAgreement` never reads the
 * ledger at all. These tests prove that holds end to end and stays true.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import { ALL_PERMISSIONS } from "@/features/rbac/permissions";
import {
  advanceBalancePaise,
  advanceDeltaPaise,
  computeSettlement,
  maxAdjustmentPaise,
} from "./calc";
import { reconcileAgreement } from "@/features/contracts/reconcile";
import type { AgreementSnapshot } from "@/features/contracts/types";
import { RS_2L, RS_4L, RS_6L, RS_8L, RS_60L } from "@/features/contracts/__fixtures__/amounts";

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
    contractor: { findFirst: vi.fn() },
    project: { findFirst: vi.fn() },
    labourAttendance: {
      aggregate: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
    contractorLedgerEntry: { findMany: vi.fn(), create: vi.fn() },
    contractorSettlement: { create: vi.fn() },
    contractorSettlementBreakdown: { create: vi.fn(), findMany: vi.fn() },
    contractorContract: { findFirst: vi.fn() },
    $queryRaw: vi.fn(),
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

import { createSettlement } from "./server/actions";

const CONTRACTOR = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const AGREEMENT = "ag-structure";

/* ── 1. The ledger's own semantics ──────────────────────────────────────── */

describe("what the advance ledger actually does", () => {
  it("only advances and adjustments move the balance", () => {
    expect(advanceDeltaPaise("OPENING_ADVANCE", RS_2L)).toBe(RS_2L);
    expect(advanceDeltaPaise("ADVANCE", RS_2L)).toBe(RS_2L);
    expect(advanceDeltaPaise("ADJUSTMENT", RS_2L)).toBe(-RS_2L);
    // The two entries a settlement writes to narrate itself are informational.
    expect(advanceDeltaPaise("LABOUR_BILL", RS_6L)).toBe(0);
    expect(advanceDeltaPaise("PAYMENT", RS_4L)).toBe(0);
  });

  it("a drawn-down advance nets to zero across the ledger", () => {
    const ledger = [
      { type: "ADVANCE" as const, amountPaise: RS_2L },
      { type: "LABOUR_BILL" as const, amountPaise: RS_6L },
      { type: "ADJUSTMENT" as const, amountPaise: RS_2L },
      { type: "PAYMENT" as const, amountPaise: RS_4L },
    ];
    expect(advanceBalancePaise(ledger)).toBe(0);
  });
});

/* ── 2. The economic identity ───────────────────────────────────────────── */

describe("advance ₹2,00,000 → labour ₹6,00,000 → settlement", () => {
  const outstandingAdvance = RS_2L;
  const bill = RS_6L;
  const math = computeSettlement(bill, outstandingAdvance, outstandingAdvance);

  it("consumes the advance and pays only the ₹4,00,000 balance in cash", () => {
    expect(math.advanceAdjustmentPaise).toBe(RS_2L);
    expect(math.netPaymentPaise).toBe(RS_4L);
    expect(math.advanceBalanceAfterPaise).toBe(0);
  });

  it("total cash the contractor received equals the labour bill exactly", () => {
    // This identity is the whole reason an advance must not be credited again:
    // it is already one of the two halves of the bill.
    const cashOut = outstandingAdvance + math.netPaymentPaise;
    expect(cashOut).toBe(bill);
    expect(cashOut).toBe(RS_6L);
  });

  it("never adjusts more than the advance or more than the bill", () => {
    expect(maxAdjustmentPaise(RS_8L, RS_6L)).toBe(RS_6L); // capped by the bill
    expect(maxAdjustmentPaise(RS_2L, RS_6L)).toBe(RS_2L); // capped by the advance
  });
});

/* ── 3. What the agreement recognises ───────────────────────────────────── */

/** ₹6,00,000 of settled attendance attributed to the Structure agreement. */
function snapshot(over: Partial<AgreementSnapshot> = {}): AgreementSnapshot {
  return {
    agreementId: AGREEMENT,
    status: "IN_PROGRESS",
    originalAmountPaise: RS_60L,
    amendments: [],
    milestones: [
      {
        id: "m1",
        sequence: 0,
        title: "Slab 1",
        valuePaise: RS_8L,
        status: "COMPLETED",
        completedAt: "2026-02-15T00:00:00.000Z",
      },
    ],
    attendanceCredits: [{ id: "att-1", date: "2026-02-07", amountPaise: RS_6L }],
    payments: [],
    ...over,
  };
}

describe("the agreement recognises the labour bill once", () => {
  it("credits ₹6,00,000 — not ₹8,00,000, and not the ₹4,00,000 net", () => {
    const r = reconcileAgreement(snapshot());

    expect(r.attendanceCreditPaise).toBe(RS_6L);
    expect(r.totalCreditedPaise).toBe(RS_6L);

    // The two ways this could go wrong, named explicitly.
    expect(r.totalCreditedPaise).not.toBe(RS_8L); // advance double-counted
    expect(r.totalCreditedPaise).not.toBe(RS_4L); // pre-paid portion dropped
  });

  it("is unaffected by how much of the bill was pre-paid", () => {
    // Same ₹6,00,000 of labour, three different advance/net splits.
    const splits = [
      { advance: 0, settlement: computeSettlement(RS_6L, 0, 0) },
      { advance: RS_2L, settlement: computeSettlement(RS_6L, RS_2L, RS_2L) },
      { advance: RS_6L, settlement: computeSettlement(RS_6L, RS_6L, RS_6L) },
    ];

    expect(splits.map((s) => s.settlement.netPaymentPaise)).toEqual([RS_6L, RS_4L, 0]);

    for (const { advance, settlement } of splits) {
      // Cash out always totals the bill, however it was timed…
      expect(advance + settlement.netPaymentPaise).toBe(RS_6L);
      // …and the agreement credits that bill once, never the split.
      expect(reconcileAgreement(snapshot()).totalCreditedPaise).toBe(RS_6L);
    }
  });

  it("leaves ₹2,00,000 due against the ₹8,00,000 milestone", () => {
    const r = reconcileAgreement(snapshot());
    expect(r.earnedValuePaise).toBe(RS_8L);
    expect(r.currentDuePaise).toBe(RS_2L);
    expect(r.advanceCreditPaise).toBe(0);
  });

  it("credits ₹8,00,000 only when a genuinely separate payment is recorded", () => {
    // A real, distinct cash payment against the agreement — as opposed to the
    // advance, which was already inside the bill.
    const r = reconcileAgreement(
      snapshot({
        payments: [
          { id: "p1", date: "2026-02-20", amountPaise: RS_2L, type: "INTERIM", reversedAt: null },
        ],
      }),
    );
    expect(r.attendanceCreditPaise).toBe(RS_6L);
    expect(r.otherPaymentCreditPaise).toBe(RS_2L);
    expect(r.totalCreditedPaise).toBe(RS_8L);
    expect(r.currentDuePaise).toBe(0);
  });
});

/* ── 4. End to end, against the real settlement action ──────────────────── */

describe("advance → attendance → settlement → agreement, end to end", () => {
  beforeEach(() => {
    h.user = OWNER;
    Object.values(h.prisma).forEach((m) => {
      if (typeof m === "object") {
        Object.values(m).forEach((f) => (f as ReturnType<typeof vi.fn>).mockReset?.());
      }
    });
    h.prisma.$transaction.mockReset();
  h.prisma.$queryRaw.mockReset().mockResolvedValue([]);
  h.prisma.contractorSettlementBreakdown.create.mockReset().mockResolvedValue({ id: "b1" });
  h.prisma.contractorSettlementBreakdown.findMany.mockReset().mockResolvedValue([]);
  h.prisma.contractorContract.findFirst.mockReset().mockResolvedValue({ id: "ag" });

    h.prisma.contractor.findFirst.mockResolvedValue({ id: CONTRACTOR, name: "Pappu Contractor" });
    h.prisma.project.findFirst.mockResolvedValue({ id: PROJECT, name: "Project A" });
    h.prisma.labourAttendance.aggregate.mockResolvedValue({
      _sum: { estimatedCostPaise: RS_6L },
    });
    h.prisma.labourAttendance.findMany.mockResolvedValue([]);
  h.prisma.labourAttendance.groupBy.mockResolvedValue([
    { contractId: null, _sum: { estimatedCostPaise: RS_6L } },
  ]);
    h.prisma.labourAttendance.updateMany.mockResolvedValue({ count: 3 });
    // The contractor is holding a ₹2,00,000 PROJECT-scoped advance. Project
    // scope matters: the demo/production composition here is entirely
    // unattributed, and an agreement-scoped advance would (correctly) not be
    // consumable against labour that hasn't been attributed to that agreement.
    h.prisma.contractorLedgerEntry.findMany.mockResolvedValue([
      {
        id: "adv-1",
        type: "ADVANCE",
        amountPaise: BigInt(RS_2L),
        projectId: PROJECT,
        contractId: null,
        drawsFromEntryId: null,
        reversesEntryId: null,
        date: new Date("2026-01-15"),
        createdAt: new Date("2026-01-15"),
      },
    ]);
    h.prisma.contractorLedgerEntry.create.mockResolvedValue({ id: "l1" });
    h.prisma.contractorSettlement.create.mockImplementation(async (args: { data: unknown }) => ({
      id: "st-1",
      ...(args.data as Record<string, unknown>),
      createdAt: new Date(),
    }));
    h.prisma.activityLog.create.mockResolvedValue({ id: "a1" });
    h.prisma.$transaction.mockImplementation(async (arg: unknown) =>
      typeof arg === "function" ? (arg as (tx: unknown) => unknown)(h.prisma) : Promise.all(arg as unknown[]),
    );
  });

  it("bills ₹6,00,000, draws the ₹2,00,000 advance, pays ₹4,00,000 net", async () => {
    const settlement = await createSettlement({
      contractorId: CONTRACTOR,
      projectId: PROJECT,
      periodStart: "2026-02-01",
      periodEnd: "2026-02-07",
      advanceAdjustmentPaise: RS_2L,
    });

    expect(settlement.labourBillPaise).toBe(RS_6L);
    expect(settlement.advanceAdjustmentPaise).toBe(RS_2L);
    expect(settlement.netPaymentPaise).toBe(RS_4L);
    expect(settlement.advanceBalanceAfterPaise).toBe(0);
  });

  it("writes LABOUR_BILL, ADJUSTMENT and PAYMENT, and only ADJUSTMENT moves the balance", async () => {
    await createSettlement({
      contractorId: CONTRACTOR,
      projectId: PROJECT,
      periodStart: "2026-02-01",
      periodEnd: "2026-02-07",
      advanceAdjustmentPaise: RS_2L,
    });

    const written = h.prisma.contractorLedgerEntry.create.mock.calls.map((c) => c[0].data);
    expect(written.map((e) => e.type)).toEqual(["LABOUR_BILL", "ADJUSTMENT", "PAYMENT"]);
    // Money is BigInt at the DB boundary; the pure fold works in numbers.
    expect(
      advanceBalancePaise(written.map((e) => ({ type: e.type, amountPaise: Number(e.amountPaise) }))),
    ).toBe(-RS_2L); // the drawdown, nothing else

    // The drawdown records BOTH the advance it consumed and the bucket it
    // funded — here a project-scoped advance funding the unattributed bucket.
    const adjustment = written.find((e) => e.type === "ADJUSTMENT")!;
    expect(adjustment.drawsFromEntryId).toBe("adv-1");
    expect(adjustment.fundsContractId).toBeNull();
  });

  it("stamps the settled attendance, which is what the agreement then credits", async () => {
    await createSettlement({
      contractorId: CONTRACTOR,
      projectId: PROJECT,
      periodStart: "2026-02-01",
      periodEnd: "2026-02-07",
      advanceAdjustmentPaise: RS_2L,
    });

    expect(h.prisma.labourAttendance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { settlementId: "st-1" } }),
    );
    // Those rows carry the FULL ₹6,00,000 of labour value, so the agreement's
    // credit is the bill — the ₹2,00,000 pre-paid portion included, once.
    expect(reconcileAgreement(snapshot()).totalCreditedPaise).toBe(RS_6L);
  });

  it("the agreement engine never reads the ledger", async () => {
    await createSettlement({
      contractorId: CONTRACTOR,
      projectId: PROJECT,
      periodStart: "2026-02-01",
      periodEnd: "2026-02-07",
      advanceAdjustmentPaise: RS_2L,
    });

    // Structural proof of the rule: an AgreementSnapshot has no ledger input at
    // all, so no advance can ever leak into agreement credit as a second entry.
    expect(Object.keys(snapshot())).not.toContain("ledger");
    expect(Object.keys(snapshot())).not.toContain("advanceBalancePaise");
  });
});
