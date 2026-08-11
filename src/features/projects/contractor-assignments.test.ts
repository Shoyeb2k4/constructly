/**
 * Project ↔ contractor assignment + Labour filtering (demo-repository parity).
 * Runs against the localStorage-backed demo repositories in jsdom, exercising
 * the same read/write/eligibility paths the server enforces (see
 * server/assignments-enforcement.test.ts for the tenancy/RBAC gate).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { demoRepository as projects } from "./demo/demo-repository";
import { demoContractorsRepository as contractors } from "@/features/contractors/demo/demo-repository";
import { demoLaborRepository as labor } from "@/features/labor/demo/demo-repository";

beforeEach(() => {
  localStorage.clear();
});

async function setup() {
  const cats = await labor.listCategories();
  const [catA, catB] = cats;
  const existing = await contractors.listContractors({});
  const A = existing[0];
  const B = existing[1];
  const C = await contractors.createContractor({ name: "Arif Plumbing", openingAdvancePaise: 0 });
  return { catA, catB, A, B, C };
}

const base = { type: "COMMERCIAL" as const, budgetPaise: 0, contractValuePaise: 0 };

describe("project contractor assignments — demo parity", () => {
  it("assigns a single contractor to a category and resolves names", async () => {
    const { catA, A } = await setup();
    const p = await projects.create({
      ...base,
      name: "Township",
      contractorAssignments: [{ contractorId: A.id, labourCategoryId: catA.id }],
    });
    const detail = await projects.get(p.id);
    expect(detail?.contractorAssignments).toHaveLength(1);
    expect(detail?.contractorAssignments[0]).toMatchObject({
      contractorId: A.id,
      contractorName: A.name,
      labourCategoryId: catA.id,
      categoryName: catA.name,
    });
  });

  it("assigns multiple contractors and loads them on edit", async () => {
    const { catA, catB, A, B } = await setup();
    const p = await projects.create({
      ...base,
      name: "Township",
      contractorAssignments: [
        { contractorId: A.id, labourCategoryId: catA.id },
        { contractorId: B.id, labourCategoryId: catB.id },
      ],
    });
    const loaded = await projects.listContractorAssignments(p.id);
    expect(loaded.map((a) => a.contractorId).sort()).toEqual([A.id, B.id].sort());
  });

  it("drops exact-duplicate (contractor + category) rows", async () => {
    const { catA, A } = await setup();
    const p = await projects.create({
      ...base,
      name: "Dup",
      contractorAssignments: [
        { contractorId: A.id, labourCategoryId: catA.id },
        { contractorId: A.id, labourCategoryId: catA.id },
      ],
    });
    expect((await projects.get(p.id))?.contractorAssignments).toHaveLength(1);
  });

  it("changes and removes assignments via setContractorAssignments", async () => {
    const { catA, catB, A, B } = await setup();
    const p = await projects.create({ ...base, name: "Edit me" });
    await projects.setContractorAssignments(p.id, [
      { contractorId: A.id, labourCategoryId: catA.id },
      { contractorId: B.id, labourCategoryId: catB.id },
    ]);
    expect(await projects.listContractorAssignments(p.id)).toHaveLength(2);

    // Change: keep only A.
    await projects.setContractorAssignments(p.id, [{ contractorId: A.id, labourCategoryId: catA.id }]);
    const afterChange = await projects.listContractorAssignments(p.id);
    expect(afterChange).toHaveLength(1);
    expect(afterChange[0].contractorId).toBe(A.id);

    // Remove all.
    await projects.setContractorAssignments(p.id, []);
    expect(await projects.listContractorAssignments(p.id)).toHaveLength(0);
  });

  it("ignores an unknown contractor/category (company-ownership parity)", async () => {
    const { catA } = await setup();
    const p = await projects.create({
      ...base,
      name: "Ghost",
      contractorAssignments: [{ contractorId: "does-not-exist", labourCategoryId: catA.id }],
    });
    expect((await projects.get(p.id))?.contractorAssignments).toHaveLength(0);
  });
});

describe("Labour contractor availability follows the selected project", () => {
  it("returns each project's own contractors only (A,B for one; C for the other)", async () => {
    const { catA, catB, A, B, C } = await setup();
    const pA = await projects.create({
      ...base,
      name: "Project A",
      contractorAssignments: [
        { contractorId: A.id, labourCategoryId: catA.id },
        { contractorId: B.id, labourCategoryId: catB.id },
      ],
    });
    const pB = await projects.create({
      ...base,
      name: "Project B",
      contractorAssignments: [{ contractorId: C.id, labourCategoryId: catA.id }],
    });

    const availA = (await projects.listContractorAssignments(pA.id)).map((a) => a.contractorId);
    const availB = (await projects.listContractorAssignments(pB.id)).map((a) => a.contractorId);

    expect(availA.sort()).toEqual([A.id, B.id].sort());
    expect(availB).toEqual([C.id]);
    // A/B must NOT appear for project B.
    expect(availB).not.toContain(A.id);
    expect(availB).not.toContain(B.id);
  });
});

describe("category deletion respects assignments (demo parity)", () => {
  it("a category with assignments but no attendance cannot be deleted; assignment survives", async () => {
    const { A } = await setup();
    // Fresh category (no seeded attendance) assigned to a contractor.
    const fresh = await labor.createCategory({ name: "Civil (fresh)" });
    const p = await projects.create({
      ...base,
      name: "Assigned",
      contractorAssignments: [{ contractorId: A.id, labourCategoryId: fresh.id }],
    });

    await expect(labor.deleteCategory(fresh.id)).rejects.toThrow("CATEGORY_HAS_ASSIGNMENTS");

    // The category AND the assignment are untouched by the blocked delete.
    expect((await labor.listCategories()).some((c) => c.id === fresh.id)).toBe(true);
    const assignments = await projects.listContractorAssignments(p.id);
    expect(assignments.map((a) => a.labourCategoryId)).toContain(fresh.id);
  });

  it("a genuinely unused category (no attendance, no assignments) can be deleted", async () => {
    const cat = await labor.createCategory({ name: "Unused" });
    await labor.deleteCategory(cat.id);
    expect((await labor.listCategories()).some((c) => c.id === cat.id)).toBe(false);
  });
});

describe("attendance eligibility — a contractor not assigned to the project is rejected", () => {
  it("degrades an ineligible contractor attribution to null, keeps eligible ones", async () => {
    const { catA, A, C } = await setup();
    const pA = await projects.create({
      ...base,
      name: "Project A",
      contractorAssignments: [{ contractorId: A.id, labourCategoryId: catA.id }],
    });
    const subId = catA.subcategories[0].id;
    const date = "2026-08-11";

    // C is assigned to a DIFFERENT project → not eligible on pA → coerced to null.
    const sheet1 = await labor.setQuantity(pA.id, date, subId, 2, null, C.id);
    const row1 = sheet1.groups.flatMap((g) => g.rows).find((r) => r.subcategoryId === subId);
    expect(row1?.contractorId).toBeNull();

    // A is assigned to pA → attribution is kept.
    const sheet2 = await labor.setQuantity(pA.id, date, subId, 2, null, A.id);
    const row2 = sheet2.groups.flatMap((g) => g.rows).find((r) => r.subcategoryId === subId);
    expect(row2?.contractorId).toBe(A.id);
  });

  it("category-exact: Pappu (assigned to Civil) cannot be written against Tiles", async () => {
    const { catA, catB, A } = await setup(); // catA = "Civil", catB = "Tiles"
    const pA = await projects.create({
      ...base,
      name: "Project A",
      // A ("Pappu") is assigned ONLY to catA (Civil) on this project.
      contractorAssignments: [{ contractorId: A.id, labourCategoryId: catA.id }],
    });
    const civilSub = catA.subcategories[0].id;
    const tilesSub = catB.subcategories[0].id;
    const date = "2026-08-11";

    // A against Tiles (catB) — assigned to Civil, NOT Tiles → degraded to null.
    const tiles = await labor.setQuantity(pA.id, date, tilesSub, 3, null, A.id);
    const tilesRow = tiles.groups.flatMap((g) => g.rows).find((r) => r.subcategoryId === tilesSub);
    expect(tilesRow?.contractorId).toBeNull();

    // A against Civil (catA) — the assigned category → attribution kept.
    const civil = await labor.setQuantity(pA.id, date, civilSub, 3, null, A.id);
    const civilRow = civil.groups.flatMap((g) => g.rows).find((r) => r.subcategoryId === civilSub);
    expect(civilRow?.contractorId).toBe(A.id);
  });
});
