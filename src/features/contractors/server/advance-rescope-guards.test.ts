/**
 * Server enforcement for advance re-scope, and the advance-pool lock.
 *
 * Re-scoping can BROADEN the scope of money already handed to a contractor, so
 * every test here is written as though the request were forged. The pool lock
 * gets its own coverage because the race it closes predates this feature: two
 * settlements for different periods could each read the same available advance
 * and both spend it.
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
const SKY = "22222222-2222-4222-8222-222222222222";
const STRUCTURE = "33333333-3333-4333-8333-333333333333";
const ADV = "44444444-4444-4444-8444-444444444444";

const L = (lakhs: number) => lakhs * 100_000 * 100;

const h = vi.hoisted(() => ({
  user: null as SessionUser | null,
  prisma: {
    contractor: { findFirst: vi.fn() },
    contractorContract: { findFirst: vi.fn() },
    contractorLedgerEntry: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    project: { findFirst: vi.fn() },
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

import { previewAdvanceRescope, rescopeAdvance, reverseAdvanceRescope } from "./advance-rescope";

/** A ₹5L Structure-scoped advance with nothing drawn against it. */
const advanceRow = () => ({
  id: ADV,
  type: "ADVANCE",
  amountPaise: BigInt(L(5)),
  projectId: SKY,
  contractId: STRUCTURE,
  drawsFromEntryId: null,
  reversesEntryId: null,
  date: new Date("2026-01-25"),
  createdAt: new Date("2026-01-25"),
});

const rescope = (over: Record<string, unknown> = {}) =>
  rescopeAdvance({
    contractorId: PAPPU,
    advanceId: ADV,
    target: { projectId: null, contractId: null },
    transferPaise: L(2),
    reason: "Agreement scope corrected",
    ...over,
  } as never);

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
  h.prisma.$queryRaw.mockReset().mockResolvedValue([]);
  h.prisma.contractor.findFirst.mockResolvedValue({ id: PAPPU, name: "Pappu Contractor" });
  h.prisma.contractorLedgerEntry.findMany.mockResolvedValue([advanceRow()]);
  h.prisma.contractorLedgerEntry.create.mockImplementation(async () => ({ id: "new-entry" }));
  h.prisma.contractorContract.findFirst.mockResolvedValue({
    status: "IN_PROGRESS",
    title: "Structure",
    project: { name: "Skyline Residency" },
  });
  h.prisma.project.findFirst.mockResolvedValue({ id: SKY, name: "Skyline Residency" });
  h.prisma.activityLog.create.mockResolvedValue({ id: "a" });
});

/* ── Permission ─────────────────────────────────────────────────────────── */

describe("who may re-scope advance funds", () => {
  it("requires contractors.advance_rescope", async () => {
    h.user = u(["contractors.view", "contractors.advance"]);
    await expect(rescope()).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.contractorLedgerEntry.create).not.toHaveBeenCalled();
  });

  it("is NOT granted by contractors.advance — paying and re-scoping differ", async () => {
    h.user = u(["contractors.advance"]);
    await expect(previewAdvanceRescope({
      contractorId: PAPPU,
      advanceId: ADV,
      target: { projectId: null, contractId: null },
      transferPaise: L(1),
    })).rejects.toThrow("FORBIDDEN");
  });

  it("is granted by that permission alone", async () => {
    h.user = u(["contractors.advance_rescope"]);
    const res = await rescope();
    expect("blockers" in res).toBe(false);
  });

  it("works for Owner through the wildcard", async () => {
    h.user = OWNER;
    await rescope();
    expect(h.prisma.contractorLedgerEntry.create).toHaveBeenCalled();
  });

  it("refuses an unauthenticated caller", async () => {
    h.user = null;
    await expect(rescope()).rejects.toThrow("UNAUTHENTICATED");
  });

  it("guards the reversal with the same permission", async () => {
    h.user = u(["contractors.advance"]);
    await expect(
      reverseAdvanceRescope({ transferId: "t1", reason: "x" }),
    ).rejects.toThrow("FORBIDDEN");
  });
});

/* ── The pool lock ──────────────────────────────────────────────────────── */

