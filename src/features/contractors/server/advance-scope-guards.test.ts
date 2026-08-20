/**
 * Server enforcement for a SCOPED advance.
 *
 * The sheet now offers project and agreement selectors, which means the client
 * sends ids it did not send before. A select control is a convenience, never a
 * permission check: every one of these ids is re-derived and re-validated here,
 * and these tests are written from the position that the request was forged.
 *
 * Three things are checked, in this order:
 *   1. the CONTRACTOR may take new money at all (archived cannot);
 *   2. the PROJECT is one this caller may reach (tenant + RBAC);
 *   3. the AGREEMENT belongs to this company, this contractor and this project,
 *      and can still spend the money.
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
const SKYLINE = "22222222-2222-4222-8222-222222222222";
const STRUCTURE = "33333333-3333-4333-8333-333333333333";

const h = vi.hoisted(() => ({
  user: null as SessionUser | null,
  prisma: {
    contractor: { findFirst: vi.fn() },
    contractorContract: { findFirst: vi.fn() },
    contractorLedgerEntry: { findMany: vi.fn(), create: vi.fn() },
    project: { findFirst: vi.fn() },
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

import { recordAdvance } from "./actions";

const advance = (over: Record<string, unknown> = {}) =>
  recordAdvance({
    contractorId: PAPPU,
    date: "2026-06-01",
    amountPaise: 50_000_000,
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
  h.prisma.contractor.findFirst.mockResolvedValue({
    id: PAPPU,
    name: "Pappu Contractor",
    status: "ACTIVE",
  });
  h.prisma.project.findFirst.mockResolvedValue({ id: SKYLINE });
  h.prisma.contractorContract.findFirst.mockResolvedValue({
    id: STRUCTURE,
    status: "IN_PROGRESS",
  });
  h.prisma.contractorLedgerEntry.findMany.mockResolvedValue([]);
  h.prisma.contractorLedgerEntry.create.mockResolvedValue({
    id: "l1",
    contractorId: PAPPU,
    date: new Date("2026-06-01"),
    type: "ADVANCE",
    amountPaise: BigInt(50_000_000),
    advanceBalanceAfterPaise: BigInt(50_000_000),
    notes: null,
    settlementId: null,
    projectId: null,
    contractId: null,
    drawsFromEntryId: null,
    reversesEntryId: null,
    fundsContractId: null,
    createdAt: new Date(),
  });
  h.prisma.activityLog.create.mockResolvedValue({ id: "a" });
});

/** The scope fields actually written to the ledger. */
const written = () => {
  const d = h.prisma.contractorLedgerEntry.create.mock.calls[0][0].data;
  return { projectId: d.projectId, contractId: d.contractId };
};

/* ── The three scopes ───────────────────────────────────────────────────── */

describe("recording each scope", () => {
  it("GENERAL stores no project and no agreement", async () => {
    await advance();
    expect(written()).toEqual({ projectId: null, contractId: null });
    // Nothing to validate, so no project lookup at all.
    expect(h.prisma.project.findFirst).not.toHaveBeenCalled();
  });

  it("PROJECT stores the project and no agreement", async () => {
    await advance({ projectId: SKYLINE });
    expect(written()).toEqual({ projectId: SKYLINE, contractId: null });
  });

  it("AGREEMENT stores both", async () => {
    await advance({ projectId: SKYLINE, contractId: STRUCTURE });
    expect(written()).toEqual({ projectId: SKYLINE, contractId: STRUCTURE });
  });

  it("refuses an agreement without a project — the schema will not have it", async () => {
    await expect(advance({ contractId: STRUCTURE })).rejects.toThrow();
    expect(h.prisma.contractorLedgerEntry.create).not.toHaveBeenCalled();
  });
});

/* ── Forged ids ─────────────────────────────────────────────────────────── */

