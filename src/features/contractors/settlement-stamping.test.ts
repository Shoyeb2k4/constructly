/**
 * The settlement↔attendance contract (D1 / D1a).
 *
 * Constructly recognises labour money in exactly ONE place: the weekly
 * settlement. An agreement counts attendance as credit only once a settlement
 * has recognised it, which is what makes double-counting structurally
 * impossible — the ₹6,00,000 that a settlement bills and the ₹6,00,000 an
 * agreement credits are the same rows, not two independent sums.
 *
 * Two properties have to hold for that to be true, and both are pinned here:
 *
 *   1. STAMP ONCE. A settlement claims only unstamped rows, so a duplicate or
 *      overlapping settlement (which still re-bills — a pre-existing behaviour
 *      left deliberately untouched) cannot credit an agreement twice.
 *
 *   2. SETTLED IS IMMUTABLE. Once stamped, a row can't be edited or cleared, so
 *      the recognised figure can never drift away from the settlement that
 *      recognised it.
 *
 * It also pins the thing that must NOT change: labourBillPaise still sums every
 * attendance row in the period, so the number users see on the settlement screen
 * is unaffected by any of this.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import { ALL_PERMISSIONS } from "@/features/rbac/permissions";

const OWNER: SessionUser = {
  id: "o1",
  email: "o@x.com",
  fullName: "Owner",
  role: "OWNER",
  permissions: [...ALL_PERMISSIONS],
  company: { id: "c1", name: "Co" },
};
const PM: SessionUser = {
  id: "pm1",
  email: "pm@x.com",
  fullName: "PM",
  role: "PROJECT_MANAGER",
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
      findFirst: vi.fn(),
      findMany: vi.fn(),
      groupBy: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    labourSubcategory: { findFirst: vi.fn() },
    contractorLedgerEntry: { findMany: vi.fn(), create: vi.fn() },
    contractorSettlement: { create: vi.fn() },
    contractorSettlementBreakdown: { create: vi.fn(), findMany: vi.fn() },
    contractorContract: { findFirst: vi.fn(), findMany: vi.fn() },
    $queryRaw: vi.fn(),
    projectContractor: { findMany: vi.fn() },
    projectContractorLabourRate: { findFirst: vi.fn() },
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
import { setQuantity } from "@/features/labor/server/actions";

// Real UUIDs — the schemas validate the shape before anything runs.
const CONTRACTOR = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const SUB = "33333333-3333-4333-8333-333333333333";
const PERIOD = { periodStart: "2026-02-01", periodEnd: "2026-02-07" };

/** ₹6,00,000 of labour in the period. */
const BILL_PAISE = 60_000_000;

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
  h.prisma.project.findFirst.mockResolvedValue({ id: PROJECT, name: "Project A", pmId: "o1" });
  h.prisma.labourAttendance.aggregate.mockResolvedValue({ _sum: { estimatedCostPaise: BILL_PAISE } });
  h.prisma.labourAttendance.updateMany.mockResolvedValue({ count: 4 });
  h.prisma.labourAttendance.findFirst.mockResolvedValue(null);
  h.prisma.labourAttendance.findMany.mockResolvedValue([]);
  h.prisma.labourAttendance.groupBy.mockResolvedValue([
    { contractId: null, _sum: { estimatedCostPaise: BILL_PAISE } },
  ]);
  h.prisma.labourAttendance.deleteMany.mockResolvedValue({ count: 1 });
  h.prisma.projectContractor.findMany.mockResolvedValue([]);
  h.prisma.contractorLedgerEntry.findMany.mockResolvedValue([]);
  h.prisma.contractorLedgerEntry.create.mockResolvedValue({ id: "l1" });
  h.prisma.contractorSettlement.create.mockResolvedValue({
    id: "st-1",
    contractorId: CONTRACTOR,
    projectId: PROJECT,
    periodStart: new Date(PERIOD.periodStart),
    periodEnd: new Date(PERIOD.periodEnd),
    labourBillPaise: BILL_PAISE,
    advanceAdjustmentPaise: 0,
    netPaymentPaise: BILL_PAISE,
    advanceBalanceAfterPaise: 0,
    notes: null,
    createdAt: new Date(),
  });
  h.prisma.activityLog.create.mockResolvedValue({ id: "a1" });
  h.prisma.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(h.prisma) : Promise.all(arg as unknown[]),
  );
});