describe("the advance-pool lock", () => {
  it("is taken before any figure is read", async () => {
    await rescope();
    expect(h.prisma.$queryRaw).toHaveBeenCalled();
    const sql = String(h.prisma.$queryRaw.mock.calls[0][0]);
    expect(sql).toMatch(/contractor_ledger_entries/);
    expect(sql).toMatch(/FOR UPDATE/);
  });

  it("recomputes the remaining balance from LOCKED state, not the preview", async () => {
    // The preview saw ₹5L free. Under the lock a settlement has taken ₹4L.
    h.prisma.contractorLedgerEntry.findMany.mockResolvedValue([
      advanceRow(),
      {
        ...advanceRow(),
        id: "adj",
        type: "ADJUSTMENT",
        amountPaise: BigInt(L(4)),
        drawsFromEntryId: ADV,
      },
    ]);
    expect(await rescope({ transferPaise: L(2) })).toMatchObject({
      blockers: ["OVER_TRANSFER"],
    });
    expect(h.prisma.contractorLedgerEntry.create).not.toHaveBeenCalled();
  });

  it("never lets the source go negative", async () => {
    h.prisma.contractorLedgerEntry.findMany.mockResolvedValue([
      advanceRow(),
      {
        ...advanceRow(),
        id: "out1",
        type: "SCOPE_TRANSFER_OUT",
        amountPaise: BigInt(L(5)),
        drawsFromEntryId: ADV,
      },
    ]);
    expect(await rescope({ transferPaise: 1 })).toMatchObject({ blockers: ["SOURCE_EXHAUSTED"] });
  });
});

/* ── Source rules ───────────────────────────────────────────────────────── */

describe("what may be re-scoped", () => {
  it("refuses an unknown advance", async () => {
    h.prisma.contractorLedgerEntry.findMany.mockResolvedValue([]);
    expect(await rescope()).toMatchObject({ blockers: ["SOURCE_NOT_FOUND"] });
  });

  it("refuses a settlement drawdown — that is not money you hold", async () => {
    h.prisma.contractorLedgerEntry.findMany.mockResolvedValue([
      { ...advanceRow(), type: "ADJUSTMENT" },
    ]);
    expect(await rescope()).toMatchObject({ blockers: ["SOURCE_NOT_TRANSFERABLE"] });
  });

  it("refuses a labour bill and a payment", async () => {
    for (const type of ["LABOUR_BILL", "PAYMENT"]) {
      h.prisma.contractorLedgerEntry.findMany.mockResolvedValue([{ ...advanceRow(), type }]);
      expect(await rescope()).toMatchObject({ blockers: ["SOURCE_NOT_TRANSFERABLE"] });
    }
  });

  it("ALLOWS a source whose agreement is cancelled — that is the whole point", async () => {
    // The source agreement's status is never consulted; only the TARGET's is.
    h.prisma.contractorContract.findFirst.mockResolvedValue({
      status: "CANCELLED",
      title: "Structure",
      project: { name: "Skyline Residency" },
    });
    const res = await rescope({ target: { projectId: null, contractId: null } });
    expect("blockers" in res).toBe(false);
  });
});

/* ── Target rules ───────────────────────────────────────────────────────── */

