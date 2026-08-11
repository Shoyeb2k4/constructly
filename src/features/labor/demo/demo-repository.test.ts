import { describe, it, expect, beforeEach } from "vitest";
import { demoLaborRepository as repo } from "./demo-repository";
import { demoRepository as projectsRepo } from "@/features/projects/demo/demo-repository";

const SKY = "10000000-0000-0000-0000-000000000001";
const RAMESH = "c-ramesh"; // seeded demo contractor
const today = new Date().toISOString().slice(0, 10);

beforeEach(() => localStorage.clear());

async function firstSub() {
  const cats = await repo.listCategories();
  return { category: cats[0], sub: cats[0].subcategories[0] };
}

/** Configure a contractor on SKY supplying the given subcategories at rates
 *  equal to their global default (contractor-first attendance needs config). */
async function configure(
  subs: { id: string; dailyRatePaise: number | null }[],
  contractorId = RAMESH,
) {
  await projectsRepo.setProjectContractors(SKY, [
    {
      contractorId,
      labourRates: subs.map((s) => ({ labourSubcategoryId: s.id, ratePaise: s.dailyRatePaise ?? 0 })),
    },
  ]);
}

describe("labour hierarchy", () => {
  it("seeds the default Category → Subcategory hierarchy", async () => {
    const cats = await repo.listCategories();
    expect(cats.length).toBe(5);
    const carpenter = cats.find((c) => c.name === "Carpenter")!;
    expect(carpenter.subcategories.map((s) => s.name)).toEqual(["Main Carpenter", "Carpenter Helper"]);
    expect(carpenter.subcategories[0].dailyRatePaise).toBe(90000);
  });

  it("creates, edits, moves, and deletes categories and subcategories", async () => {
    const cat = await repo.createCategory({ name: "Welding", color: "#EC4899" });
    const sub = await repo.createSubcategory({ categoryId: cat.id, name: "Main Welder", dailyRatePaise: 100000 });
    expect(sub.categoryId).toBe(cat.id);

    await repo.updateSubcategory(sub.id, { dailyRatePaise: 110000 });
    const other = (await repo.listCategories())[0];
    await repo.updateSubcategory(sub.id, { categoryId: other.id }); // move
    const moved = (await repo.listCategories())
      .find((c) => c.id === other.id)!
      .subcategories.find((s) => s.id === sub.id);
    expect(moved?.dailyRatePaise).toBe(110000);

    await repo.deleteSubcategory(sub.id);
    await repo.deleteCategory(cat.id);
    expect((await repo.listCategories()).some((c) => c.id === cat.id)).toBe(false);
  });

  it("blocks physical deletion once attendance is recorded (history preserved)", async () => {
    const cat = await repo.createCategory({ name: "Roofing" });
    const sub = await repo.createSubcategory({ categoryId: cat.id, name: "Roofer", dailyRatePaise: 90000 });
    await repo.setQuantity(SKY, today, sub.id, 2, null);

    await expect(repo.deleteSubcategory(sub.id)).rejects.toThrow("SUBCATEGORY_HAS_ATTENDANCE");
    await expect(repo.deleteCategory(cat.id)).rejects.toThrow("CATEGORY_HAS_ATTENDANCE");

    // The blocked attempts left the attendance untouched.
    const sheet = await repo.getSheet(SKY, today);
    const row = sheet.groups.flatMap((g) => g.rows).find((r) => r.subcategoryId === sub.id);
    expect(row?.quantity).toBe(2);
  });

  it("reorders categories and subcategories via displayOrder", async () => {
    const before = await repo.listCategories();
    const reversed = [...before.map((c) => c.id)].reverse();
    await repo.reorderCategories(reversed);
    const after = await repo.listCategories();
    expect(after.map((c) => c.id)).toEqual(reversed);

    const target = after[0];
    const subsReversed = [...target.subcategories.map((s) => s.id)].reverse();
    await repo.reorderSubcategories(target.id, subsReversed);
    const again = (await repo.listCategories()).find((c) => c.id === target.id)!;
    expect(again.subcategories.map((s) => s.id)).toEqual(subsReversed);
  });

  it("rejects duplicate names within scope", async () => {
    await expect(repo.createCategory({ name: "mason" })).rejects.toThrow("DUPLICATE_NAME");
    const { category } = await firstSub();
    await expect(
      repo.createSubcategory({ categoryId: category.id, name: category.subcategories[0].name }),
    ).rejects.toThrow("DUPLICATE_NAME");
  });
});

