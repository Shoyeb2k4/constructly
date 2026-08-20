/**
 * Project scoping for the unattributed-labour figure.
 *
 * Pass 5 settled the policy (Policy B): `contracts.view` / `projects.view_all`
 * decide whether a caller sees one project or all of them. The new attendance
 * position must obey the SAME rule, and obey it in the QUERY — a total computed
 * across every project and then trimmed in React would still have travelled to
 * the browser inside the serialized payload, which is a leak whatever the screen
 * shows.
 *
 * So these assert the WHERE clause, not the rendering.
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

const h = vi.hoisted(() => ({
  user: null as SessionUser | null,
  prisma: {
    contractor: { findFirst: vi.fn() },
    contractorContract: { findMany: vi.fn() },
    labourAttendance: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/auth/current-user", () => ({
  requireUser: async () => {
    if (!h.user) throw new Error("UNAUTHENTICATED");
    return h.user;
  },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: h.prisma }));

import { getContractorProfile } from "./reconciliation";

const att = (
  projectId: string,
  projectName: string,
  paise: number,
  opts: { settled?: boolean; contractId?: string | null } = {},
) => ({
  estimatedCostPaise: paise,
  settlementId: opts.settled ? "s1" : null,
  contractId: opts.contractId ?? null,
  projectId,
  project: { name: projectName },
});

beforeEach(() => {
  h.user = OWNER;
  Object.values(h.prisma).forEach((m) =>
    Object.values(m).forEach((f) => (f as ReturnType<typeof vi.fn>).mockReset()),
  );
  h.prisma.contractor.findFirst.mockResolvedValue({
    id: PAPPU,
    name: "Pappu Contractor",
    phone: null,
    status: "ACTIVE",
  });
  h.prisma.contractorContract.findMany.mockResolvedValue([]);
  h.prisma.labourAttendance.findMany.mockResolvedValue([]);
});

/** The `where` the attendance query actually ran with. */
const attendanceWhere = () => h.prisma.labourAttendance.findMany.mock.calls[0][0].where;

describe("the attendance query is scoped in SQL, not in React", () => {
  it("a project-scoped caller is limited to projects they manage", async () => {
    h.user = u(["contracts.view"]);
    await getContractorProfile(PAPPU);
    // Same filter the agreement query uses — the PM's own projects only.
    expect(attendanceWhere().project).toEqual({ pmId: "pm1", deletedAt: null });
  });

  it("projects.view_all lifts the restriction but still excludes deleted projects", async () => {
    h.user = u(["contracts.view", "projects.view_all"]);
    await getContractorProfile(PAPPU);
    expect(attendanceWhere().project).toEqual({ deletedAt: null });
  });

  it("is always tenant-scoped and contractor-scoped", async () => {
    await getContractorProfile(PAPPU);
    expect(attendanceWhere()).toMatchObject({ companyId: "c1", contractorId: PAPPU });
  });

  it("never fetches another project's rows to filter them away later", async () => {
    h.user = u(["contracts.view"]);
    await getContractorProfile(PAPPU);
    // A leak would look like an unscoped where plus UI-side filtering.
    expect(attendanceWhere().project).not.toBeUndefined();
  });
});

describe("what the DTO carries", () => {
  it("reports one entry per project, with the buckets split", async () => {
    h.prisma.labourAttendance.findMany.mockResolvedValue([
      att("p-sky", "Skyline Residency", 400_000, { settled: true, contractId: "ag-structure" }),
      att("p-sky", "Skyline Residency", 200_000, { settled: true }),
      att("p-sky", "Skyline Residency", 900_000),
      att("p-orion", "Orion Tech Park", 500_000, { settled: true }),
    ]);
    const profile = (await getContractorProfile(PAPPU))!;

    expect(profile.attendance).toHaveLength(2);
    const sky = profile.attendance.find((a) => a.projectId === "p-sky")!;
    expect(sky).toMatchObject({
      projectName: "Skyline Residency",
      settledAttributedPaise: 400_000,
      settledUnattributedPaise: 200_000,
      unsettledPaise: 900_000,
    });
  });

  it("totals only what the caller may see", async () => {
    h.prisma.labourAttendance.findMany.mockResolvedValue([
      att("p-sky", "Skyline Residency", 200_000, { settled: true }),
      att("p-orion", "Orion Tech Park", 500_000, { settled: true }),
    ]);
    const profile = (await getContractorProfile(PAPPU))!;
    // The rows the (scoped) query returned, and nothing else.
    expect(profile.attendanceTotals.settledUnattributedPaise).toBe(700_000);
  });

  it("is zeroed, not absent, when the contractor has no attendance", async () => {
    const profile = (await getContractorProfile(PAPPU))!;
    expect(profile.attendance).toEqual([]);
    expect(profile.attendanceTotals).toEqual({
      unsettledPaise: 0,
      settledAttributedPaise: 0,
      settledUnattributedPaise: 0,
    });
  });

  it("covers a project the contractor holds NO agreement on", async () => {
    // contractorContract.findMany returns [] throughout, so `projects` is empty.
    h.prisma.labourAttendance.findMany.mockResolvedValue([
      att("p-sky", "Skyline Residency", 200_000, { settled: true }),
    ]);
    const profile = (await getContractorProfile(PAPPU))!;
    expect(profile.projects).toEqual([]);
    expect(profile.attendanceTotals.settledUnattributedPaise).toBe(200_000);
  });
});
