/**
 * Server-side enforcement for contractor agreements.
 *
 * Two things are being pinned here. First, ordinary RBAC: every action demands
 * its exact permission BEFORE any database work, and project scope is applied on
 * top so a permission alone never reaches an unassigned project.
 *
 * Second, and more important, the separations that make the commercial model
 * trustworthy: editing an agreement is not authorising a value increase, and
 * completing a milestone is not cancelling an agreement. Those are deliberately
 * different permissions, and these tests fail if they ever collapse.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import { ALL_PERMISSIONS, type Permission } from "@/features/rbac/permissions";

function u(permissions: Permission[]): SessionUser {
  return {
    id: "pm1",
    email: "u@x.com",
    fullName: "U",
    role: "PROJECT_MANAGER",
    permissions,
    company: { id: "c1", name: "Co" },
  };
}
const OWNER = u([...ALL_PERMISSIONS]);

const h = vi.hoisted(() => ({
  user: null as SessionUser | null,
  prisma: {
    contractorContract: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findFirstOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    contractorContractPayment: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      aggregate: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    contractScopeItem: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    contractScopeRateRevision: { findMany: vi.fn(), create: vi.fn() },
    contractMilestone: {
      findFirst: vi.fn(),
      findFirstOrThrow: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    contractAmendment: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn() },
    labourAttendance: { count: vi.fn(), findFirst: vi.fn() },
    labourSubcategory: { findFirst: vi.fn() },
    contractor: { findFirst: vi.fn() },
    project: { findFirst: vi.fn() },
    projectContractor: { upsert: vi.fn() },
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
  listContracts,
  createContract,
  updateContract,
  setContractStatus,
  cancelContract,
  deleteContract,
  recordContractPayment,
  reverseContractPayment,
} from "./actions";
import { addScopeItem, removeScopeItem, setScopeRate } from "./scope";
import { setMilestoneStatus, createMilestone, deleteMilestone } from "./milestones";
import { proposeAmendment, approveAmendment, rejectAmendment } from "./amendments";
import type { CreateContractInput, RecordContractPaymentInput } from "../types";

const CONTRACT = "33333333-3333-4333-8333-333333333333";
const SUB = "44444444-4444-4444-8444-444444444444";

const newContract: CreateContractInput = {
  contractorId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  title: "Structure",
  contractAmountPaise: 600_000_000, // ₹60,00,000
};
const newPayment: RecordContractPaymentInput = {
  contractId: CONTRACT,
  amountPaise: 20_000_000, // ₹2,00,000
  type: "ADVANCE",
  paymentMode: "BANK_TRANSFER",
  date: "2026-08-13",
};

/** A hydrated agreement row shaped like the `agreementInclude` payload. */
function agreementRow(over: Record<string, unknown> = {}) {
  return {
    id: CONTRACT,
    contractorId: "ct1",
    projectId: "p1",
    title: "Structure",
    reference: null,
    scope: null,
    quantity: null,
    unit: null,
    originalAmountPaise: BigInt(600_000_000),
    currentAmountPaise: BigInt(600_000_000),
    startDate: null,
    expectedCompletionDate: null,
    status: "IN_PROGRESS",
    notes: null,
    completedAt: null,
    settledAt: null,
    cancelledAt: null,
    cancelledReason: null,
    createdAt: new Date("2026-01-10"),
    contractor: { name: "Pappu Contractor" },
    project: { name: "Project A" },
    amendments: [],
    milestones: [],
    payments: [],
    attendance: [],
    ...over,
  };
}

