/**
 * The archived-contractor attendance boundary (Pass 5.1).
 *
 * Archiving a contractor used to stop new agreements, advances, settlements and
 * project assignments — but NOT attendance. That was inconsistent in both
 * directions at once, and the two halves compounded:
 *
 *   • Labour could still be booked against a contractor the company had
 *     finished with — the single largest way a liability accrues.
 *   • That freshly-booked labour could then never be settled, because
 *     settlement WAS blocked.
 *
 * So the fix is symmetric, and both halves are pinned here and in
 * ../../contractors/server/lifecycle-enforcement.test.ts:
 *
 *   NEW attendance stops at archive. CLOSING OUT and CORRECTING what is
 *   already recorded does not.
 *
 * The line is "does a row already exist at this five-field identity?", not a
 * date — `status` is the whole lifecycle model, with no `archivedAt` column.
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
    labourAttendance: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    contractor: { findFirst: vi.fn(), findMany: vi.fn() },
    projectContractor: { findMany: vi.fn() },
    projectContractorLabourRate: { findFirst: vi.fn() },
    contractorContract: { findMany: vi.fn() },
    contractScopeItem: { findFirst: vi.fn() },
    contractScopeRateRevision: { findMany: vi.fn() },
    labourSubcategory: { findFirst: vi.fn() },
    project: { findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/auth/current-user", () => ({
  requireUser: async () => {
    if (!h.user) throw new Error("UNAUTHENTICATED");
    return h.user;
  },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: h.prisma }));

import { setQuantity, getSheet, copyPreviousDay } from "./actions";

const PROJECT = "p1";
const SUB = "sub-mason";
const CONTRACTOR = "pappu";
/** Before archiving. */
const WORKED = "2026-08-17";
/** After archiving — the day the trap used to open. */
const LATER = "2026-08-20";

const ARCHIVED = { name: "Pappu Contractor", status: "INACTIVE" };
const ACTIVE = { name: "Pappu Contractor", status: "ACTIVE" };

const mark = (date: string, quantity: number) =>
  setQuantity({ projectId: PROJECT, date, subcategoryId: SUB, quantity, contractorId: CONTRACTOR });

beforeEach(() => {
  h.user = OWNER;
  Object.values(h.prisma).forEach((m) =>
    Object.values(m).forEach((f) => (f as ReturnType<typeof vi.fn>).mockReset()),
  );
  h.prisma.project.findFirst.mockResolvedValue({ id: PROJECT });
  h.prisma.labourAttendance.findMany.mockResolvedValue([]);
  h.prisma.labourAttendance.findFirst.mockResolvedValue(null);
  h.prisma.labourAttendance.deleteMany.mockResolvedValue({ count: 1 });
  h.prisma.projectContractor.findMany.mockResolvedValue([]);
  h.prisma.contractorContract.findMany.mockResolvedValue([]);
  h.prisma.projectContractorLabourRate.findFirst.mockResolvedValue({
    id: "pclr1",
    ratePaise: 90_000,
  });
  h.prisma.labourSubcategory.findFirst.mockResolvedValue({ dailyRatePaise: 90_000 });
  h.prisma.contractor.findFirst.mockResolvedValue(ACTIVE);
  h.prisma.contractor.findMany.mockResolvedValue([]);
});

/* ── New attendance ─────────────────────────────────────────────────────── */

