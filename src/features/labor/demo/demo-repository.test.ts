import { describe, it, expect, beforeEach } from "vitest";
import { demoLaborRepository as repo } from "./demo-repository";

const SKY = "10000000-0000-0000-0000-000000000001";
const today = new Date().toISOString().slice(0, 10);

beforeEach(() => localStorage.clear());

describe("labour categories", () => {
  it("seeds default categories with rates", async () => {
    const cats = await repo.listCategories();
    expect(cats.length).toBe(8);
    expect(cats.find((c) => c.name === "Mason")?.dailyRatePaise).toBe(85000);
  });
  it("creates, updates, and deletes a category", async () => {
    const c = await repo.createCategory({ name: "Scaffolder", color: "#EC4899", dailyRatePaise: 90000 });
    expect(c.name).toBe("Scaffolder");
    const updated = await repo.updateCategory(c.id, { dailyRatePaise: 95000 });
    expect(updated.dailyRatePaise).toBe(95000);
    await repo.deleteCategory(c.id);
    expect((await repo.listCategories()).some((x) => x.id === c.id)).toBe(false);
  });
  it("rejects duplicate names", async () => {
    await expect(repo.createCategory({ name: "mason", color: "#000000" })).rejects.toThrow("DUPLICATE_NAME");
  });
});

describe("labour attendance", () => {
  it("returns a sheet with one row per category (today unrecorded)", async () => {
    const sheet = await repo.getSheet(SKY, today);
    expect(sheet.rows.length).toBe(8);
    expect(sheet.totalPresent).toBe(0);
  });

  it("sets headcounts and computes totals + estimated cost", async () => {
    const cats = await repo.listCategories();
    const helper = cats.find((c) => c.name === "Helper")!;
    const mason = cats.find((c) => c.name === "Mason")!;
    await repo.setQuantity(SKY, today, helper.id, 12);
    const sheet = await repo.setQuantity(SKY, today, mason.id, 8);
    expect(sheet.totalPresent).toBe(20);
    expect(sheet.estimatedCostPaise).toBe(12 * 55000 + 8 * 85000);
  });

  it("quantity 0 deletes the record", async () => {
    const helper = (await repo.listCategories()).find((c) => c.name === "Helper")!;
    await repo.setQuantity(SKY, today, helper.id, 12);
    const sheet = await repo.setQuantity(SKY, today, helper.id, 0);
    expect(sheet.totalPresent).toBe(0);
    const records = await repo.listAttendance({ projectId: SKY, from: today, to: today });
    expect(records.length).toBe(0);
  });

  it("copies the previous working day", async () => {
    const sheet = await repo.copyPreviousDay(SKY, today);
    expect(sheet.totalPresent).toBeGreaterThan(0); // seeded history exists
  });

  it("filters attendance by project and date range", async () => {
    const all = await repo.listAttendance({ projectId: "ALL" });
    const sky = await repo.listAttendance({ projectId: SKY });
    expect(sky.length).toBeGreaterThan(0);
    expect(sky.length).toBeLessThan(all.length); // Orion also seeded
    expect(sky.every((r) => r.projectId === SKY)).toBe(true);
  });
});

describe("labour summary", () => {
  it("computes man-days by category, project, and a daily trend", async () => {
    const s = await repo.summary({ projectId: "ALL" });
    expect(s.totalManDays).toBeGreaterThan(0);
    expect(s.byCategory.length).toBeGreaterThan(0);
    expect(s.byProject.length).toBe(2); // Skyline + Orion seeded
    expect(s.trend.length).toBeGreaterThan(5);
    expect(s.estimatedCostPaise).toBeGreaterThan(0);
  });
});