describe("a request that names something it should not", () => {
  it("rejects a project in another company, or one this caller cannot reach", async () => {
    // assertProjectAccess resolves nothing for a project outside the tenant OR
    // outside this PM's projects — the same query answers both.
    h.prisma.project.findFirst.mockResolvedValue(null);
    await expect(advance({ projectId: SKYLINE })).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.contractorLedgerEntry.create).not.toHaveBeenCalled();
  });

  it("rejects an agreement that does not match company + contractor + project", async () => {
    // The lookup carries all four in its WHERE, so any mismatch returns null.
    h.prisma.contractorContract.findFirst.mockResolvedValue(null);
    await expect(advance({ projectId: SKYLINE, contractId: STRUCTURE })).rejects.toThrow(
      "INVALID_AGREEMENT_SCOPE",
    );
    expect(h.prisma.contractorLedgerEntry.create).not.toHaveBeenCalled();
  });

  it("scopes the agreement lookup on all four fields, not just its id", async () => {
    await advance({ projectId: SKYLINE, contractId: STRUCTURE });
    expect(h.prisma.contractorContract.findFirst.mock.calls[0][0].where).toMatchObject({
      id: STRUCTURE,
      companyId: "c1",
      contractorId: PAPPU,
      projectId: SKYLINE,
      deletedAt: null,
    });
  });

  it("checks project access before it writes anything", async () => {
    h.prisma.project.findFirst.mockResolvedValue(null);
    await advance({ projectId: SKYLINE }).catch(() => {});
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
});

/* ── Agreement lifecycle ────────────────────────────────────────────────── */

describe("which agreements may receive earmarked money", () => {
  for (const status of ["NOT_STARTED", "IN_PROGRESS", "ON_HOLD", "COMPLETED"]) {
    it(`${status} accepts it — the agreement can still spend it`, async () => {
      h.prisma.contractorContract.findFirst.mockResolvedValue({ id: STRUCTURE, status });
      await advance({ projectId: SKYLINE, contractId: STRUCTURE });
      expect(h.prisma.contractorLedgerEntry.create).toHaveBeenCalled();
    });
  }

  it("CANCELLED refuses — the money would be stranded on arrival", async () => {
    h.prisma.contractorContract.findFirst.mockResolvedValue({
      id: STRUCTURE,
      status: "CANCELLED",
    });
    await expect(advance({ projectId: SKYLINE, contractId: STRUCTURE })).rejects.toThrow(
      "AGREEMENT_CANCELLED",
    );
    expect(h.prisma.contractorLedgerEntry.create).not.toHaveBeenCalled();
  });

  it("SETTLED refuses — a close-out takes no new money", async () => {
    h.prisma.contractorContract.findFirst.mockResolvedValue({ id: STRUCTURE, status: "SETTLED" });
    await expect(advance({ projectId: SKYLINE, contractId: STRUCTURE })).rejects.toThrow(
      "AGREEMENT_SETTLED",
    );
  });

  it("does NOT apply the lifecycle rule to an unscoped advance", async () => {
    // A general advance names no agreement, so no agreement's status is its business.
    h.prisma.contractorContract.findFirst.mockResolvedValue({
      id: STRUCTURE,
      status: "CANCELLED",
    });
    await advance();
    expect(h.prisma.contractorLedgerEntry.create).toHaveBeenCalled();
  });
});

/* ── Permission and contractor lifecycle ────────────────────────────────── */

describe("who may record a scoped advance", () => {
  it("needs contractors.advance — no separate scoping permission exists", async () => {
    h.user = u(["contractors.view"]);
    await expect(advance({ projectId: SKYLINE })).rejects.toThrow("FORBIDDEN");
  });

  it("is granted by contractors.advance alone", async () => {
    h.user = u(["contractors.advance"]);
    await advance({ projectId: SKYLINE, contractId: STRUCTURE });
    expect(h.prisma.contractorLedgerEntry.create).toHaveBeenCalled();
  });

  it("still refuses an ARCHIVED contractor, whatever the scope", async () => {
    h.prisma.contractor.findFirst.mockResolvedValue({
      id: PAPPU,
      name: "Pappu Contractor",
      status: "INACTIVE",
    });
    for (const scope of [{}, { projectId: SKYLINE }, { projectId: SKYLINE, contractId: STRUCTURE }]) {
      await expect(advance(scope)).rejects.toThrow("CONTRACTOR_ARCHIVED");
    }
    expect(h.prisma.contractorLedgerEntry.create).not.toHaveBeenCalled();
  });
});

/* ── Audit ──────────────────────────────────────────────────────────────── */

describe("the activity log", () => {
  it("records the scope, so the intent is auditable later", async () => {
    await advance({ projectId: SKYLINE, contractId: STRUCTURE });
    expect(h.prisma.activityLog.create.mock.calls[0][0].data.meta).toMatchObject({
      amountPaise: 50_000_000,
      projectId: SKYLINE,
      contractId: STRUCTURE,
    });
  });
});
