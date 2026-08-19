/**
 * Contractor-first labour config + attendance (demo-repository parity).
 * Runs against the localStorage-backed demo repositories in jsdom, exercising
 * the same read/write/eligibility/rate paths the server enforces (see
 * server/assignments-enforcement.test.ts for the tenancy/RBAC gate).
 *
 * Anchored by the client's canonical scenario (§33): on one project, Pappu
 * supplies Mason/Helper/Centering and Saddam supplies Centering — both at their
 * own rates — and both record Centering on the SAME day as independent rows.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { demoRepository as projects } from "./demo/demo-repository";
import { demoContractorsRepository as contractors } from "@/features/contractors/demo/demo-repository";
import { demoLaborRepository as labor } from "@/features/labor/demo/demo-repository";
import type { ProjectContractorInput, ProjectDetail } from "./types";

beforeEach(() => {
  localStorage.clear();
});

/** Create + narrow away the duplicate-code result these happy-path creates
 *  never hit, so call sites can use the project directly. */
async function mkProject(
  input: Parameters<typeof projects.create>[0],
): Promise<ProjectDetail> {
  const res = await projects["create"](input);
  if ("duplicateCode" in res) throw new Error("unexpected duplicateCode in test");
  return res;
}

/** Create + narrow away the duplicate-warning result these fixtures never hit,
 *  mirroring `mkProject` above. */
async function mkContractor(
  input: Parameters<typeof contractors.createContractor>[0],
) {
  const res = await contractors.createContractor(input);
  if ("duplicates" in res) throw new Error("unexpected duplicate warning in test");
  return res;
}

async function setup() {
  const cats = await labor.listCategories();
  const [catA, catB] = cats;
  const existing = await contractors.listContractors({});
  const PAPPU = existing[0];
  const SADDAM = existing[1];
  const OTHER = await mkContractor({ name: "Arif Plumbing", openingAdvancePaise: 0 });
  return {
    catA,
    catB,
    PAPPU,
    SADDAM,
    OTHER,
    MASON: catA.subcategories[0].id,
    HELPER: catA.subcategories[1].id,
    CENTERING: catB.subcategories[0].id,
  };
}

const base = { type: "COMMERCIAL" as const, budgetPaise: 0, contractValuePaise: 0 };
const DATE = "2026-08-12";

const recordsFor = async (projectId: string) =>
  labor.listAttendance({ projectId, from: DATE, to: DATE });
const find = <T extends { subcategoryId: string; contractorId: string | null }>(
  rows: T[],
  subId: string,
  contractorId: string | null,
) => rows.find((r) => r.subcategoryId === subId && r.contractorId === contractorId);

