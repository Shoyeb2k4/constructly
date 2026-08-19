/**
 * The removal guard on the demo stores.
 *
 * The server tests mock Prisma, so they cannot catch a divergence in the demo
 * implementation of the same rule — and demo mode is what a reviewer clicks
 * through. This exercises the real create/remove path end to end.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { demoRepository as projects } from "./demo/demo-repository";
import { demoContractsRepository as contracts } from "@/features/contracts/demo/demo-repository";
import type { ContractorRemovalBlocker } from "./contractor-removal";
import type { ProjectContractorInput } from "./types";

/** Skyline Residency — carries Pappu's seeded agreements. */
const SKYLINE = "10000000-0000-0000-0000-000000000001";
const PAPPU = "c-pappu";
const RAMESH = "c-ramesh";

beforeEach(async () => {
  localStorage.clear();
  await projects.list({});
  await contracts.listContracts({});
});

const config = async (): Promise<ProjectContractorInput[]> =>
  (await projects.listProjectContractors(SKYLINE)).map((pc) => ({
    contractorId: pc.contractorId,
    contractRatePaise: pc.contractRatePaise,
    contractRateUnit: pc.contractRateUnit,
    labourRates: pc.labourRates.map((r) => ({
      labourSubcategoryId: r.labourSubcategoryId,
      ratePaise: r.ratePaise,
      rateUnit: r.rateUnit,
    })),
  }));

/** Save the current config minus one contractor. */
async function drop(contractorId: string) {
  const keep = (await config()).filter((r) => r.contractorId !== contractorId);
  return projects.setProjectContractors(SKYLINE, keep);
}

const blockers = (res: Awaited<ReturnType<typeof drop>>): ContractorRemovalBlocker[] =>
  "blockedRemovals" in res ? res.blockedRemovals : [];

describe("removing a contractor from a project (demo)", () => {
  it("refuses a contractor holding live agreements, naming them", async () => {
    const res = await drop(PAPPU);
    const [b] = blockers(res);

    expect(b).toBeDefined();
    expect(b.contractorId).toBe(PAPPU);
    expect(b.agreements.length).toBeGreaterThan(0);
    expect(b.agreements.map((a) => a.title)).toContain("Structure");

    // The relationship survives.
    const after = await projects.listProjectContractors(SKYLINE);
    expect(after.map((pc) => pc.contractorId)).toContain(PAPPU);
  });

  it("leaves the agreements themselves untouched", async () => {
    const before = await contracts.listContracts({ projectId: SKYLINE });
    await drop(PAPPU);
    const after = await contracts.listContracts({ projectId: SKYLINE });
    expect(after.map((c) => c.id).sort()).toEqual(before.map((c) => c.id).sort());
  });

  it("allows a contractor with no agreement, attendance or settlement", async () => {
    const res = await drop(RAMESH);
    expect(blockers(res)).toHaveLength(0);

    const after = await projects.listProjectContractors(SKYLINE);
    expect(after.map((pc) => pc.contractorId)).not.toContain(RAMESH);
    // …and the one that was in the way is still there.
    expect(after.map((pc) => pc.contractorId)).toContain(PAPPU);
  });

  it("clears the AGREEMENT blocker once every agreement is cancelled", async () => {
    for (const c of await contracts.listContracts({ projectId: SKYLINE })) {
      if (c.contractorId === PAPPU) await contracts.cancelContract(c.id, "Work not going ahead");
    }
    const [b] = blockers(await drop(PAPPU));

    // No agreement stands in the way any more — cancellation is the documented
    // route out. Pappu's seeded attendance on Skyline still does, which is the
    // pre-existing rule and exactly what should remain.
    expect(b.agreements).toHaveLength(0);
    expect(b.attendanceCount).toBeGreaterThan(0);
  });

  it("does not block a removal on one project because of an agreement on another", async () => {
    // Pappu also holds an Orion agreement in the seed. Orion's own config must
    // not be held hostage by Skyline's, and vice versa.
    const orionAgreements = await contracts.listContracts({});
    const orion = orionAgreements.find((c) => c.projectId !== SKYLINE && c.contractorId === PAPPU);
    expect(orion).toBeDefined();

    const [b] = blockers(await drop(PAPPU));
    // Only Skyline's agreements are cited.
    expect(b.agreements.every((a) => a.id !== orion!.id)).toBe(true);
  });

  it("changes nothing when no contractor is dropped", async () => {
    const res = await projects.setProjectContractors(SKYLINE, await config());
    expect(blockers(res)).toHaveLength(0);
    const after = await projects.listProjectContractors(SKYLINE);
    expect(after.map((pc) => pc.contractorId).sort()).toEqual([PAPPU, RAMESH].sort());
  });
});