describe("recording NEW attendance", () => {
  it("an ACTIVE contractor takes it", async () => {
    await mark(LATER, 5);
    expect(h.prisma.labourAttendance.create).toHaveBeenCalled();
  });

  it("an ARCHIVED contractor does NOT — nothing is written", async () => {
    h.prisma.contractor.findFirst.mockResolvedValue(ARCHIVED);
    await expect(mark(LATER, 5)).rejects.toThrow("CONTRACTOR_ARCHIVED");
    expect(h.prisma.labourAttendance.create).not.toHaveBeenCalled();
    expect(h.prisma.labourAttendance.update).not.toHaveBeenCalled();
  });

  it("names the contractor and the way out, rather than a bare code", async () => {
    h.prisma.contractor.findFirst.mockResolvedValue(ARCHIVED);
    await expect(mark(LATER, 5)).rejects.toThrow(/Pappu Contractor is archived/);
    await expect(mark(LATER, 5)).rejects.toThrow(/Restore them first/);
  });

  it("RESTORING makes it available again — status is the only switch", async () => {
    h.prisma.contractor.findFirst.mockResolvedValue(ARCHIVED);
    await expect(mark(LATER, 5)).rejects.toThrow("CONTRACTOR_ARCHIVED");

    h.prisma.contractor.findFirst.mockResolvedValue(ACTIVE);
  h.prisma.contractor.findMany.mockResolvedValue([]);
    await mark(LATER, 5);
    expect(h.prisma.labourAttendance.create).toHaveBeenCalledTimes(1);
  });

  it("leaves UNATTRIBUTED rows alone — they have no lifecycle to consult", async () => {
    h.prisma.contractor.findFirst.mockResolvedValue(ARCHIVED);
    await setQuantity({ projectId: PROJECT, date: LATER, subcategoryId: SUB, quantity: 4 });
    expect(h.prisma.labourAttendance.create).toHaveBeenCalled();
    expect(h.prisma.contractor.findFirst).not.toHaveBeenCalled();
  });
});

/* ── Correcting what is already recorded ────────────────────────────────── */

describe("correcting attendance recorded BEFORE archiving", () => {
  /** Both settled guards clear, then every identity lookup finds the row. */
  const rowExists = () => {
    h.prisma.labourAttendance.findFirst.mockResolvedValueOnce(null).mockResolvedValue({
      id: "att-17",
      dailyRatePaiseSnapshot: 90_000,
      projectContractorLabourRateId: "pclr1",
      contractScopeRateRevisionId: null,
    });
  };

  it("is still allowed while archived — a wrong headcount must not be frozen in", async () => {
    // Otherwise the only options are settling a figure known to be wrong, or
    // never settling at all. Both are worse than allowing the fix.
    h.prisma.contractor.findFirst.mockResolvedValue(ARCHIVED);
    rowExists();
    await mark(WORKED, 6);
    expect(h.prisma.labourAttendance.update).toHaveBeenCalled();
  });

  it("keeps the original rate snapshot — archiving reprices nothing (ADR-0022)", async () => {
    h.prisma.contractor.findFirst.mockResolvedValue(ARCHIVED);
    rowExists();
    await mark(WORKED, 6);
    const data = h.prisma.labourAttendance.update.mock.calls[0][0].data;
    expect(data.estimatedCostPaise).toBe(90_000 * 6);
    expect(h.prisma.contractScopeRateRevision.findMany).not.toHaveBeenCalled();
  });

  it("CLEARING a mistaken row stays allowed while archived", async () => {
    h.prisma.contractor.findFirst.mockResolvedValue(ARCHIVED);
    await setQuantity({
      projectId: PROJECT,
      date: WORKED,
      subcategoryId: SUB,
      quantity: 0,
      contractorId: CONTRACTOR,
    });
    expect(h.prisma.labourAttendance.deleteMany).toHaveBeenCalled();
  });

  it("does not weaken the SETTLED rule — that guard still runs first", async () => {
    h.prisma.contractor.findFirst.mockResolvedValue(ARCHIVED);
    h.prisma.labourAttendance.findFirst.mockResolvedValueOnce({ id: "att-settled" });
    await expect(mark(WORKED, 6)).rejects.toThrow("ATTENDANCE_SETTLED");
    expect(h.prisma.labourAttendance.update).not.toHaveBeenCalled();
  });
});

/* ── Copy yesterday ─────────────────────────────────────────────────────── */

/**
 * The other way a row gets created. It must not become a side door into new
 * attendance for an archived contractor — and equally must not blow up the whole
 * day's copy because one crew was archived.
 */
