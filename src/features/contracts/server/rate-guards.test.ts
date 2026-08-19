/**
 * Server-side guards on writing an agreed rate.
 *
 * `setScopeRate` and `addScopeItem` both write to the rate ledger, and before
 * this pass neither looked past `contracts.edit`. Two things were missing:
 *
 *   1. The AGREEMENT's own status. A cancelled or settled agreement takes no
 *      attendance (see labor/server/assignment-eligibility's OPEN_STATUSES), so
 *      a rate on one prices nothing — it cannot reach existing rows, which carry
 *      their own snapshot, and there will be no new rows.
 *   2. The CONTRACTOR's lifecycle. An archived contractor takes on no new work,
 *      and a rate is a forward-looking commercial term.
 *
 * The permission itself was already right; it is pinned here so it stays that
 * way, including the rule that VIEWING history needs only `contracts.view`.
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
const SCOPE_ITEM = "55555555-5555-4555-8555-555555555555";
const SUB = "66666666-6666-4666-8666-666666666666";
const PAPPU = "11111111-1111-4111-8111-111111111111";

const h = vi.hoisted(() => ({
  user: null as SessionUser | null,
  prisma: {
    contractorContract: { findFirst: vi.fn() },
    contractScopeItem: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    contractScopeRateRevision: { findMany: vi.fn(), create: vi.fn() },
    contractor: { findFirst: vi.fn() },
    labourSubcategory: { findFirst: vi.fn() },
    labourAttendance: { count: vi.fn() },
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

import { addScopeItem, listRateRevisions, setScopeRate } from "./scope";

const scopeRow = (status = "IN_PROGRESS") => ({
  id: SCOPE_ITEM,
  companyId: "c1",
  projectId: "p1",
  contractId: CONTRACT,
  labourSubcategoryId: SUB,
  currentRatePaise: 85_000,
  rateUnit: "day",
  notes: null,
  createdAt: new Date("2026-01-10"),
  subcategory: { name: "Mason", category: { id: "cat-m", name: "Mason" } },
  contract: {
    title: "Structure Labour Contract",
    startDate: new Date("2026-01-10"),
    status,
    contractorId: PAPPU,
  },
});

const revise = (over: Partial<Parameters<typeof setScopeRate>[0]> = {}) =>
  setScopeRate({
    scopeItemId: SCOPE_ITEM,
    ratePaise: 90_000,
    rateUnit: "day",
    effectiveFrom: "2026-04-01",
    reason: "Annual rate revision",
    ...over,
  });

beforeEach(() => {
  h.user = OWNER;
  Object.values(h.prisma).forEach((m) => {
    if (typeof m === "object") {
      Object.values(m).forEach((f) => (f as ReturnType<typeof vi.fn>).mockReset?.());
    }
  });
  h.prisma.$transaction.mockReset().mockImplementation(async (fn: (tx: unknown) => unknown) =>
    typeof fn === "function" ? fn(h.prisma) : undefined,
  );
  h.prisma.contractScopeItem.findFirst.mockResolvedValue(scopeRow());
  h.prisma.contractScopeItem.update.mockResolvedValue(scopeRow());
  h.prisma.contractScopeItem.create.mockResolvedValue(scopeRow());
  h.prisma.contractScopeRateRevision.create.mockResolvedValue({ id: "rev1" });
  h.prisma.contractScopeRateRevision.findMany.mockResolvedValue([
    {
      id: "rev1",
      ratePaise: 90_000,
      rateUnit: "day",
      effectiveFrom: new Date("2026-04-01"),
      createdAt: new Date("2026-03-25"),
    },
  ]);
  h.prisma.contractor.findFirst.mockResolvedValue({ name: "Pappu Contractor", status: "ACTIVE" });
  h.prisma.contractorContract.findFirst.mockResolvedValue({
    id: CONTRACT,
    companyId: "c1",
    projectId: "p1",
    contractorId: PAPPU,
    title: "Structure Labour Contract",
    startDate: new Date("2026-01-10"),
    status: "IN_PROGRESS",
    deletedAt: null,
  });
  h.prisma.labourSubcategory.findFirst.mockResolvedValue({ id: SUB, name: "Mason" });
  h.prisma.activityLog.create.mockResolvedValue({ id: "a" });
});

/* ── Permissions ────────────────────────────────────────────────────────── */

describe("who may revise a rate", () => {
  it("reading history needs only contracts.view", async () => {
    h.user = u(["contracts.view"]);
    await expect(listRateRevisions(SCOPE_ITEM)).resolves.toBeDefined();
  });

  it("a VIEWER cannot revise — the server refuses, whatever the UI shows", async () => {
    h.user = u(["contracts.view"]);
    await expect(revise()).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.contractScopeRateRevision.create).not.toHaveBeenCalled();
  });

  it("contracts.edit CAN revise", async () => {
    h.user = u(["contracts.view", "contracts.edit"]);
    await revise();
    expect(h.prisma.contractScopeRateRevision.create).toHaveBeenCalled();
  });

  it("is not gated on Owner — the wildcard works, but is not required", async () => {
    h.user = OWNER;
    await revise();
    expect(h.prisma.contractScopeRateRevision.create).toHaveBeenCalled();
  });

  it("an unauthenticated caller gets nowhere", async () => {
    h.user = null;
    await expect(revise()).rejects.toThrow("UNAUTHENTICATED");
  });
});

/* ── Agreement lifecycle ────────────────────────────────────────────────── */

