/**
 * The contractor ledger: an AUTHORITATIVE balance, and the entries a caller may
 * inspect.
 *
 * The defect: `getLedger` filtered the rows by project access, then folded THOSE
 * rows and returned the result as the contractor's advance balance. A project
 * manager therefore saw a number that was arithmetically real but commercially
 * false — the contractor's actual outstanding advance is whatever the settlement
 * allocator will draw against, and that has never been scoped.
 *
 * The brief's case, pinned below: a ₹5,00,000 company-wide advance the PM cannot
 * see plus a ₹2,00,000 project advance they can. The balance is ₹7,00,000. The
 * list shows one row. It must never say ₹2,00,000.
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
/** Sees only projects they manage — the scoped case. */
const SCOPED = u(["contractors.view"]);

const PAPPU = "11111111-1111-4111-8111-111111111111";
const SKYLINE = "22222222-2222-4222-8222-222222222222";
const L = (lakhs: number) => lakhs * 100_000 * 100;

const h = vi.hoisted(() => ({
  user: null as SessionUser | null,
  prisma: {
    contractor: { findFirst: vi.fn() },
    contractorLedgerEntry: { findMany: vi.fn(), count: vi.fn() },
    project: { findFirst: vi.fn() },
    labourAttendance: { aggregate: vi.fn(), groupBy: vi.fn() },
    contractorContract: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/auth/current-user", () => ({
  requireUser: async () => {
    if (!h.user) throw new Error("UNAUTHENTICATED");
    return h.user;
  },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: h.prisma }));

import { getLedger, previewSettlement } from "./actions";

/** A ledger row in the shape `getLedger` reads. */
function entry(over: {
  id: string;
  type: string;
  amountPaise: number;
  projectId?: string | null;
  contractId?: string | null;
}) {
  return {
    id: over.id,
    contractorId: PAPPU,
    date: new Date("2026-01-20"),
    type: over.type,
    amountPaise: BigInt(over.amountPaise),
    advanceBalanceAfterPaise: BigInt(over.amountPaise),
    notes: null,
    settlementId: null,
    projectId: over.projectId ?? null,
    contractId: over.contractId ?? null,
    drawsFromEntryId: null,
    reversesEntryId: null,
    fundsContractId: null,
    createdAt: new Date("2026-01-20"),
    settlement: null,
    project: over.projectId ? { name: "Skyline Tower" } : null,
    contract: null,
  };
}

/** The brief's ledger: ₹5,00,000 company-wide + ₹2,00,000 on Skyline. */
const COMPANY_WIDE = entry({ id: "l-company", type: "ADVANCE", amountPaise: L(5) });
const PROJECT_SCOPED = entry({
  id: "l-skyline",
  type: "ADVANCE",
  amountPaise: L(2),
  projectId: SKYLINE,
});
const ALL_ROWS = [COMPANY_WIDE, PROJECT_SCOPED];

/**
 * Mirror the real behaviour: the authoritative fold reads every row, the visible
 * query applies `ledgerScope`. Discriminated on the presence of that scope.
 */
function wireLedger(visible: typeof ALL_ROWS) {
  h.prisma.contractorLedgerEntry.findMany.mockImplementation(
    async (a: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
      // Three readers, all unscoped except the visible list:
      //   outstandingAdvanceFor → select { type, amountPaise }
      //   scopedLedgerFor       → select including `date` (the allocator)
      //   the visible list      → include, and carries `ledgerScope`
      if (a.select && !a.select.date) {
        return ALL_ROWS.map((e) => ({ type: e.type, amountPaise: e.amountPaise }));
      }
      if (a.select) return ALL_ROWS;
      return "OR" in a.where ? visible : ALL_ROWS;
    },
  );
  h.prisma.contractorLedgerEntry.count.mockResolvedValue(ALL_ROWS.length);
}

beforeEach(() => {
  h.user = OWNER;
  h.prisma.contractor.findFirst.mockReset().mockResolvedValue({
    id: PAPPU,
    name: "Pappu Contractor",
    phone: null,
    status: "ACTIVE",
    openingAdvancePaise: BigInt(0),
    createdAt: new Date("2026-01-01"),
  });
  h.prisma.contractorLedgerEntry.findMany.mockReset();
  h.prisma.contractorLedgerEntry.count.mockReset();
  wireLedger([PROJECT_SCOPED]);
});

/* ── Full access ────────────────────────────────────────────────────────── */

describe("a user who can see everything", () => {
  it("gets the complete ledger and is not told it is partial", async () => {
    const led = await getLedger(PAPPU);
    expect(led.entries).toHaveLength(2);
    expect(led.isPartial).toBe(false);
    expect(led.hiddenEntryCount).toBe(0);
  });

  it("sees visible entries that fold EXACTLY to the authoritative balance", async () => {
    const led = await getLedger(PAPPU);
    expect(led.scope).toBe("COMPANY");
    const fold = led.entries.reduce((a, e) => a + e.amountPaise, 0);
    expect(led.contractor.advanceBalancePaise).toBe(L(7));
    expect(fold).toBe(led.contractor.advanceBalancePaise);
  });

  it("applies no scope filter to the visible query", async () => {
    await getLedger(PAPPU);
    const listCall = h.prisma.contractorLedgerEntry.findMany.mock.calls.find(
      (c) => !c[0].select,
    )![0];
    expect("OR" in listCall.where).toBe(false);
  });
});

/* ── Project-scoped ─────────────────────────────────────────────────────── */

describe("a project-scoped user", () => {
  beforeEach(() => {
    h.user = SCOPED;
  });

  it("gets a PROJECT-scoped balance, and the DTO says so", async () => {
    // POLICY B, settled in Pass 5: the catalog reserves cross-project lifetime
    // figures for `contractors.view_all`, so a project-scoped caller is given the
    // fold of what they may see — explicitly labelled `scope: "PROJECT"` so no
    // consumer can present it as the contractor's balance.
    //
    // The ORIGINAL defect is still fixed: what was wrong was not the number but
    // the label. A partial fold presented as "Advance balance" is the bug; a
    // partial fold presented as a project figure is the policy.
    const led = await getLedger(PAPPU);
    expect(led.scope).toBe("PROJECT");
    expect(led.contractor.advanceBalancePaise).toBe(L(2));
  });

  it("is never handed the company-wide total it may not see", async () => {
    const led = await getLedger(PAPPU);
    expect(led.contractor.advanceBalancePaise).not.toBe(L(7));
    expect(JSON.stringify(led)).not.toContain(String(L(5)));
  });

  it("sees only the entries on their projects", async () => {
    const led = await getLedger(PAPPU);
    expect(led.entries.map((e) => e.id)).toEqual(["l-skyline"]);
    expect(led.entries.reduce((a, e) => a + e.amountPaise, 0)).toBe(L(2));
  });

  it("is told the list is partial, and how many rows are missing", async () => {
    const led = await getLedger(PAPPU);
    expect(led.isPartial).toBe(true);
    expect(led.hiddenEntryCount).toBe(1);
  });

  it("leaks nothing about the hidden entry", async () => {
    const led = await getLedger(PAPPU);
    const blob = JSON.stringify(led);
    // No id, amount, note or provenance of the company-wide advance.
    expect(blob).not.toContain("l-company");
    expect(led.entries.some((e) => e.amountPaise === L(5))).toBe(false);
    // The COUNT is disclosed; nothing else is.
    expect(led.hiddenEntryCount).toBe(1);
  });

  it("scopes the visible query by project access", async () => {
    await getLedger(PAPPU);
    const listCall = h.prisma.contractorLedgerEntry.findMany.mock.calls.find(
      (c) => !c[0].select,
    )![0];
    expect(listCall.where).toMatchObject({ OR: [{ project: { pmId: "pm1" } }] });
  });

  it("counts hidden rows across the WHOLE ledger, unscoped", async () => {
    await getLedger(PAPPU);
    const countArgs = h.prisma.contractorLedgerEntry.count.mock.calls[0][0];
    expect(countArgs.where).toEqual({ companyId: "c1", contractorId: PAPPU });
  });

  it("reports nothing partial when the scoped user happens to see everything", async () => {
    wireLedger(ALL_ROWS);
    const led = await getLedger(PAPPU);
    expect(led.isPartial).toBe(false);
    expect(led.contractor.advanceBalancePaise).toBe(L(7));
  });
});

/* ── The fold itself ────────────────────────────────────────────────────── */

describe("the authoritative fold", () => {
  const fold = async (rows: { type: string; amountPaise: number }[]) => {
    h.prisma.contractorLedgerEntry.findMany.mockImplementation(async (a: { select?: unknown }) =>
      a.select ? rows.map((r) => ({ type: r.type, amountPaise: BigInt(r.amountPaise) })) : [],
    );
    h.prisma.contractorLedgerEntry.count.mockResolvedValue(rows.length);
    return (await getLedger(PAPPU)).contractor.advanceBalancePaise;
  };

  it("adds opening advances, advances and settlement reversals", async () => {
    expect(
      await fold([
        { type: "OPENING_ADVANCE", amountPaise: L(1) },
        { type: "ADVANCE", amountPaise: L(2) },
        { type: "SETTLEMENT_REVERSAL", amountPaise: L(3) },
      ]),
    ).toBe(L(6));
  });

  it("subtracts adjustments", async () => {
    expect(
      await fold([
        { type: "ADVANCE", amountPaise: L(5) },
        { type: "ADJUSTMENT", amountPaise: L(2) },
      ]),
    ).toBe(L(3));
  });

  it("treats labour bills and payments as balance-neutral", async () => {
    expect(
      await fold([
        { type: "ADVANCE", amountPaise: L(5) },
        { type: "LABOUR_BILL", amountPaise: L(9) },
        { type: "PAYMENT", amountPaise: L(9) },
      ]),
    ).toBe(L(5));
  });

  it("restores the advance after a settlement is reversed", async () => {
    // Settle: ₹2,00,000 drawn down. Then reverse: the drawdown comes back.
    expect(
      await fold([
        { type: "ADVANCE", amountPaise: L(5) },
        { type: "ADJUSTMENT", amountPaise: L(2) },
      ]),
    ).toBe(L(3));
    expect(
      await fold([
        { type: "ADVANCE", amountPaise: L(5) },
        { type: "ADJUSTMENT", amountPaise: L(2) },
        { type: "SETTLEMENT_REVERSAL", amountPaise: L(2) },
      ]),
    ).toBe(L(5));
  });
});

/* ── Company isolation ──────────────────────────────────────────────────── */

describe("company isolation", () => {
  it("folds and counts only this company's rows for this contractor", async () => {
    await getLedger(PAPPU);
    for (const call of h.prisma.contractorLedgerEntry.findMany.mock.calls) {
      expect(call[0].where.companyId).toBe("c1");
      expect(call[0].where.contractorId).toBe(PAPPU);
    }
    expect(h.prisma.contractorLedgerEntry.count.mock.calls[0][0].where.companyId).toBe("c1");
  });

  it("refuses a contractor from another company", async () => {
    h.prisma.contractor.findFirst.mockResolvedValue(null);
    await expect(getLedger(PAPPU)).rejects.toThrow("NOT_FOUND");
  });

  it("demands contractors.view", async () => {
    h.user = u([]);
    await expect(getLedger(PAPPU)).rejects.toThrow();
  });
});

/* ── Settlement is unaffected by display scoping ────────────────────────── */

describe("the settlement allocator never sees the display scope", () => {
  beforeEach(() => {
    h.user = { ...SCOPED, permissions: ["contractors.view", "contractors.settle"] };
    h.prisma.project.findFirst.mockReset().mockResolvedValue({ id: SKYLINE });
    h.prisma.labourAttendance.aggregate
      .mockReset()
      .mockResolvedValue({ _sum: { estimatedCostPaise: L(3) } });
    h.prisma.labourAttendance.groupBy.mockReset().mockResolvedValue([]);
    h.prisma.contractorContract.findMany.mockReset().mockResolvedValue([]);
    wireLedger([PROJECT_SCOPED]);
  });

  const preview = () =>
    previewSettlement({
      contractorId: PAPPU,
      projectId: SKYLINE,
      periodStart: "2026-01-19",
      periodEnd: "2026-01-25",
      advanceAdjustmentPaise: 0,
    });

  it("offers the FULL outstanding advance to a project-scoped user", async () => {
    const p = await preview();
    // ₹7,00,000 outstanding — not the ₹2,00,000 this user can see in the list.
    expect(p.outstandingAdvancePaise).toBe(L(7));
  });

  it("issues no scoped ledger query while computing a settlement", async () => {
    await preview();
    for (const call of h.prisma.contractorLedgerEntry.findMany.mock.calls) {
      // `ledgerScope` adds an OR clause; the allocator must never carry one.
      expect("OR" in call[0].where).toBe(false);
      expect(call[0].where).toMatchObject({ companyId: "c1", contractorId: PAPPU });
    }
  });

  it("gives a full-access user the identical figure", async () => {
    const scoped = await preview();
    h.user = OWNER;
    const full = await preview();
    expect(full.outstandingAdvancePaise).toBe(scoped.outstandingAdvancePaise);
  });
});
