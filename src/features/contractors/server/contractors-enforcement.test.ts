/**
 * Contractor RBAC and read scoping.
 *
 * Two things are pinned. First, every action demands its own permission before
 * any database work — the module previously gated writes on a legacy
 * `role === "OWNER"` check and left READS on authentication alone, so any signed-in
 * member could see every contractor's ledger, balances and settlements.
 *
 * Second, and easier to get wrong: `contractors.view` is PROJECT-SCOPED. It means
 * "this contractor's position on projects I can access", not "everything this
 * contractor has ever done". Company-wide advances carry no project, so they are
 * only visible with `contractors.view_all`.
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

const h = vi.hoisted(() => ({
  user: null as SessionUser | null,
  prisma: {
    contractor: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    project: { findFirst: vi.fn() },
    contractorContract: { findFirst: vi.fn() },
    // getLedger now also COUNTS the whole ledger, to report how many entries a
    // scoped caller cannot see (see server/ledger-scope.test.ts).
    contractorLedgerEntry: { findMany: vi.fn(), count: vi.fn(), create: vi.fn() },
    contractorSettlement: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), groupBy: vi.fn() },
    contractorSettlementBreakdown: { findMany: vi.fn(), create: vi.fn() },
    labourAttendance: { aggregate: vi.fn(), findMany: vi.fn(), groupBy: vi.fn(), updateMany: vi.fn() },
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
  listContractors,
  getContractor,
  createContractor,
  updateContractor,
  recordAdvance,
  getLedger,
  previewSettlement,
  createSettlement,
  listSettlements,
  reverseSettlement,
  contractorCostSummary,
} from "./actions";

const CONTRACTOR = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const AGREEMENT = "33333333-3333-4333-8333-333333333333";

const advanceInput = {
  contractorId: CONTRACTOR,
  date: "2026-02-01",
  amountPaise: 20_000_000,
};
const settlementInput = {
  contractorId: CONTRACTOR,
  projectId: PROJECT,
  periodStart: "2026-02-01",
  periodEnd: "2026-02-07",
  advanceAdjustmentPaise: 0,
};

beforeEach(() => {
  h.user = OWNER;
  Object.values(h.prisma).forEach((m) => {
    if (typeof m === "object") {
      Object.values(m).forEach((f) => (f as ReturnType<typeof vi.fn>).mockReset?.());
    }
  });
  h.prisma.$transaction.mockReset();
  h.prisma.$queryRaw.mockReset().mockResolvedValue([]);
  h.prisma.contractorLedgerEntry.count.mockResolvedValue(0);
  h.prisma.contractor.findFirst.mockResolvedValue({
    id: CONTRACTOR,
    name: "Pappu",
    phone: null,
    status: "ACTIVE",
    openingAdvancePaise: BigInt(0),
    createdAt: new Date("2026-01-01"),
  });
  h.prisma.contractor.findMany.mockResolvedValue([]);
  h.prisma.project.findFirst.mockResolvedValue({ id: PROJECT, name: "Project A" });
  h.prisma.contractorLedgerEntry.findMany.mockResolvedValue([]);
  h.prisma.contractorLedgerEntry.create.mockResolvedValue({
    id: "l1",
    contractorId: CONTRACTOR,
    date: new Date("2026-02-01"),
    type: "ADVANCE",
    amountPaise: BigInt(20_000_000),
    advanceBalanceAfterPaise: BigInt(20_000_000),
    notes: null,
    settlementId: null,
    createdAt: new Date(),
  });
  h.prisma.contractorSettlement.findMany.mockResolvedValue([]);
  h.prisma.contractorSettlement.groupBy.mockResolvedValue([]);
  h.prisma.labourAttendance.aggregate.mockResolvedValue({ _sum: { estimatedCostPaise: 0 } });
  h.prisma.labourAttendance.findMany.mockResolvedValue([]);
  h.prisma.labourAttendance.groupBy.mockResolvedValue([]);
  h.prisma.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(h.prisma) : Promise.all(arg as unknown[]),
  );
});

/* ── Every action demands its own permission ────────────────────────────── */

describe("reads are no longer open to any signed-in member", () => {
  it.each([
    ["listContractors", () => listContractors()],
    ["getContractor", () => getContractor(CONTRACTOR)],
    ["getLedger", () => getLedger(CONTRACTOR)],
    ["listSettlements", () => listSettlements()],
    ["contractorCostSummary", () => contractorCostSummary()],
  ])("%s requires contractors.view", async (_name, call) => {
    h.user = u(["projects.view"]);
    await expect(call()).rejects.toThrow("FORBIDDEN");
  });

  it("previewSettlement requires contractors.settle, not merely view", async () => {
    h.user = u(["contractors.view"]);
    await expect(
      previewSettlement({ ...settlementInput, advanceAdjustmentPaise: 0 }),
    ).rejects.toThrow("FORBIDDEN");
    // It leaked an advance balance and a labour bill to anyone signed in before.
    expect(h.prisma.labourAttendance.aggregate).not.toHaveBeenCalled();
  });
});