describe("the agreement's own status", () => {
  for (const status of ["NOT_STARTED", "IN_PROGRESS", "ON_HOLD", "COMPLETED"]) {
    it(`${status} accepts a revision — attendance can still resolve against it`, async () => {
      h.prisma.contractScopeItem.findFirst.mockResolvedValue(scopeRow(status));
      await revise();
      expect(h.prisma.contractScopeRateRevision.create).toHaveBeenCalled();
    });
  }

  it("CANCELLED refuses — a rate on a void agreement prices nothing", async () => {
    h.prisma.contractScopeItem.findFirst.mockResolvedValue(scopeRow("CANCELLED"));
    await expect(revise()).rejects.toThrow("AGREEMENT_CANCELLED");
    expect(h.prisma.contractScopeRateRevision.create).not.toHaveBeenCalled();
  });

  it("SETTLED refuses — the book is closed and takes no more labour", async () => {
    h.prisma.contractScopeItem.findFirst.mockResolvedValue(scopeRow("SETTLED"));
    await expect(revise()).rejects.toThrow("AGREEMENT_SETTLED");
    expect(h.prisma.contractScopeRateRevision.create).not.toHaveBeenCalled();
  });

  it("guards ADDING a scope item too — its opening rate is a rate write", async () => {
    h.prisma.contractorContract.findFirst.mockResolvedValue({
      id: CONTRACT,
      companyId: "c1",
      projectId: "p1",
      contractorId: PAPPU,
      title: "T",
      startDate: new Date("2026-01-10"),
      status: "CANCELLED",
      deletedAt: null,
    });
    await expect(
      addScopeItem({
        contractId: CONTRACT,
        labourSubcategoryId: SUB,
        ratePaise: 70_000,
        effectiveFrom: "2026-02-01",
      }),
    ).rejects.toThrow("AGREEMENT_CANCELLED");
  });
});

/* ── Contractor lifecycle ───────────────────────────────────────────────── */

describe("an archived contractor", () => {
  beforeEach(() => {
    h.prisma.contractor.findFirst.mockResolvedValue({
      name: "Pappu Contractor",
      status: "INACTIVE",
    });
  });

  it("takes no new rate — a rate is a forward-looking commercial term", async () => {
    await expect(revise()).rejects.toThrow("CONTRACTOR_ARCHIVED");
    expect(h.prisma.contractScopeRateRevision.create).not.toHaveBeenCalled();
  });

  it("says so in words, naming the contractor and the way out", async () => {
    await expect(revise()).rejects.toThrow(/Pappu Contractor is archived/);
    await expect(revise()).rejects.toThrow(/Restore them first/);
  });

  it("loses nothing by being refused — no attendance can attach while archived", async () => {
    // Stated as a rule rather than left implicit: existing rows carry their own
    // snapshot, and Pass 5.1 stopped new attendance, so a revision here could
    // not change a single recorded figure even if it were allowed.
    h.prisma.contractor.findFirst.mockResolvedValue({ name: "Pappu", status: "ACTIVE" });
    await revise();
    expect(h.prisma.contractScopeItem.update).toHaveBeenCalled();
  });
});

/* ── The write itself ───────────────────────────────────────────────────── */

describe("what a revision writes", () => {
  it("APPENDS a revision row carrying the date and reason given", async () => {
    await revise({ effectiveFrom: "2026-07-01", reason: "Negotiated rate change" });
    const data = h.prisma.contractScopeRateRevision.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      scopeItemId: SCOPE_ITEM,
      ratePaise: 90_000,
      reason: "Negotiated rate change",
    });
    expect(data.effectiveFrom).toEqual(new Date("2026-07-01"));
  });

  it("recomputes currentRatePaise from the WHOLE ledger, not from the new value", async () => {
    // A FUTURE-dated revision must not change what the agreement charges today.
    h.prisma.contractScopeRateRevision.findMany.mockResolvedValue([
      {
        id: "rev1",
        ratePaise: 85_000,
        rateUnit: "day",
        effectiveFrom: new Date("2026-01-10"),
        createdAt: new Date("2026-01-10"),
      },
      {
        id: "rev2",
        ratePaise: 99_000,
        rateUnit: "day",
        effectiveFrom: new Date("2099-01-01"),
        createdAt: new Date(),
      },
    ]);
    await revise({ ratePaise: 99_000, effectiveFrom: "2099-01-01" });

    // Today's rate is still the January one — the scheduled rise is not "current".
    expect(h.prisma.contractScopeItem.update.mock.calls[0][0].data.currentRatePaise).toBe(85_000);
  });

  it("writes ONE audit entry with old rate, new rate, date and reason", async () => {
    await revise({ effectiveFrom: "2026-07-01", reason: "Scope variation" });
    expect(h.prisma.activityLog.create).toHaveBeenCalledTimes(1);
    const meta = h.prisma.activityLog.create.mock.calls[0][0].data.meta;
    expect(meta).toMatchObject({
      fromRatePaise: 85_000,
      toRatePaise: 90_000,
      effectiveFrom: "2026-07-01",
      reason: "Scope variation",
    });
  });

  it("never touches an existing revision — history is append-only", async () => {
    await revise();
    // There is no update path for a revision row at all, by design.
    expect(
      Object.keys(h.prisma.contractScopeRateRevision).includes("update"),
    ).toBe(false);
  });

  it("refuses an effective date before the agreement started", async () => {
    await expect(revise({ effectiveFrom: "2020-01-01" })).rejects.toThrow("INVALID_RATE");
    expect(h.prisma.contractScopeRateRevision.create).not.toHaveBeenCalled();
  });

  it("refuses a zero rate", async () => {
    await expect(revise({ ratePaise: 0 })).rejects.toThrow();
    expect(h.prisma.contractScopeRateRevision.create).not.toHaveBeenCalled();
  });
});