describe("copying yesterday forward", () => {
  const yesterdayRow = (contractorId: string | null) => ({
    id: "y1",
    labourSubcategoryId: SUB,
    quantityPresent: 5,
    notes: null,
    contractorId,
    contractId: null,
  });

  beforeEach(() => {
    h.prisma.labourAttendance.findFirst.mockResolvedValueOnce({ date: new Date(WORKED) });
  });

  it("SKIPS an archived contractor's rows instead of copying them", async () => {
    h.prisma.contractor.findMany.mockResolvedValue([{ id: CONTRACTOR, status: "INACTIVE" }]);
    h.prisma.labourAttendance.findMany.mockResolvedValueOnce([yesterdayRow(CONTRACTOR)]);
    await copyPreviousDay(PROJECT, LATER);
    expect(h.prisma.labourAttendance.create).not.toHaveBeenCalled();
  });

  it("still copies everyone else — one archived crew does not abort the day", async () => {
    h.prisma.contractor.findMany.mockResolvedValue([
      { id: CONTRACTOR, status: "INACTIVE" },
      { id: "ramesh", status: "ACTIVE" },
    ]);
    h.prisma.labourAttendance.findMany.mockResolvedValueOnce([
      yesterdayRow(CONTRACTOR),
      yesterdayRow("ramesh"),
    ]);
    await copyPreviousDay(PROJECT, LATER);
    expect(h.prisma.labourAttendance.create).toHaveBeenCalledTimes(1);
    expect(h.prisma.labourAttendance.create.mock.calls[0][0].data.contractorId).toBe("ramesh");
  });
});

/* ── The sheet ──────────────────────────────────────────────────────────── */

describe("the attendance sheet for an archived contractor", () => {
  const pcRow = (status: string) => ({
    contractorId: CONTRACTOR,
    contractor: { name: "Pappu Contractor", status },
    contractRatePaise: null,
    contractRateUnit: null,
    labourRates: [
      {
        labourSubcategoryId: SUB,
        ratePaise: 90_000,
        subcategory: {
          name: "Mason",
          categoryId: "cat-m",
          displayOrder: 0,
          category: { name: "Mason" },
        },
      },
    ],
  });
  const recorded = {
    contractorId: CONTRACTOR,
    labourSubcategoryId: SUB,
    contractId: null,
    quantityPresent: 8,
    dailyRatePaiseSnapshot: 90_000,
    estimatedCostPaise: 720_000,
    notes: null,
    subcategory: { name: "Mason", categoryId: "cat-m", category: { name: "Mason" } },
    contractor: { name: "Pappu Contractor" },
    contract: null,
  };

  it("offers NO blank row — the server would refuse the write anyway", async () => {
    h.prisma.projectContractor.findMany.mockResolvedValue([pcRow("INACTIVE")]);
    const sheet = await getSheet(PROJECT, LATER);
    expect(sheet.groups[0].archived).toBe(true);
    expect(sheet.groups[0].rows).toEqual([]);
  });

  it("still offers the blank row while ACTIVE", async () => {
    h.prisma.projectContractor.findMany.mockResolvedValue([pcRow("ACTIVE")]);
    const sheet = await getSheet(PROJECT, LATER);
    expect(sheet.groups[0].archived).toBe(false);
    expect(sheet.groups[0].rows).toHaveLength(1);
  });

  it("KEEPS history visible — an already-recorded row survives archiving", async () => {
    h.prisma.projectContractor.findMany.mockResolvedValue([pcRow("INACTIVE")]);
    h.prisma.labourAttendance.findMany.mockResolvedValue([recorded]);
    const sheet = await getSheet(PROJECT, WORKED);
    expect(sheet.groups[0].rows).toHaveLength(1);
    expect(sheet.groups[0].rows[0].quantity).toBe(8);
    // Not demoted to an "orphan" group — it is still their configured labour.
    expect(sheet.groups[0].configured).toBe(true);
    expect(sheet.groups).toHaveLength(1);
  });

  it("leaves the recorded VALUE untouched — archiving is not a financial act", async () => {
    h.prisma.projectContractor.findMany.mockResolvedValue([pcRow("INACTIVE")]);
    h.prisma.labourAttendance.findMany.mockResolvedValue([recorded]);
    const archivedSheet = await getSheet(PROJECT, WORKED);

    h.prisma.projectContractor.findMany.mockResolvedValue([pcRow("ACTIVE")]);
    const activeSheet = await getSheet(PROJECT, WORKED);

    expect(archivedSheet.estimatedCostPaise).toBe(activeSheet.estimatedCostPaise);
    expect(archivedSheet.totalPresent).toBe(activeSheet.totalPresent);
    expect(archivedSheet.estimatedCostPaise).toBe(720_000);
  });
});