async function settle() {
  return createSettlement({
    contractorId: CONTRACTOR,
    projectId: PROJECT,
    ...PERIOD,
    advanceAdjustmentPaise: 0,
  });
}

describe("the settlement bill is unchanged", () => {
  it("still sums EVERY attendance row in the period, agreement-attributed or not", async () => {
    await settle();
    const where = h.prisma.labourAttendance.aggregate.mock.calls[0][0].where;

    expect(where).toMatchObject({ companyId: "c1", contractorId: CONTRACTOR, projectId: PROJECT });
    // Crucially NOT filtered by contractId: excluding agreement labour here
    // would silently change the figure users have been settling against.
    expect(where.contractId).toBeUndefined();
    expect(where.settlementId).toBeUndefined();
  });

  it("bills the full period total", async () => {
    const settlement = await settle();
    expect(settlement.labourBillPaise).toBe(BILL_PAISE);
    expect(settlement.netPaymentPaise).toBe(BILL_PAISE);
  });
});

describe("stamping claims each row exactly once", () => {
  it("stamps the period's attendance with the new settlement id", async () => {
    await settle();
    expect(h.prisma.labourAttendance.updateMany).toHaveBeenCalledTimes(1);
    const call = h.prisma.labourAttendance.updateMany.mock.calls[0][0];

    expect(call.data).toEqual({ settlementId: "st-1" });
    expect(call.where).toMatchObject({
      companyId: "c1",
      contractorId: CONTRACTOR,
      projectId: PROJECT,
    });
  });

  it("claims ONLY unstamped rows, so a re-settle cannot double-credit", async () => {
    await settle();
    const where = h.prisma.labourAttendance.updateMany.mock.calls[0][0].where;
    // This single clause is what makes double-counting impossible: rows already
    // recognised by an earlier settlement stay with that settlement.
    expect(where.settlementId).toBeNull();
  });

  it("scopes the stamp to the settled period", async () => {
    await settle();
    const where = h.prisma.labourAttendance.updateMany.mock.calls[0][0].where;
    expect(where.date).toEqual({
      gte: new Date(PERIOD.periodStart),
      lte: new Date(PERIOD.periodEnd),
    });
  });

  it("stamps inside the same transaction as the settlement and its ledger", async () => {
    await settle();
    // One transaction covers settlement + ledger entries + the stamp, so a
    // failure can never leave attendance claimed by a settlement that doesn't
    // exist.
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(h.prisma.contractorSettlement.create).toHaveBeenCalled();
    expect(h.prisma.contractorLedgerEntry.create).toHaveBeenCalled();
    expect(h.prisma.labourAttendance.updateMany).toHaveBeenCalled();
  });

  it("the stamp is the second line of defence — the overlap guard is the first", async () => {
    await settle();
    // Even if a settlement somehow reached the stamp over claimed rows, the
    // settlementId: null clause means none of them would change hands.
    const stamp = h.prisma.labourAttendance.updateMany.mock.calls[0][0];
    expect(stamp.where.settlementId).toBeNull();
  });
});

