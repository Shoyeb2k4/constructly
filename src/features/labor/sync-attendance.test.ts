/**
 * The offline path, /api/sync.
 *
 * A queued attendance mutation can arrive minutes or days after the work
 * happened, from a device that never saw the config change. Two things must
 * hold: the agreement travels with the mutation and is part of the identity it
 * writes to, and an attribution that has since become invalid degrades rather
 * than turning the mutation into a poison message that never syncs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/auth/types";
import { labourAttendanceMutationSchema } from "./schema";

const h = vi.hoisted(() => ({
  user: null as SessionUser | null,
  prisma: {
    project: { findFirst: vi.fn() },
    // The archived-contractor guard on the offline path reads the status.
    contractor: { findFirst: vi.fn() },
    labourAttendance: {
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
  eligibility: {
    isAttributionEligible: vi.fn(),
    isAgreementAttributionEligible: vi.fn(),
    resolveAttendanceRate: vi.fn(),
  },
  rateLimit: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({ prisma: h.prisma }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => h.user }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: h.rateLimit }));
vi.mock("@/lib/logger", () => ({ reportError: vi.fn() }));
vi.mock("@/features/labor/server/assignment-eligibility", () => h.eligibility);

import { POST } from "@/app/api/sync/route";

const USER: SessionUser = {
  id: "u1",
  email: "u@x.com",
  fullName: "U",
  role: "OWNER",
  permissions: [],
  company: { id: "c1", name: "Co" },
};

const PROJECT = "11111111-1111-4111-8111-111111111111";
const SUB = "22222222-2222-4222-9222-222222222222";
const CONTRACTOR = "33333333-3333-4333-8333-333333333333";
const STRUCTURE = "44444444-4444-4444-8444-444444444444";
const WALL = "55555555-5555-4555-8555-555555555555";
const DATE = "2026-06-15";

beforeEach(() => {
  h.user = USER;
  h.rateLimit.mockReturnValue({ ok: true });
  Object.values(h.prisma).forEach((m) =>
    Object.values(m).forEach((f) => (f as ReturnType<typeof vi.fn>).mockReset()),
  );
  Object.values(h.eligibility).forEach((f) => f.mockReset());
  h.prisma.project.findFirst.mockResolvedValue({ id: PROJECT });
  h.prisma.contractor.findFirst.mockResolvedValue({ status: "ACTIVE" });
  h.prisma.labourAttendance.findFirst.mockResolvedValue(null);
  h.prisma.labourAttendance.deleteMany.mockResolvedValue({ count: 0 });
  h.eligibility.isAttributionEligible.mockResolvedValue(true);
  h.eligibility.isAgreementAttributionEligible.mockResolvedValue(true);
  h.eligibility.resolveAttendanceRate.mockResolvedValue({
    ratePaise: 90_000,
    projectContractorLabourRateId: null,
    contractScopeRateRevisionId: "rev1",
  });
});

/** Post one labour_attendance mutation through the real route handler. */
async function sync(payload: Record<string, unknown>, clientUuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa") {
  const req = new Request("http://localhost/api/sync", {
    method: "POST",
    body: JSON.stringify({
      mutations: [{ clientUuid, clientSeq: 1, entity: "labour_attendance", op: "upsert", payload }],
    }),
  });
  return (await POST(req)).json();
}

const base = {
  projectId: PROJECT,
  date: DATE,
  labourSubcategoryId: SUB,
  quantityPresent: 6,
  contractorId: CONTRACTOR,
};

describe("the outbox payload carries the agreement", () => {
  it("accepts contractId, and accepts its absence (attendance-only)", () => {
    expect(() =>
      labourAttendanceMutationSchema.parse({ ...base, contractId: STRUCTURE }),
    ).not.toThrow();
    expect(() => labourAttendanceMutationSchema.parse(base)).not.toThrow();
    expect(() =>
      labourAttendanceMutationSchema.parse({ ...base, contractId: null }),
    ).not.toThrow();
  });

  it("rejects a malformed agreement id rather than storing a dangling one", () => {
    expect(() =>
      labourAttendanceMutationSchema.parse({ ...base, contractId: "not-a-uuid" }),
    ).toThrow();
  });
});

