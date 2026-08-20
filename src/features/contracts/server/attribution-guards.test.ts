/**
 * Server enforcement for settled-attribution correction.
 *
 * This operation changes RECOGNISED financial credit on a closed settlement, so
 * every test here is written from the position that the request was forged: the
 * UI's row list and agreement selector are conveniences, and the server proves
 * company, contractor, project, settlement state and agreement lifecycle for
 * itself, under a lock, immediately before writing.
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
const ROW = "44444444-4444-4444-8444-444444444444";

const h = vi.hoisted(() => ({
  user: null as SessionUser | null,
  prisma: {
    contractorContract: { findFirst: vi.fn() },
    labourAttendance: { findMany: vi.fn(), updateMany: vi.fn() },
    activityLog: { findFirst: vi.fn(), create: vi.fn() },
    project: { findFirst: vi.fn() },
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

import { attributeSettledLabour, listAttributableLabour, reverseAttribution } from "./attribution";

/** An eligible source row: settled, unattributed, settlement not reversed. */
const sourceRow = (over: Record<string, unknown> = {}) => ({
  id: ROW,
  date: new Date("2026-06-15"),
  labourSubcategoryId: "sub-mason",
  quantityPresent: 4,
  dailyRatePaiseSnapshot: 90_000,
  estimatedCostPaise: 360_000,
  contractId: null,
  settlementId: "s1",
  subcategory: { name: "Mason" },
  // periodStart/End are only read by the LIST query's mapper; harmless here.
  settlement: {
    reversedAt: null,
    periodStart: new Date("2026-06-15"),
    periodEnd: new Date("2026-06-15"),
  },
  ...over,
});

const agreementRow = (status = "IN_PROGRESS") => ({
  id: STRUCTURE,
  companyId: "c1",
  contractorId: PAPPU,
  projectId: SKY,
  title: "Structure",
  status,
  originalAmountPaise: BigInt(60_000_000),
  deletedAt: null,
  contractor: { name: "Pappu Contractor" },
  project: { name: "Skyline Residency" },
  amendments: [],
  milestones: [],
  payments: [],
  attendance: [],
});

const apply = (over: Record<string, unknown> = {}) =>
  attributeSettledLabour({
    contractorId: PAPPU,
    projectId: SKY,
    contractId: STRUCTURE,
    attendanceIds: [ROW],
    reason: "Labour belonged to this agreement",
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
  h.prisma.project.findFirst.mockResolvedValue({ id: SKY });
  h.prisma.contractorContract.findFirst.mockResolvedValue(agreementRow());
  // Source rows, then target identities (empty = no collision).
  h.prisma.labourAttendance.findMany.mockImplementation(async (args: { where?: Record<string, unknown> }) => {
    if (args?.where && "contractId" in args.where && args.where.contractId === STRUCTURE) return [];
    return [sourceRow()];
  });
  h.prisma.labourAttendance.updateMany.mockResolvedValue({ count: 1 });
  h.prisma.activityLog.create.mockResolvedValue({ id: "log-1" });
  h.prisma.activityLog.findFirst.mockResolvedValue(null);
});

/* ── Permission ─────────────────────────────────────────────────────────── */

describe("who may correct settled attribution", () => {
  it("requires contractors.attribute_history", async () => {
    h.user = u(["contracts.view", "contracts.edit"]);
    await expect(apply()).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.labourAttendance.updateMany).not.toHaveBeenCalled();
  });

  it("is granted by that permission alone", async () => {
    h.user = u(["contractors.attribute_history"]);
    const res = await apply();
    expect("blockers" in res).toBe(false);
    expect(h.prisma.labourAttendance.updateMany).toHaveBeenCalled();
  });

  it("works for Owner through the wildcard", async () => {
    h.user = OWNER;
    await apply();
    expect(h.prisma.labourAttendance.updateMany).toHaveBeenCalled();
  });

  it("lets a plain viewer READ the attributable list", async () => {
    // The amount and explanation stay visible to anyone who can see the
    // agreement; only the correction itself is gated.
    h.user = u(["contracts.view"]);
    await expect(listAttributableLabour(PAPPU, SKY)).resolves.toBeDefined();
  });

  it("refuses an unauthenticated caller", async () => {
    h.user = null;
    await expect(apply()).rejects.toThrow("UNAUTHENTICATED");
  });
});