beforeEach(() => {
  h.user = OWNER;
  Object.values(h.prisma).forEach((m) => {
    if (typeof m === "object") {
      Object.values(m).forEach((f) => (f as ReturnType<typeof vi.fn>).mockReset?.());
    }
  });
  h.prisma.contractorContract.findMany.mockResolvedValue([]);
  h.prisma.contractorContract.findFirst.mockResolvedValue(agreementRow());
  h.prisma.contractorContract.findFirstOrThrow.mockResolvedValue(agreementRow());
  h.prisma.contractorContract.update.mockResolvedValue(agreementRow());
  h.prisma.contractorContractPayment.count.mockResolvedValue(0);
  h.prisma.contractorContractPayment.aggregate.mockResolvedValue({ _sum: { amountPaise: null } });
  h.prisma.contractMilestone.count.mockResolvedValue(0);
  h.prisma.contractAmendment.count.mockResolvedValue(0);
  h.prisma.contractAmendment.create.mockResolvedValue({ id: "am-new" });
  h.prisma.contractAmendment.findMany.mockResolvedValue([]);
  h.prisma.labourAttendance.count.mockResolvedValue(0);
  h.prisma.project.findFirst.mockResolvedValue({ id: "p1" });
  h.prisma.contractor.findFirst.mockResolvedValue({ id: "ct1" });
  // setMilestoneStatus now locks the agreement row FOR UPDATE and re-reads the
  // milestone under that lock (see server/milestone-lifecycle.test.ts). Default
  // both so the ceiling assertions below still reach the check they test.
  h.prisma.$queryRaw.mockReset().mockResolvedValue([]);
  h.prisma.contractMilestone.findFirstOrThrow.mockImplementation(async () => {
    const pre = await h.prisma.contractMilestone.findFirst();
    return { status: pre?.status ?? "NOT_STARTED", valuePaise: pre?.valuePaise ?? BigInt(0) };
  });

  // $transaction is a bare vi.fn(), so the typeof-"object" sweep above skips it
  // and its call history would leak between tests — reset it explicitly.
  h.prisma.$transaction.mockReset();
  h.prisma.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(h.prisma) : Promise.all(arg as unknown[]),
  );
});

/* ── Ordinary RBAC ──────────────────────────────────────────────────────── */