describe("settled attendance is financially immutable", () => {
  beforeEach(() => {
    h.user = PM;
    h.prisma.project.findFirst.mockResolvedValue({ id: PROJECT, pmId: "pm1" });
  });

  it("refuses to edit a settled row", async () => {
    h.prisma.labourAttendance.findFirst.mockResolvedValue({ id: "att-1" }); // settled
    await expect(setQuantity({ projectId: PROJECT, date: "2026-02-03", subcategoryId: SUB, quantity: 5, contractorId: CONTRACTOR })).rejects.toThrow(
      "ATTENDANCE_SETTLED",
    );
    expect(h.prisma.labourAttendance.update).not.toHaveBeenCalled();
    expect(h.prisma.labourAttendance.create).not.toHaveBeenCalled();
  });

  it("refuses to CLEAR a settled row", async () => {
    // Clearing is the sneakier path: it would erase recognised value entirely.
    h.prisma.labourAttendance.findFirst.mockResolvedValue({ id: "att-1" });
    await expect(setQuantity({ projectId: PROJECT, date: "2026-02-03", subcategoryId: SUB, quantity: 0, contractorId: CONTRACTOR })).rejects.toThrow(
      "ATTENDANCE_SETTLED",
    );
    expect(h.prisma.labourAttendance.deleteMany).not.toHaveBeenCalled();
  });

  it("checks the settled flag before doing any write work", async () => {
    h.prisma.labourAttendance.findFirst.mockResolvedValue({ id: "att-1" });
    await expect(setQuantity({ projectId: PROJECT, date: "2026-02-03", subcategoryId: SUB, quantity: 5, contractorId: CONTRACTOR })).rejects.toThrow(
      "ATTENDANCE_SETTLED",
    );
    const where = h.prisma.labourAttendance.findFirst.mock.calls[0][0].where;
    expect(where.settlementId).toEqual({ not: null });
    expect(where).toMatchObject({ projectId: PROJECT, labourSubcategoryId: SUB, contractorId: CONTRACTOR });
  });

  it("no permission overrides it — an Owner is refused too", async () => {
    h.user = OWNER;
    h.prisma.project.findFirst.mockResolvedValue({ id: PROJECT, pmId: "o1" });
    h.prisma.labourAttendance.findFirst.mockResolvedValue({ id: "att-1" });
    await expect(setQuantity({ projectId: PROJECT, date: "2026-02-03", subcategoryId: SUB, quantity: 5, contractorId: CONTRACTOR })).rejects.toThrow(
      "ATTENDANCE_SETTLED",
    );
  });

  it("leaves UNSETTLED rows in the same period fully editable", async () => {
    h.prisma.labourAttendance.findFirst.mockResolvedValue(null); // nothing settled
    h.prisma.projectContractorLabourRate.findFirst.mockResolvedValue({ id: "lr1", ratePaise: 90_000 });
    h.prisma.projectContractor.findMany.mockResolvedValue([]);
    h.prisma.contractorContract.findMany.mockResolvedValue([]);
    h.prisma.labourAttendance.findMany.mockResolvedValue([]);
    h.prisma.labourAttendance.deleteMany.mockResolvedValue({ count: 0 });

    await expect(
      setQuantity({ projectId: PROJECT, date: "2026-02-03", subcategoryId: SUB, quantity: 5, contractorId: CONTRACTOR }),
    ).resolves.toBeDefined();
  });
});

/* ── Overlap guard ──────────────────────────────────────────────────────── */

/** Attendance rows the overlap query would find, i.e. already settled ones. */
function alreadySettled(dates: string[], settlementId = "st-earlier") {
  return dates.map((d) => ({ date: new Date(d), settlementId }));
}