describe("target validation", () => {
  // A DIFFERENT agreement from the source, so NO_SCOPE_CHANGE doesn't also fire
  // and mask the blocker under test.
  const toAgreement = { target: { projectId: SKY, contractId: "other-agreement" } };

  it("refuses an agreement that isn't this contractor's on that project", async () => {
    h.prisma.contractorContract.findFirst.mockResolvedValue(null);
    const res = await rescope(toAgreement);
    expect("blockers" in res && res.blockers).toContain("TARGET_AGREEMENT_INVALID");
  });

  it("scopes the agreement lookup on company, contractor, project and not-deleted", async () => {
    await rescope(toAgreement);
    const where = h.prisma.contractorContract.findFirst.mock.calls.find(
      (c) => c[0]?.where?.contractorId,
    )![0].where;
    expect(where).toMatchObject({
      id: "other-agreement",
      companyId: "c1",
      contractorId: PAPPU,
      projectId: SKY,
      deletedAt: null,
    });
  });

  it("refuses SETTLED and CANCELLED targets, via the shared Pass 8 rule", async () => {
    for (const [status, code] of [
      ["SETTLED", "TARGET_AGREEMENT_SETTLED"],
      ["CANCELLED", "TARGET_AGREEMENT_CANCELLED"],
    ]) {
      h.prisma.contractorContract.findFirst.mockResolvedValue({
        status,
        title: "T",
        project: { name: "P" },
      });
      const res = await rescope(toAgreement);
      expect("blockers" in res && res.blockers).toContain(code);
    }
  });

  it("accepts the four open statuses", async () => {
    for (const status of ["NOT_STARTED", "IN_PROGRESS", "ON_HOLD", "COMPLETED"]) {
      h.prisma.contractorLedgerEntry.create.mockClear();
      h.prisma.contractorContract.findFirst.mockResolvedValue({
        status,
        title: "T",
        project: { name: "P" },
      });
      const res = await rescope({ target: { projectId: SKY, contractId: "other-agreement" } });
      expect("blockers" in res).toBe(false);
    }
  });

  it("refuses a project outside the tenant", async () => {
    h.prisma.project.findFirst.mockResolvedValue(null);
    expect(await rescope({ target: { projectId: SKY, contractId: null } })).toMatchObject({
      blockers: ["TARGET_PROJECT_INVALID"],
    });
  });

  it("refuses a move that changes nothing", async () => {
    expect(
      await rescope({ target: { projectId: SKY, contractId: STRUCTURE } }),
    ).toMatchObject({ blockers: ["NO_SCOPE_CHANGE"] });
  });
});

/* ── The write ──────────────────────────────────────────────────────────── */

describe("what a re-scope writes", () => {
  it("writes an OUT and an IN that net to zero on the balance", async () => {
    await rescope();
    const calls = h.prisma.contractorLedgerEntry.create.mock.calls.map((c) => c[0].data);
    expect(calls).toHaveLength(2);

    const [out, inn] = calls;
    expect(out.type).toBe("SCOPE_TRANSFER_OUT");
    expect(inn.type).toBe("SCOPE_TRANSFER_IN");
    expect(Number(out.amountPaise)).toBe(Number(inn.amountPaise));
    // The IN restores the balance the OUT removed — ₹5L in, ₹5L after.
    expect(Number(inn.advanceBalanceAfterPaise)).toBe(L(5));
    expect(Number(out.advanceBalanceAfterPaise)).toBe(L(3));
  });

  it("keeps the source scope on the OUT and the target scope on the IN", async () => {
    await rescope();
    const [out, inn] = h.prisma.contractorLedgerEntry.create.mock.calls.map((c) => c[0].data);
    expect(out).toMatchObject({ projectId: SKY, contractId: STRUCTURE, drawsFromEntryId: ADV });
    expect(inn).toMatchObject({ projectId: null, contractId: null });
  });

  it("never sets settlementId or fundsContractId — a transfer pays no labour", async () => {
    await rescope();
    for (const data of h.prisma.contractorLedgerEntry.create.mock.calls.map((c) => c[0].data)) {
      expect(data.settlementId).toBeUndefined();
      expect(data.fundsContractId).toBeUndefined();
    }
  });

  it("writes one audit entry carrying the full lineage", async () => {
    await rescope();
    expect(h.prisma.activityLog.create).toHaveBeenCalledTimes(1);
    const meta = h.prisma.activityLog.create.mock.calls[0][0].data.meta;
    expect(meta).toMatchObject({
      contractorId: PAPPU,
      sourceAdvanceId: ADV,
      amountPaise: L(2),
      sourceRemainingBeforePaise: L(5),
      sourceRemainingAfterPaise: L(3),
      reason: "Agreement scope corrected",
    });
    expect(meta.sourceScope).toMatchObject({ kind: "AGREEMENT" });
    expect(meta.targetScope).toMatchObject({ kind: "GENERAL" });
  });

  it("refuses a blank reason before touching the database", async () => {
    expect(await rescope({ reason: "   " })).toMatchObject({ blockers: ["REASON_REQUIRED"] });
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
});