describe("/api/sync writes the agreement into the row identity", () => {
  it("creates the row under its agreement, with the date-resolved rate", async () => {
    const res = await sync({ ...base, contractId: STRUCTURE });
    expect(res.applied).toHaveLength(1);

    const data = h.prisma.labourAttendance.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      projectId: PROJECT,
      contractorId: CONTRACTOR,
      contractId: STRUCTURE,
      dailyRatePaiseSnapshot: 90_000,
      contractScopeRateRevisionId: "rev1",
      estimatedCostPaise: 6 * 90_000,
    });
    // Resolved as at the ROW'S date — a mutation that syncs a week late must
    // still be valued at the rate in force when the work happened.
    expect(h.eligibility.resolveAttendanceRate).toHaveBeenCalledWith(
      "c1", PROJECT, CONTRACTOR, SUB, STRUCTURE, DATE,
    );
  });

  it("a delete targets only that agreement's row", async () => {
    await sync({ ...base, quantityPresent: 0, contractId: WALL });
    expect(h.prisma.labourAttendance.deleteMany.mock.calls[0][0].where).toMatchObject({
      companyId: "c1",
      projectId: PROJECT,
      labourSubcategoryId: SUB,
      contractorId: CONTRACTOR,
      contractId: WALL,
    });
  });

  it("looks the existing row up on the full identity, agreement included", async () => {
    await sync({ ...base, contractId: STRUCTURE });
    // Call 0 is the settled guard; call 1 is the row lookup.
    const lookup = h.prisma.labourAttendance.findFirst.mock.calls[1][0].where;
    expect(lookup.contractId).toBe(STRUCTURE);
  });
});

describe("degrading rather than poisoning the queue", () => {
  it("drops an agreement whose scope no longer covers the labour type", async () => {
    h.eligibility.isAgreementAttributionEligible.mockResolvedValue(false);
    const res = await sync({ ...base, contractId: STRUCTURE });

    // Applied, not retried forever — the attendance is the valuable part.
    expect(res.applied).toHaveLength(1);
    const data = h.prisma.labourAttendance.create.mock.calls[0][0].data;
    expect(data.contractId).toBeNull();
    expect(data.contractorId).toBe(CONTRACTOR); // the contractor survives
  });

  it("a valid agreement establishes the attribution on its own", async () => {
    // The agreement's scope says this contractor supplies this labour type here.
    // Requiring a project-contractor rate as well would drop the attribution for
    // any type priced only by the agreement — which is most of them.
    h.eligibility.isAttributionEligible.mockResolvedValue(false);
    h.eligibility.isAgreementAttributionEligible.mockResolvedValue(true);

    await sync({ ...base, contractId: STRUCTURE });
    const data = h.prisma.labourAttendance.create.mock.calls[0][0].data;
    expect(data.contractorId).toBe(CONTRACTOR);
    expect(data.contractId).toBe(STRUCTURE);
  });

  it("drops both when neither the agreement nor the project config holds", async () => {
    h.eligibility.isAttributionEligible.mockResolvedValue(false);
    h.eligibility.isAgreementAttributionEligible.mockResolvedValue(false);
    await sync({ ...base, contractId: STRUCTURE });
    const data = h.prisma.labourAttendance.create.mock.calls[0][0].data;
    expect(data.contractorId).toBeNull();
    expect(data.contractId).toBeNull();
  });

  it("never guesses an agreement for a mutation that carries none", async () => {
    await sync(base);
    expect(h.eligibility.isAgreementAttributionEligible).not.toHaveBeenCalled();
    expect(h.prisma.labourAttendance.create.mock.calls[0][0].data.contractId).toBeNull();
  });
});

describe("settled labour still refuses the offline path", () => {
  it("drops the mutation instead of corrupting a settled figure", async () => {
    h.prisma.labourAttendance.findFirst.mockResolvedValueOnce({ id: "att-settled" });
    const res = await sync({ ...base, contractId: STRUCTURE });

    expect(res.applied).toHaveLength(1); // acknowledged, so it leaves the outbox
    expect(h.prisma.labourAttendance.create).not.toHaveBeenCalled();
    expect(h.prisma.labourAttendance.update).not.toHaveBeenCalled();
    expect(h.prisma.labourAttendance.deleteMany).not.toHaveBeenCalled();
  });

  it("the settled check spans every agreement for that contractor and day", async () => {
    await sync({ ...base, contractId: WALL });
    const guard = h.prisma.labourAttendance.findFirst.mock.calls[0][0].where;
    expect(guard.settlementId).toEqual({ not: null });
    // Deliberately NOT scoped to one agreement: a day settled under another
    // would otherwise gain a second row and be counted twice.
    expect(guard.contractId).toBeUndefined();
  });
});