describe("§33 — canonical Anjali Residency scenario", () => {
  it("Pappu + Saddam both supply Centering; four independent rows coexist with own rates", async () => {
    const { PAPPU, SADDAM, MASON, HELPER, CENTERING } = await setup();
    const config: ProjectContractorInput[] = [
      {
        contractorId: PAPPU.id,
        labourRates: [
          { labourSubcategoryId: MASON, ratePaise: 80000 },
          { labourSubcategoryId: HELPER, ratePaise: 70000 },
          { labourSubcategoryId: CENTERING, ratePaise: 85000 },
        ],
      },
      { contractorId: SADDAM.id, labourRates: [{ labourSubcategoryId: CENTERING, ratePaise: 95000 }] },
    ];
    const anjali = await mkProject({ ...base, name: "Anjali Residency", contractors: config });

    await labor.setQuantity({ projectId: anjali.id, date: DATE, subcategoryId: MASON, quantity: 8, contractorId: PAPPU.id });
    await labor.setQuantity({ projectId: anjali.id, date: DATE, subcategoryId: HELPER, quantity: 5, contractorId: PAPPU.id });
    await labor.setQuantity({ projectId: anjali.id, date: DATE, subcategoryId: CENTERING, quantity: 4, contractorId: PAPPU.id });
    await labor.setQuantity({ projectId: anjali.id, date: DATE, subcategoryId: CENTERING, quantity: 3, contractorId: SADDAM.id });

    const rows = await recordsFor(anjali.id);
    expect(rows).toHaveLength(4); // four INDEPENDENT rows

    // Pappu Centering and Saddam Centering coexist with their own rate + cost.
    const pc = find(rows, CENTERING, PAPPU.id)!;
    const sc = find(rows, CENTERING, SADDAM.id)!;
    expect(pc.dailyRatePaiseSnapshot).toBe(85000);
    expect(pc.estimatedCostPaise).toBe(4 * 85000);
    expect(sc.dailyRatePaiseSnapshot).toBe(95000);
    expect(sc.estimatedCostPaise).toBe(3 * 95000);

    // The sheet groups contractor-first: Pappu (3 rows) + Saddam (1 row).
    const sheet = await labor.getSheet(anjali.id, DATE);
    const pappuGroup = sheet.groups.find((g) => g.contractorId === PAPPU.id)!;
    const saddamGroup = sheet.groups.find((g) => g.contractorId === SADDAM.id)!;
    expect(pappuGroup.configured).toBe(true);
    expect(pappuGroup.rows.length).toBe(3);
    expect(saddamGroup.rows.length).toBe(1);
    expect(pappuGroup.rows.find((r) => r.subcategoryId === CENTERING)?.quantity).toBe(4);
    expect(saddamGroup.rows.find((r) => r.subcategoryId === CENTERING)?.quantity).toBe(3);
  });

  it("editing a contractor's rate later never rewrites recorded attendance", async () => {
    const { PAPPU, CENTERING } = await setup();
    const anjali = await mkProject({
      ...base,
      name: "Anjali",
      contractors: [{ contractorId: PAPPU.id, labourRates: [{ labourSubcategoryId: CENTERING, ratePaise: 85000 }] }],
    });
    await labor.setQuantity({ projectId: anjali.id, date: DATE, subcategoryId: CENTERING, quantity: 4, contractorId: PAPPU.id });

    // Raise Pappu's Centering rate to ₹900/day.
    await projects.setProjectContractors(anjali.id, [
      { contractorId: PAPPU.id, labourRates: [{ labourSubcategoryId: CENTERING, ratePaise: 90000 }] },
    ]);

    const rec = find(await recordsFor(anjali.id), CENTERING, PAPPU.id)!;
    expect(rec.dailyRatePaiseSnapshot).toBe(85000); // frozen
    expect(rec.estimatedCostPaise).toBe(4 * 85000);
  });
});