/* ── Forged targets ─────────────────────────────────────────────────────── */

describe("a forged target", () => {
  it("is refused when the agreement is not this contractor's on this project", async () => {
    h.prisma.contractorContract.findFirst.mockResolvedValue(null);
    expect(await apply()).toMatchObject({ blockers: ["INVALID_TARGET"] });
    expect(h.prisma.labourAttendance.updateMany).not.toHaveBeenCalled();
  });

  it("scopes the agreement lookup on company, contractor and not-deleted", async () => {
    await apply();
    expect(h.prisma.contractorContract.findFirst.mock.calls[0][0].where).toMatchObject({
      id: STRUCTURE,
      companyId: "c1",
      contractorId: PAPPU,
      deletedAt: null,
    });
  });

  it("is refused when the agreement is on another project", async () => {
    h.prisma.contractorContract.findFirst.mockResolvedValue({
      ...agreementRow(),
      projectId: "other-project",
    });
    expect(await apply()).toMatchObject({ blockers: ["INVALID_TARGET"] });
  });

  it("is refused when the caller cannot reach the project", async () => {
    h.prisma.project.findFirst.mockResolvedValue(null);
    await expect(apply()).rejects.toThrow("FORBIDDEN");
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
});

/* ── Target lifecycle ───────────────────────────────────────────────────── */

describe("target agreement status", () => {
  for (const status of ["NOT_STARTED", "IN_PROGRESS", "ON_HOLD", "COMPLETED"]) {
    it(`${status} accepts historical attribution`, async () => {
      h.prisma.contractorContract.findFirst.mockResolvedValue(agreementRow(status));
      const res = await apply();
      expect("blockers" in res).toBe(false);
    });
  }

  it("SETTLED refuses — it would contradict the close-out", async () => {
    h.prisma.contractorContract.findFirst.mockResolvedValue(agreementRow("SETTLED"));
    expect(await apply()).toMatchObject({ blockers: ["TARGET_AGREEMENT_SETTLED"] });
    expect(h.prisma.labourAttendance.updateMany).not.toHaveBeenCalled();
  });

  it("CANCELLED refuses — a void agreement is credited nothing", async () => {
    h.prisma.contractorContract.findFirst.mockResolvedValue(agreementRow("CANCELLED"));
    expect(await apply()).toMatchObject({ blockers: ["TARGET_AGREEMENT_CANCELLED"] });
  });

  it("re-reads the status INSIDE the transaction, not just at preview time", async () => {
    await apply();
    // One read outside for the snapshot, one inside under the lock.
    expect(h.prisma.contractorContract.findFirst.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

/* ── Source rows ────────────────────────────────────────────────────────── */

describe("source row eligibility, re-checked under the lock", () => {
  it("locks the rows before deciding anything", async () => {
    await apply();
    expect(h.prisma.$queryRaw).toHaveBeenCalled();
    const sql = String(h.prisma.$queryRaw.mock.calls[0][0]);
    expect(sql).toMatch(/FOR UPDATE/);
  });

  it("refuses an unsettled row", async () => {
    h.prisma.labourAttendance.findMany.mockImplementation(async (args: { where?: Record<string, unknown> }) =>
      args?.where && args.where.contractId === STRUCTURE ? [] : [sourceRow({ settlementId: null })],
    );
    expect(await apply()).toMatchObject({ blockers: ["ROW_NOT_SETTLED"] });
    expect(h.prisma.labourAttendance.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a row whose settlement has been reversed", async () => {
    h.prisma.labourAttendance.findMany.mockImplementation(async (args: { where?: Record<string, unknown> }) =>
      args?.where && args.where.contractId === STRUCTURE
        ? []
        : [sourceRow({ settlement: { reversedAt: new Date() } })],
    );
    expect(await apply()).toMatchObject({ blockers: ["ROW_SETTLEMENT_REVERSED"] });
  });

  it("refuses a row already attributed — v1 does not move A → B", async () => {
    h.prisma.labourAttendance.findMany.mockImplementation(async (args: { where?: Record<string, unknown> }) =>
      args?.where && args.where.contractId === STRUCTURE
        ? []
        : [sourceRow({ contractId: "ag-other" })],
    );
    expect(await apply()).toMatchObject({ blockers: ["ROW_ALREADY_ATTRIBUTED"] });
  });

  it("refuses when a named row is not returned — it belongs to someone else", async () => {
    h.prisma.labourAttendance.findMany.mockImplementation(async (args: { where?: Record<string, unknown> }) =>
      args?.where && args.where.contractId === STRUCTURE ? [] : [],
    );
    expect(await apply()).toMatchObject({ blockers: ["STALE_SELECTION"] });
  });

  it("scopes the row query on company, contractor AND project", async () => {
    await apply();
    const where = h.prisma.labourAttendance.findMany.mock.calls.find(
      (c) => c[0]?.where?.id,
    )![0].where;
    expect(where).toMatchObject({ companyId: "c1", contractorId: PAPPU, projectId: SKY });
  });
});

/* ── Collision ──────────────────────────────────────────────────────────── */

describe("identity collision", () => {
  it("refuses instead of merging, and writes nothing", async () => {
    h.prisma.labourAttendance.findMany.mockImplementation(async (args: { where?: Record<string, unknown> }) =>
      args?.where && args.where.contractId === STRUCTURE
        ? [{ date: new Date("2026-06-15"), labourSubcategoryId: "sub-mason" }]
        : [sourceRow()],
    );
    const res = await apply();
    expect("blockers" in res && res.blockers).toContain("IDENTITY_COLLISION");
    expect(h.prisma.labourAttendance.updateMany).not.toHaveBeenCalled();
    expect(h.prisma.activityLog.create).not.toHaveBeenCalled();
  });

  it("names the clash so the user can find it", async () => {
    h.prisma.labourAttendance.findMany.mockImplementation(async (args: { where?: Record<string, unknown> }) =>
      args?.where && args.where.contractId === STRUCTURE
        ? [{ date: new Date("2026-06-15"), labourSubcategoryId: "sub-mason" }]
        : [sourceRow()],
    );
    const res = await apply();
    expect("collisions" in res && res.collisions?.[0]).toMatchObject({
      date: "2026-06-15",
      labourTypeName: "Mason",
    });
  });
});

/* ── The write ──────────────────────────────────────────────────────────── */

describe("what a correction writes", () => {
  it("changes ONLY contract_id", async () => {
    await apply();
    const call = h.prisma.labourAttendance.updateMany.mock.calls[0][0];
    expect(call.data).toEqual({ contractId: STRUCTURE });
    expect(call.where).toMatchObject({ companyId: "c1" });
  });

  it("writes one audit entry, in the same transaction, with full provenance", async () => {
    await apply();
    expect(h.prisma.activityLog.create).toHaveBeenCalledTimes(1);
    const data = h.prisma.activityLog.create.mock.calls[0][0].data;
    expect(data.action).toBe("contractor.attendance_attributed");
    expect(data.meta).toMatchObject({
      projectId: SKY,
      contractorId: PAPPU,
      attendanceIds: [ROW],
      settlementIds: ["s1"],
      fromContractId: null,
      toContractId: STRUCTURE,
      rowCount: 1,
      totalPaise: 360_000,
      reason: "Labour belonged to this agreement",
    });
  });

  it("refuses an empty selection and a blank reason before touching the DB", async () => {
    expect(await apply({ attendanceIds: [] })).toMatchObject({ blockers: ["NOTHING_SELECTED"] });
    expect(await apply({ reason: "  " })).toMatchObject({ blockers: ["REASON_REQUIRED"] });
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });
});

/* ── Reversal ───────────────────────────────────────────────────────────── */

describe("reversing a correction", () => {
  const original = {
    id: "log-1",
    entityId: PAPPU,
    meta: {
      attendanceIds: [ROW],
      projectId: SKY,
      toContractId: STRUCTURE,
      toContractTitle: "Structure",
      totalPaise: 360_000,
    },
  };

  beforeEach(() => {
    h.prisma.activityLog.findFirst.mockImplementation(async (args: { where?: Record<string, unknown> }) =>
      args?.where?.action === "contractor.attendance_attributed" ? original : null,
    );
    h.prisma.labourAttendance.findMany.mockResolvedValue([
      {
        id: ROW,
        contractId: STRUCTURE,
        settlementId: "s1",
        estimatedCostPaise: 360_000,
        settlement: { reversedAt: null },
      },
    ]);
    h.prisma.activityLog.create.mockResolvedValue({ id: "log-2" });
  });

  it("sets contract_id back to NULL for exactly the recorded rows", async () => {
    const res = await reverseAttribution({ correctionId: "log-1", reason: "Wrong agreement" });
    expect("blockers" in res).toBe(false);
    const call = h.prisma.labourAttendance.updateMany.mock.calls[0][0];
    expect(call.data).toEqual({ contractId: null });
    expect(call.where.id).toEqual({ in: [ROW] });
  });

  it("logs a reversal citing the original correction", async () => {
    await reverseAttribution({ correctionId: "log-1", reason: "Wrong agreement" });
    const data = h.prisma.activityLog.create.mock.calls[0][0].data;
    expect(data.action).toBe("contractor.attendance_attribution_reversed");
    expect(data.meta).toMatchObject({ correctionId: "log-1", fromContractId: STRUCTURE });
  });

  it("refuses an unknown correction", async () => {
    h.prisma.activityLog.findFirst.mockResolvedValue(null);
    expect(await reverseAttribution({ correctionId: "nope", reason: "x" })).toMatchObject({
      blockers: ["NOT_FOUND"],
    });
  });

  it("refuses a second reversal", async () => {
    h.prisma.activityLog.findFirst.mockImplementation(async (args: { where?: Record<string, unknown> }) =>
      args?.where?.action === "contractor.attendance_attributed" ? original : { id: "log-2" },
    );
    expect(await reverseAttribution({ correctionId: "log-1", reason: "x" })).toMatchObject({
      blockers: ["ALREADY_REVERSED"],
    });
  });

  it("refuses when the rows no longer match the correction", async () => {
    h.prisma.labourAttendance.findMany.mockResolvedValue([
      { id: ROW, contractId: "ag-elsewhere", settlementId: "s1", estimatedCostPaise: 1, settlement: { reversedAt: null } },
    ]);
    expect(await reverseAttribution({ correctionId: "log-1", reason: "x" })).toMatchObject({
      blockers: ["STALE_SELECTION"],
    });
    expect(h.prisma.labourAttendance.updateMany).not.toHaveBeenCalled();
  });

  it("locks the rows before restoring them", async () => {
    await reverseAttribution({ correctionId: "log-1", reason: "x" });
    expect(String(h.prisma.$queryRaw.mock.calls[0][0])).toMatch(/FOR UPDATE/);
  });

  it("needs the same permission as the forward correction", async () => {
    h.user = u(["contracts.edit"]);
    await expect(reverseAttribution({ correctionId: "log-1", reason: "x" })).rejects.toThrow(
      "FORBIDDEN",
    );
  });
});