describe("createContract — create permission + project ownership", () => {
  it("blocks a user without contracts.create", async () => {
    h.user = u(["contracts.view"]);
    await expect(createContract(newContract)).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("blocks creating on a project the PM is not assigned to", async () => {
    h.user = u(["contracts.create"]);
    h.prisma.project.findFirst.mockResolvedValue(null);
    await expect(createContract(newContract)).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a contractor from another company", async () => {
    h.user = u(["contracts.create"]);
    h.prisma.contractor.findFirst.mockResolvedValue(null);
    await expect(createContract(newContract)).rejects.toThrow("FORBIDDEN");
  });
});

describe("each write demands its own permission", () => {
  it("updateContract needs contracts.edit", async () => {
    h.user = u(["contracts.view"]);
    await expect(updateContract("c1", { title: "x" })).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.contractorContract.findFirst).not.toHaveBeenCalled();
  });

  it("setContractStatus needs contracts.complete, not merely edit", async () => {
    h.user = u(["contracts.view", "contracts.edit"]);
    await expect(setContractStatus("c1", "COMPLETED")).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.contractorContract.findFirst).not.toHaveBeenCalled();
  });

  it("deleteContract needs contracts.delete", async () => {
    h.user = u(["contracts.view", "contracts.edit"]);
    await expect(deleteContract("c1")).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("addScopeItem and setScopeRate need contracts.edit", async () => {
    h.user = u(["contracts.view"]);
    await expect(
      addScopeItem({ contractId: CONTRACT, labourSubcategoryId: SUB, ratePaise: 90_000, effectiveFrom: "2026-01-10" }),
    ).rejects.toThrow("FORBIDDEN");
    await expect(
      setScopeRate({ scopeItemId: "si1", ratePaise: 95_000, effectiveFrom: "2026-04-01" }),
    ).rejects.toThrow("FORBIDDEN");
  });

  it("createMilestone needs contracts.edit; setMilestoneStatus needs contracts.complete", async () => {
    h.user = u(["contracts.view"]);
    await expect(
      createMilestone({ contractId: CONTRACT, title: "Slab 1", valuePaise: 100_000_000 }),
    ).rejects.toThrow("FORBIDDEN");

    h.user = u(["contracts.view", "contracts.edit"]);
    await expect(setMilestoneStatus("m1", "COMPLETED")).rejects.toThrow("FORBIDDEN");
  });
});

describe("recordContractPayment — pay permission", () => {
  it("blocks a user without contracts.pay", async () => {
    h.user = u(["contracts.view", "contracts.create"]);
    await expect(recordContractPayment(newPayment)).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.contractorContractPayment.create).not.toHaveBeenCalled();
  });

  it("blocks paying on an agreement the PM cannot access", async () => {
    h.user = u(["contracts.pay"]);
    h.prisma.contractorContract.findFirst.mockResolvedValue(null);
    await expect(recordContractPayment(newPayment)).rejects.toThrow("NOT_FOUND");
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("reverseContractPayment — dedicated pay_delete permission", () => {
  it("blocks a PM with pay but not pay_delete", async () => {
    h.user = u(["contracts.view", "contracts.pay"]);
    await expect(reverseContractPayment("pay1", "wrong contractor")).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.contractorContractPayment.findFirst).not.toHaveBeenCalled();
  });

  it("with pay_delete but no view_all, cannot reverse another PM's payment", async () => {
    h.user = u(["contracts.pay_delete"]);
    h.prisma.contractorContractPayment.findFirst.mockResolvedValue({
      id: "pay1",
      contractId: "c1",
      contractorId: "ct1",
      projectId: "p1",
      amountPaise: BigInt(1),
      contract: { title: "Structure", deletedAt: null },
      project: { pmId: "someone-else" },
    });
    h.prisma.project.findFirst.mockResolvedValue(null); // scoped out
    await expect(reverseContractPayment("pay1", "wrong contractor")).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("requires a reason", async () => {
    h.user = u(["contracts.pay_delete"]);
    await expect(reverseContractPayment("pay1", "   ")).rejects.toThrow();
  });
});

/* ── The separations that matter ────────────────────────────────────────── */

describe("maker–checker: editing is not authorising", () => {
  it("contracts.edit alone cannot approve an amendment", async () => {
    h.user = u(["contracts.view", "contracts.edit", "contracts.create", "contracts.complete"]);
    await expect(approveAmendment("am1")).rejects.toThrow("FORBIDDEN");
    await expect(rejectAmendment("am1", "no")).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.contractAmendment.findFirst).not.toHaveBeenCalled();
  });

  it("proposing only needs contracts.edit", async () => {
    h.user = u(["contracts.view", "contracts.edit"]);
    h.prisma.contractAmendment.count.mockResolvedValue(0);
    await expect(
      proposeAmendment({
        contractId: CONTRACT,
        type: "VARIATION",
        revisedAmountPaise: 650_000_000,
        reason: "Extra staircase",
        effectiveDate: "2026-06-01",
      }),
    ).resolves.toBeDefined();
  });

  it("contracts.complete alone cannot cancel an agreement", async () => {
    h.user = u(["contracts.view", "contracts.edit", "contracts.complete"]);
    await expect(cancelContract(CONTRACT, "client terminated")).rejects.toThrow("FORBIDDEN");
  });

  it("setContractStatus refuses CANCELLED — cancelling is its own authority", async () => {
    h.user = OWNER;
    await expect(setContractStatus(CONTRACT, "CANCELLED")).rejects.toThrow("USE_CANCEL");
  });
});

describe("the agreement value only moves through an approved amendment", () => {
  it("updateContract refuses an amount outright", async () => {
    h.user = OWNER;
    await expect(
      updateContract(CONTRACT, { title: "x", contractAmountPaise: 700_000_000 }),
    ).rejects.toThrow("USE_AMENDMENT");
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("a stale amendment is refused rather than compounded", async () => {
    h.user = OWNER;
    h.prisma.contractAmendment.findFirst.mockResolvedValue({
      id: "am1",
      contractId: CONTRACT,
      status: "PROPOSED",
      previousAmountPaise: BigInt(600_000_000),
      revisedAmountPaise: BigInt(650_000_000),
      deltaPaise: BigInt(50_000_000),
    });
    // Another amendment already moved the value to ₹65,00,000.
    h.prisma.contractorContract.findFirstOrThrow.mockResolvedValue({
      currentAmountPaise: BigInt(650_000_000),
      title: "Structure",
    });
    await expect(approveAmendment("am1")).rejects.toThrow("AMENDMENT_STALE");
  });

  it("an already-decided amendment cannot be approved again", async () => {
    h.user = OWNER;
    h.prisma.contractAmendment.findFirst.mockResolvedValue({
      id: "am1",
      contractId: CONTRACT,
      status: "APPROVED",
      previousAmountPaise: BigInt(600_000_000),
      revisedAmountPaise: BigInt(650_000_000),
      deltaPaise: BigInt(50_000_000),
    });
    await expect(approveAmendment("am1")).rejects.toThrow("AMENDMENT_NOT_PROPOSED");
  });
});

describe("the credit ceiling has no override", () => {
  it("refuses a payment that would exceed the authorised value", async () => {
    h.user = OWNER;
    h.prisma.contractorContract.findFirstOrThrow.mockResolvedValue(
      agreementRow({
        payments: [
          {
            id: "p1",
            date: new Date("2026-02-01"),
            amountPaise: BigInt(590_000_000), // ₹59,00,000 credited
            type: "INTERIM",
            deletedAt: null,
            milestone: null,
            createdBy: null,
          },
        ],
      }),
    );
    await expect(recordContractPayment({ ...newPayment, amountPaise: 20_000_000 })).rejects.toThrow(
      "CREDIT_EXCEEDS_CONTRACT_VALUE",
    );
  });

  it("an Owner holding every permission is bound by it too", async () => {
    h.user = OWNER;
    h.prisma.contractorContract.findFirstOrThrow.mockResolvedValue(
      agreementRow({
        payments: [
          {
            id: "p1",
            date: new Date("2026-02-01"),
            amountPaise: BigInt(600_000_000),
            type: "INTERIM",
            deletedAt: null,
            milestone: null,
            createdBy: null,
          },
        ],
      }),
    );
    await expect(recordContractPayment({ ...newPayment, amountPaise: 100 })).rejects.toThrow(
      "CREDIT_EXCEEDS_CONTRACT_VALUE",
    );
  });
});

describe("deletion governance", () => {
  // Each trigger blocks deletion INDEPENDENTLY — any one is enough.
  const NONE = { payments: 0, milestones: 0, attendance: 0, amendments: 0 };
  it.each([
    ["a live payment", { ...NONE, payments: 1 }],
    ["a completed milestone", { ...NONE, milestones: 1 }],
    ["attributed attendance", { ...NONE, attendance: 1 }],
    ["an approved amendment", { ...NONE, amendments: 1 }],
  ])("refuses deletion when the agreement has %s", async (_label, counts) => {
    h.user = OWNER;
    h.prisma.contractorContractPayment.count.mockResolvedValue(counts.payments);
    h.prisma.contractMilestone.count.mockResolvedValue(counts.milestones);
    h.prisma.labourAttendance.count.mockResolvedValue(counts.attendance);
    h.prisma.contractAmendment.count.mockResolvedValue(counts.amendments);

    await expect(deleteContract(CONTRACT)).rejects.toThrow("HAS_FINANCIAL_HISTORY");
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("deletes a pristine agreement", async () => {
    h.user = OWNER;
    await expect(deleteContract(CONTRACT)).resolves.toBeUndefined();
    expect(h.prisma.contractorContract.update).toHaveBeenCalled();
  });

  it("removeScopeItem refuses once attendance references it", async () => {
    h.user = OWNER;
    h.prisma.contractScopeItem.findFirst.mockResolvedValue({
      id: "si1",
      contractId: CONTRACT,
      projectId: "p1",
      labourSubcategoryId: SUB,
      currentRatePaise: 90_000,
      rateUnit: "day",
      notes: null,
      createdAt: new Date(),
      subcategory: { name: "Mason", categoryId: "cat1", category: { name: "Masonry" } },
      contract: { title: "Structure" },
    });
    h.prisma.labourAttendance.count.mockResolvedValue(3);
    await expect(removeScopeItem("si1")).rejects.toThrow("SCOPE_IN_USE");
  });

  it("deleteMilestone refuses once the milestone has progressed", async () => {
    h.user = OWNER;
    h.prisma.contractMilestone.findFirst.mockResolvedValue({
      id: "m1",
      contractId: CONTRACT,
      title: "Slab 1",
      status: "COMPLETED",
    });
    await expect(deleteMilestone("m1")).rejects.toThrow("MILESTONE_HAS_HISTORY");
  });
});

describe("milestone completion respects the earned-value ceiling", () => {
  it("refuses when cumulative earned would exceed the authorised value", async () => {
    h.user = OWNER;
    h.prisma.contractMilestone.findFirst.mockResolvedValue({
      id: "m6",
      contractId: CONTRACT,
      title: "Slab 6",
      status: "NOT_STARTED",
      valuePaise: BigInt(110_000_000), // ₹11,00,000
    });
    h.prisma.contractorContractPayment.aggregate.mockResolvedValue({ _sum: { amountPaise: null } });
    h.prisma.contractorContract.findFirstOrThrow.mockResolvedValue({
      currentAmountPaise: BigInt(600_000_000),
      milestones: Array.from({ length: 5 }, (_, i) => ({
        id: `m${i + 1}`,
        status: "COMPLETED",
        valuePaise: BigInt(110_000_000),
      })),
    });
    await expect(setMilestoneStatus("m6", "COMPLETED")).rejects.toThrow(
      "EARNED_VALUE_EXCEEDS_CONTRACT",
    );
  });

  it("refuses to cancel a milestone with payments booked against it", async () => {
    h.user = OWNER;
    h.prisma.contractMilestone.findFirst.mockResolvedValue({
      id: "m1",
      contractId: CONTRACT,
      title: "Slab 1",
      status: "IN_PROGRESS",
      valuePaise: BigInt(100_000_000),
    });
    h.prisma.contractorContractPayment.aggregate.mockResolvedValue({
      _sum: { amountPaise: BigInt(20_000_000) },
    });
    await expect(setMilestoneStatus("m1", "CANCELLED", { reason: "descoped" })).rejects.toThrow(
      "MILESTONE_HAS_PAYMENTS",
    );
  });

  it("requires a reason to cancel a milestone", async () => {
    h.user = OWNER;
    h.prisma.contractMilestone.findFirst.mockResolvedValue({
      id: "m1",
      contractId: CONTRACT,
      title: "Slab 1",
      status: "IN_PROGRESS",
      valuePaise: BigInt(100_000_000),
    });
    await expect(setMilestoneStatus("m1", "CANCELLED")).rejects.toThrow("CANCEL_REASON_REQUIRED");
  });
});

/* ── Project scoping ────────────────────────────────────────────────────── */

describe("listContracts — project scope", () => {
  it("scopes a PM without projects.view_all to their own projects", async () => {
    h.user = u(["contracts.view"]);
    await listContracts();
    const where = h.prisma.contractorContract.findMany.mock.calls[0][0].where;
    expect(where.project).toEqual({ pmId: "pm1", deletedAt: null });
  });

  it("projects.view_all widens the scope but still excludes deleted projects", async () => {
    h.user = u(["contracts.view", "projects.view_all"]);
    await listContracts();
    const where = h.prisma.contractorContract.findMany.mock.calls[0][0].where;
    expect(where.project).toEqual({ deletedAt: null });
  });
});