describe("§34 — project-specific rates, config edits, eligibility", () => {
  it("same contractor + labour type has different rates on different projects", async () => {
    const { PAPPU, MASON } = await setup();
    const anjali = await mkProject({
      ...base,
      name: "Anjali",
      contractors: [{ contractorId: PAPPU.id, labourRates: [{ labourSubcategoryId: MASON, ratePaise: 80000 }] }],
    });
    const township = await mkProject({
      ...base,
      name: "Township",
      contractors: [{ contractorId: PAPPU.id, labourRates: [{ labourSubcategoryId: MASON, ratePaise: 90000 }] }],
    });

    await labor.setQuantity({ projectId: anjali.id, date: DATE, subcategoryId: MASON, quantity: 2, contractorId: PAPPU.id });
    await labor.setQuantity({ projectId: township.id, date: DATE, subcategoryId: MASON, quantity: 2, contractorId: PAPPU.id });

    expect(find(await recordsFor(anjali.id), MASON, PAPPU.id)?.dailyRatePaiseSnapshot).toBe(80000);
    expect(find(await recordsFor(township.id), MASON, PAPPU.id)?.dailyRatePaiseSnapshot).toBe(90000);
  });

  it("project switching surfaces only that project's contractors", async () => {
    const { PAPPU, SADDAM, OTHER, MASON, CENTERING } = await setup();
    const anjali = await mkProject({
      ...base,
      name: "Anjali",
      contractors: [
        { contractorId: PAPPU.id, labourRates: [{ labourSubcategoryId: MASON, ratePaise: 80000 }] },
        { contractorId: SADDAM.id, labourRates: [{ labourSubcategoryId: CENTERING, ratePaise: 95000 }] },
      ],
    });
    const township = await mkProject({
      ...base,
      name: "Township",
      contractors: [{ contractorId: OTHER.id, labourRates: [{ labourSubcategoryId: MASON, ratePaise: 88000 }] }],
    });

    const anjaliContractors = (await projects.listProjectContractors(anjali.id)).map((c) => c.contractorId);
    const townshipContractors = (await projects.listProjectContractors(township.id)).map((c) => c.contractorId);
    expect(anjaliContractors.sort()).toEqual([PAPPU.id, SADDAM.id].sort());
    expect(townshipContractors).toEqual([OTHER.id]);
    expect(townshipContractors).not.toContain(PAPPU.id);
  });

  it("edits + removes contractor config transactionally", async () => {
    const { PAPPU, SADDAM, MASON, CENTERING } = await setup();
    const p = await mkProject({ ...base, name: "Edit me" });
    await projects.setProjectContractors(p.id, [
      { contractorId: PAPPU.id, labourRates: [{ labourSubcategoryId: MASON, ratePaise: 80000 }] },
      { contractorId: SADDAM.id, labourRates: [{ labourSubcategoryId: CENTERING, ratePaise: 95000 }] },
    ]);
    expect(await projects.listProjectContractors(p.id)).toHaveLength(2);

    await projects.setProjectContractors(p.id, [
      { contractorId: PAPPU.id, labourRates: [{ labourSubcategoryId: MASON, ratePaise: 80000 }] },
    ]);
    const after = await projects.listProjectContractors(p.id);
    expect(after).toHaveLength(1);
    expect(after[0].contractorId).toBe(PAPPU.id);

    await projects.setProjectContractors(p.id, []);
    expect(await projects.listProjectContractors(p.id)).toHaveLength(0);
  });

  it("drops unknown contractor + unconfigured labour types (company-ownership parity)", async () => {
    const { PAPPU, MASON } = await setup();
    const ghost = await mkProject({
      ...base,
      name: "Ghost",
      contractors: [
        { contractorId: "does-not-exist", labourRates: [{ labourSubcategoryId: MASON, ratePaise: 1 }] },
        { contractorId: PAPPU.id, labourRates: [{ labourSubcategoryId: "nope-sub", ratePaise: 1 }] },
      ],
    });
    const detail = await projects.get(ghost.id);
    // Unknown contractor dropped entirely; Pappu kept but with no valid labour types.
    expect(detail?.contractors).toHaveLength(1);
    expect(detail?.contractors[0].contractorId).toBe(PAPPU.id);
    expect(detail?.contractors[0].labourRates).toHaveLength(0);
  });

  it("degrades an ineligible contractor attribution to null; keeps eligible ones", async () => {
    const { PAPPU, OTHER, MASON } = await setup();
    const anjali = await mkProject({
      ...base,
      name: "Anjali",
      contractors: [{ contractorId: PAPPU.id, labourRates: [{ labourSubcategoryId: MASON, ratePaise: 80000 }] }],
    });

    // OTHER supplies nothing on this project → not eligible → coerced to null.
    await labor.setQuantity({ projectId: anjali.id, date: DATE, subcategoryId: MASON, quantity: 2, contractorId: OTHER.id });
    expect(find(await recordsFor(anjali.id), MASON, null)?.contractorId ?? null).toBeNull();

    // Pappu supplies Mason here → attribution kept.
    await labor.setQuantity({ projectId: anjali.id, date: DATE, subcategoryId: MASON, quantity: 2, contractorId: PAPPU.id });
    expect(find(await recordsFor(anjali.id), MASON, PAPPU.id)?.contractorId).toBe(PAPPU.id);
  });
});

describe("taxonomy deletion guards respect contractor config (demo parity)", () => {
  it("a category with a configured labour rate cannot be deleted", async () => {
    const { PAPPU } = await setup();
    const fresh = await labor.createCategory({ name: "Civil (fresh)" });
    const sub = await labor.createSubcategory({ categoryId: fresh.id, name: "Mason", dailyRatePaise: 80000 });
    await mkProject({
      ...base,
      name: "Assigned",
      contractors: [{ contractorId: PAPPU.id, labourRates: [{ labourSubcategoryId: sub.id, ratePaise: 80000 }] }],
    });

    await expect(labor.deleteCategory(fresh.id)).rejects.toThrow("CATEGORY_HAS_ASSIGNMENTS");
    await expect(labor.deleteSubcategory(sub.id)).rejects.toThrow("SUBCATEGORY_HAS_ASSIGNMENTS");
    expect((await labor.listCategories()).some((c) => c.id === fresh.id)).toBe(true);
  });

  it("a genuinely unused category can be deleted", async () => {
    const cat = await labor.createCategory({ name: "Unused" });
    await labor.deleteCategory(cat.id);
    expect((await labor.listCategories()).some((c) => c.id === cat.id)).toBe(false);
  });
});