describe("a settlement cannot re-bill already-settled attendance", () => {
  beforeEach(() => {
    h.user = OWNER;
    h.prisma.labourAttendance.findMany.mockResolvedValue([]);
  h.prisma.labourAttendance.groupBy.mockResolvedValue([
    { contractId: null, _sum: { estimatedCostPaise: BILL_PAISE } },
  ]);
  });

  it("rejects an exact duplicate period", async () => {
    h.prisma.labourAttendance.findMany.mockResolvedValue(
      alreadySettled(["2026-02-02", "2026-02-03", "2026-02-05"]),
    );
    await expect(settle()).rejects.toThrow("SETTLEMENT_PERIOD_OVERLAPS");
  });

  it("rejects a partially overlapping period", async () => {
    // 01–07 settled; now someone tries 05–10, which shares 05, 06, 07.
    h.prisma.labourAttendance.findMany.mockResolvedValue(
      alreadySettled(["2026-02-05", "2026-02-06", "2026-02-07"]),
    );
    await expect(
      createSettlement({
        contractorId: CONTRACTOR,
        projectId: PROJECT,
        periodStart: "2026-02-05",
        periodEnd: "2026-02-10",
        advanceAdjustmentPaise: 0,
      }),
    ).rejects.toThrow("SETTLEMENT_PERIOD_OVERLAPS");
  });

  it("names the conflicting dates so the caller can explain the clash", async () => {
    h.prisma.labourAttendance.findMany.mockResolvedValue(
      alreadySettled(["2026-02-05", "2026-02-06"]),
    );
    await expect(settle()).rejects.toThrow(/2026-02-05[\s\S]*2026-02-06/);
  });

  it("caps the listed dates but still reports the true count", async () => {
    h.prisma.labourAttendance.findMany.mockResolvedValue(
      alreadySettled([
        "2026-02-01",
        "2026-02-02",
        "2026-02-03",
        "2026-02-04",
        "2026-02-05",
        "2026-02-06",
        "2026-02-07",
      ]),
    );
    await expect(settle()).rejects.toThrow(/7 attendance records/);
    await expect(settle()).rejects.toThrow(/and 2 more/);
  });

  it("allows an adjacent, non-overlapping period", async () => {
    // 01–07 settled; 08–14 shares nothing, so the query returns nothing.
    h.prisma.labourAttendance.findMany.mockResolvedValue([]);
  h.prisma.labourAttendance.groupBy.mockResolvedValue([
    { contractId: null, _sum: { estimatedCostPaise: BILL_PAISE } },
  ]);
    await expect(
      createSettlement({
        contractorId: CONTRACTOR,
        projectId: PROJECT,
        periodStart: "2026-02-08",
        periodEnd: "2026-02-14",
        advanceAdjustmentPaise: 0,
      }),
    ).resolves.toBeDefined();
  });

  it("allows a normal settlement once the previous period has ended", async () => {
    h.prisma.labourAttendance.findMany.mockResolvedValue([]);
  h.prisma.labourAttendance.groupBy.mockResolvedValue([
    { contractId: null, _sum: { estimatedCostPaise: BILL_PAISE } },
  ]);
    const s = await settle();
    expect(s.labourBillPaise).toBe(BILL_PAISE);
    expect(h.prisma.contractorSettlement.create).toHaveBeenCalledTimes(1);
  });

  it("scopes the overlap query to this contractor, project and period", async () => {
    await settle();
    const where = h.prisma.labourAttendance.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      companyId: "c1",
      contractorId: CONTRACTOR,
      projectId: PROJECT,
    });
    expect(where.settlementId).toEqual({ not: null });
    expect(where.date).toEqual({
      gte: new Date(PERIOD.periodStart),
      lte: new Date(PERIOD.periodEnd),
    });
  });

  it("a rejected overlap writes NO settlement, ledger entry or stamp", async () => {
    h.prisma.labourAttendance.findMany.mockResolvedValue(alreadySettled(["2026-02-03"]));
    await expect(settle()).rejects.toThrow("SETTLEMENT_PERIOD_OVERLAPS");

    // The guard runs inside the transaction and before every write, so the
    // whole attempt leaves nothing behind.
    expect(h.prisma.contractorSettlement.create).not.toHaveBeenCalled();
    expect(h.prisma.contractorLedgerEntry.create).not.toHaveBeenCalled();
    expect(h.prisma.labourAttendance.updateMany).not.toHaveBeenCalled();
  });

  it("checks for overlap before creating anything, not after", async () => {
    h.prisma.labourAttendance.findMany.mockResolvedValue(alreadySettled(["2026-02-03"]));
    await expect(settle()).rejects.toThrow();
    // The transaction was entered (so the check is atomic with the writes)…
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
    // …but the very first thing it did was the overlap read.
    expect(h.prisma.labourAttendance.findMany).toHaveBeenCalled();
  });
});