describe("labour attendance (contractor-first)", () => {
  it("builds a contractor-grouped sheet (today unrecorded)", async () => {
    const cats = await repo.listCategories();
    await configure(cats[0].subcategories); // Ramesh supplies the 2 Carpenter types
    const sheet = await repo.getSheet(SKY, today);
    expect(sheet.groups.length).toBe(1);
    expect(sheet.groups[0].contractorId).toBe(RAMESH);
    expect(sheet.groups[0].configured).toBe(true);
    expect(sheet.groups[0].rows.length).toBe(2);
    expect(sheet.totalPresent).toBe(0);
  });

  it("sets headcounts per labour type with contractor + grand totals", async () => {
    const cats = await repo.listCategories();
    const mainCarp = cats[0].subcategories[0]; // ₹900
    const carpHelp = cats[0].subcategories[1]; // ₹550
    await configure([mainCarp, carpHelp]);
    await repo.setQuantity(SKY, today, mainCarp.id, 12, null, RAMESH);
    const sheet = await repo.setQuantity(SKY, today, carpHelp.id, 8, null, RAMESH);
    const group = sheet.groups.find((g) => g.contractorId === RAMESH)!;
    expect(group.totalPresent).toBe(20);
    expect(group.estimatedCostPaise).toBe(12 * 90000 + 8 * 55000);
    expect(sheet.totalPresent).toBe(20);
  });

  it("quantity 0 deletes the record", async () => {
    const { sub } = await firstSub();
    await configure([sub]);
    await repo.setQuantity(SKY, today, sub.id, 12, null, RAMESH);
    const sheet = await repo.setQuantity(SKY, today, sub.id, 0, null, RAMESH);
    expect(sheet.totalPresent).toBe(0);
    expect((await repo.listAttendance({ projectId: SKY, from: today, to: today })).length).toBe(0);
  });

  it("keeps the rate snapshot when the rate changes later", async () => {
    const { sub } = await firstSub();
    await configure([sub]);
    await repo.setQuantity(SKY, today, sub.id, 10, null, RAMESH); // snapshot @ current rate
    await repo.updateSubcategory(sub.id, { dailyRatePaise: (sub.dailyRatePaise ?? 0) + 50000 });
    const rec = (await repo.listAttendance({ projectId: SKY, from: today, to: today }))[0];
    expect(rec.dailyRatePaiseSnapshot).toBe(sub.dailyRatePaise); // original
    expect(rec.estimatedCostPaise).toBe((sub.dailyRatePaise ?? 0) * 10); // unchanged
    expect(rec.contractorId).toBe(RAMESH);
  });

  it("copies the previous working day", async () => {
    const sheet = await repo.copyPreviousDay(SKY, today);
    expect(sheet.totalPresent).toBeGreaterThan(0); // seeded history exists
  });
});

describe("labour summary + migration", () => {
  it("summarizes with category → subcategory breakdown", async () => {
    const s = await repo.summary({ projectId: "ALL" });
    expect(s.totalManDays).toBeGreaterThan(0);
    expect(s.byCategory.length).toBe(5);
    expect(s.byCategory[0].subcategories.length).toBeGreaterThan(0);
    const catTotal = s.byCategory[0].manDays;
    const subSum = s.byCategory[0].subcategories.reduce((x, y) => x + y.manDays, 0);
    expect(catTotal).toBe(subSum);
  });

  it("migrates legacy flat categories into Category → Default Subcategory", async () => {
    // Simulate a v1 (flat) installation.
    localStorage.setItem(
      "constructly.demo.labourCategories.v1",
      JSON.stringify([
        { id: "60000000-0000-0000-0000-000000000001", name: "Helper", color: "#F59E0B", dailyRatePaise: 55000 },
      ]),
    );
    localStorage.setItem(
      "constructly.demo.labourAttendance.v1",
      JSON.stringify([
        {
          id: "old-1",
          projectId: SKY,
          date: "2026-07-10",
          labourCategoryId: "60000000-0000-0000-0000-000000000001",
          quantityPresent: 9,
          dailyRatePaiseSnapshot: 55000,
          estimatedCostPaise: 9 * 55000,
          notes: null,
          clientUuid: "old-1",
          updatedAt: new Date().toISOString(),
        },
      ]),
    );

    const cats = await repo.listCategories();
    expect(cats.length).toBe(1);
    expect(cats[0].name).toBe("Helper");
    expect(cats[0].subcategories.length).toBe(1);
    expect(cats[0].subcategories[0].name).toBe("Helper"); // default subcategory
    expect(cats[0].subcategories[0].dailyRatePaise).toBe(55000);

    const records = await repo.listAttendance({ projectId: SKY });
    expect(records.length).toBe(1);
    expect(records[0].quantityPresent).toBe(9);
    expect(records[0].categoryName).toBe("Helper");
    expect(records[0].subcategoryName).toBe("Helper");
    expect(records[0].estimatedCostPaise).toBe(9 * 55000); // history preserved
  });
});