describe("writes demand their own permission", () => {
  it("createContractor needs contractors.create", async () => {
    h.user = u(["contractors.view"]);
    await expect(createContractor({ name: "New" })).rejects.toThrow("FORBIDDEN");
  });

  it("updateContractor needs contractors.edit", async () => {
    h.user = u(["contractors.view"]);
    await expect(updateContractor(CONTRACTOR, { name: "x" })).rejects.toThrow("FORBIDDEN");
  });

  it("recordAdvance needs contractors.advance", async () => {
    h.user = u(["contractors.view", "contractors.settle"]);
    await expect(recordAdvance(advanceInput)).rejects.toThrow("FORBIDDEN");
  });

  it("createSettlement needs contractors.settle", async () => {
    h.user = u(["contractors.view", "contractors.advance"]);
    await expect(createSettlement(settlementInput)).rejects.toThrow("FORBIDDEN");
  });

  it("reverseSettlement needs its own key — settle is not enough", async () => {
    h.user = u(["contractors.view", "contractors.settle", "contractors.advance"]);
    await expect(reverseSettlement("st-1", "wrong")).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.contractorSettlement.findFirst).not.toHaveBeenCalled();
  });
});

/* ── Project scoping ────────────────────────────────────────────────────── */

describe("contractors.view is project-scoped", () => {
  it("limits settlements to the caller's projects", async () => {
    h.user = u(["contractors.view"]);
    await listSettlements();
    const where = h.prisma.contractorSettlement.findMany.mock.calls[0][0].where;
    expect(where.project).toEqual({ pmId: "pm1" });
  });

  it("limits the ledger to entries on accessible projects", async () => {
    h.user = u(["contractors.view"]);
    await getLedger(CONTRACTOR);
    const where = h.prisma.contractorLedgerEntry.findMany.mock.calls[0][0].where;
    // Company-wide advances carry no project, so they are excluded here — they
    // cannot be attributed to a project the caller is limited to.
    expect(where.OR).toEqual([{ project: { pmId: "pm1" } }]);
  });

  it("contractors.view_all removes the scope from settlements and the ledger", async () => {
    h.user = u(["contractors.view", "contractors.view_all"]);
    await listSettlements();
    expect(h.prisma.contractorSettlement.findMany.mock.calls[0][0].where.project).toBeUndefined();

    await getLedger(CONTRACTOR);
    expect(h.prisma.contractorLedgerEntry.findMany.mock.calls[0][0].where.OR).toBeUndefined();
  });

  it("blocks a settlement on a project the caller cannot access", async () => {
    h.user = u(["contractors.settle"]);
    h.prisma.project.findFirst.mockResolvedValue(null);
    await expect(previewSettlement(settlementInput)).rejects.toThrow("FORBIDDEN");
  });
});

/* ── Scoped advances ────────────────────────────────────────────────────── */

describe("agreement-scoped advances", () => {
  it("refuse an agreement on another contractor or project", async () => {
    h.user = u(["contractors.advance"]);
    h.prisma.contractorContract.findFirst.mockResolvedValue(null); // no such agreement here
    await expect(
      recordAdvance({ ...advanceInput, projectId: PROJECT, contractId: AGREEMENT }),
    ).rejects.toThrow("INVALID_AGREEMENT_SCOPE");
  });

  it("accept an agreement that belongs to this contractor and project", async () => {
    h.user = u(["contractors.advance"]);
    h.prisma.contractorContract.findFirst.mockResolvedValue({ id: AGREEMENT });
    await expect(
      recordAdvance({ ...advanceInput, projectId: PROJECT, contractId: AGREEMENT }),
    ).resolves.toBeDefined();

    const written = h.prisma.contractorLedgerEntry.create.mock.calls[0][0].data;
    expect(written.projectId).toBe(PROJECT);
    expect(written.contractId).toBe(AGREEMENT);
  });

  it("reject an agreement scope with no project", async () => {
    h.user = u(["contractors.advance"]);
    await expect(recordAdvance({ ...advanceInput, contractId: AGREEMENT })).rejects.toThrow();
  });

  it("record a company-wide advance when no scope is given", async () => {
    h.user = u(["contractors.advance"]);
    await recordAdvance(advanceInput);
    const written = h.prisma.contractorLedgerEntry.create.mock.calls[0][0].data;
    expect(written.projectId).toBeNull();
    expect(written.contractId).toBeNull();
  });
});

/* ── Current balance comes from the fold, never a stored snapshot ───────── */

describe("current advance balance", () => {
  it("is derived from the ledger fold, not advanceBalanceAfterPaise", async () => {
    h.user = OWNER;
    // Snapshots deliberately disagree with reality: a reversal appends later
    // entries and never rewrites them, so a stale snapshot is expected.
    h.prisma.contractorLedgerEntry.findMany.mockResolvedValue([
      { id: "a", type: "ADVANCE", amountPaise: BigInt(20_000_000), advanceBalanceAfterPaise: BigInt(999), date: new Date("2026-01-01"), notes: null, settlementId: null, contractorId: CONTRACTOR, createdAt: new Date("2026-01-01") },
      { id: "b", type: "ADJUSTMENT", amountPaise: BigInt(20_000_000), advanceBalanceAfterPaise: BigInt(999), date: new Date("2026-02-01"), notes: null, settlementId: null, contractorId: CONTRACTOR, createdAt: new Date("2026-02-01") },
      { id: "c", type: "SETTLEMENT_REVERSAL", amountPaise: BigInt(20_000_000), advanceBalanceAfterPaise: BigInt(999), date: new Date("2026-03-01"), notes: null, settlementId: null, contractorId: CONTRACTOR, createdAt: new Date("2026-03-01") },
    ]);

    const ledger = await getLedger(CONTRACTOR);
    // +20,000,000 − 20,000,000 + 20,000,000 = 20,000,000, not the 999 snapshot.
    expect(ledger.contractor.advanceBalancePaise).toBe(20_000_000);
  });
});
