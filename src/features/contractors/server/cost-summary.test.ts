/**
 * P0 regression, server side — the cost-summary aggregate must EXCLUDE reversed
 * settlements.
 *
 * The behavioural half of this lives in ../cost-summary-reversal.test.ts, which
 * runs the real settle → reverse cycle. This half pins the thing only the server
 * can get wrong: the database filter itself. A reversed settlement keeps its row,
 * so nothing but this `where` stops it being summed forever.
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
    contractor: { findMany: vi.fn() },
    contractorLedgerEntry: { findMany: vi.fn() },
    contractorSettlement: { groupBy: vi.fn() },
  },
}));
vi.mock("@/lib/auth/current-user", () => ({
  requireUser: async () => {
    if (!h.user) throw new Error("UNAUTHENTICATED");
    return h.user;
  },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: h.prisma }));

import { contractorCostSummary } from "./actions";

const PAPPU = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  h.user = OWNER;
  h.prisma.contractor.findMany.mockReset().mockResolvedValue([
    {
      id: PAPPU,
      name: "Pappu",
      phone: null,
      status: "ACTIVE",
      openingAdvancePaise: BigInt(0),
      createdAt: new Date("2026-01-01"),
    },
  ]);
  h.prisma.contractorLedgerEntry.findMany.mockReset().mockResolvedValue([]);
  h.prisma.contractorSettlement.groupBy.mockReset().mockResolvedValue([]);
});

describe("contractorCostSummary — reversed settlements are excluded", () => {
  it("filters the aggregate on reversedAt: null", async () => {
    await contractorCostSummary();

    const args = h.prisma.contractorSettlement.groupBy.mock.calls[0][0];
    expect(args.where).toMatchObject({ companyId: "c1", reversedAt: null });
  });

  it("still scopes the aggregate to the caller's company", async () => {
    await contractorCostSummary();
    expect(h.prisma.contractorSettlement.groupBy.mock.calls[0][0].where.companyId).toBe("c1");
  });

  it("reports only what the filtered aggregate returned", async () => {
    // The database has already excluded the reversed rows; the action must not
    // add anything back on top of them.
    h.prisma.contractorSettlement.groupBy.mockResolvedValue([
      {
        contractorId: PAPPU,
        _sum: {
          labourBillPaise: BigInt(60_000_000),
          netPaymentPaise: BigInt(40_000_000),
          advanceAdjustmentPaise: BigInt(20_000_000),
        },
        _count: { _all: 1 },
      },
    ]);

    const [row] = await contractorCostSummary();
    expect(row.totalBillPaise).toBe(60_000_000);
    expect(row.totalPaidPaise).toBe(40_000_000);
    expect(row.totalAdjustedPaise).toBe(20_000_000);
    expect(row.settlementCount).toBe(1);
  });

  it("reports zeroes for a contractor whose only settlement was reversed", async () => {
    // A fully-reversed contractor drops out of the grouped result entirely.
    h.prisma.contractorSettlement.groupBy.mockResolvedValue([]);

    const [row] = await contractorCostSummary();
    expect(row.totalBillPaise).toBe(0);
    expect(row.totalPaidPaise).toBe(0);
    expect(row.totalAdjustedPaise).toBe(0);
    expect(row.settlementCount).toBe(0);
    // The contractor is still listed — reversal removes the money, not the party.
    expect(row.name).toBe("Pappu");
  });

  it("demands contractors.view before any database work", async () => {
    h.user = u([]);
    await expect(contractorCostSummary()).rejects.toThrow();
    expect(h.prisma.contractorSettlement.groupBy).not.toHaveBeenCalled();
  });
});
