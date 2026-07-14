import { describe, it, expect, beforeEach } from "vitest";
import { demoLaborRepository as repo } from "./demo-repository";

const SKY = "10000000-0000-0000-0000-000000000001";
const today = new Date().toISOString().slice(0, 10);

beforeEach(() => localStorage.clear());

describe("demoLaborRepository — roster", () => {
  it("seeds the roster", async () => {
    expect((await repo.listLaborers()).length).toBe(12);
  });
  it("filters by active status", async () => {
    expect((await repo.listLaborers({ status: "ACTIVE" })).length).toBe(11);
  });
  it("filters by trade", async () => {
    const masons = await repo.listLaborers({ trade: "Mason" });
    expect(masons.length).toBe(2);
  });
  it("filters direct labor (no contractor)", async () => {
    const direct = await repo.listLaborers({ contractorId: "NONE" });
    expect(direct.every((l) => l.contractorId === null)).toBe(true);
  });
  it("warns on duplicate name", async () => {
    const dupes = await repo.findDuplicateLaborers("Ramesh Kumar");
    expect(dupes.length).toBe(1);
    expect(dupes[0].reason).toBe("name");
  });
  it("bulk deactivates", async () => {
    const ids = (await repo.listLaborers({ status: "ACTIVE" })).slice(0, 3).map((l) => l.id);
    await repo.bulkSetLaborerStatus(ids, "INACTIVE");
    expect((await repo.listLaborers({ status: "ACTIVE" })).length).toBe(8);
  });
});

describe("demoLaborRepository — attendance", () => {
  it("derives an 8-worker crew for Skyline, unmarked today", async () => {
    const sheet = await repo.getSheet(SKY, today);
    expect(sheet.summary.crew).toBe(8);
    expect(sheet.summary.unmarked).toBe(8);
  });

  it("marks all present with correct total wages", async () => {
    const sheet = await repo.markAllPresent(SKY, today);
    expect(sheet.summary.present).toBe(8);
    // 850+550+1100+900+800+950+550+700 = ₹6400
    expect(sheet.summary.totalWagePaise).toBe(640000);
  });

  it("updates a single worker and recomputes the total", async () => {
    await repo.markAllPresent(SKY, today);
    const sheet = await repo.getSheet(SKY, today);
    const first = sheet.cells[0];
    const after = await repo.setAttendance(SKY, first.laborerId, today, "ABSENT", 0);
    expect(after.summary.absent).toBe(1);
    expect(after.summary.totalWagePaise).toBe(640000 - first.dailyWagePaise);
  });

  it("snapshots the wage rate — later wage changes don't rewrite history", async () => {
    const sheet = await repo.markAllPresent(SKY, today);
    const cell = sheet.cells[0];
    const snapshot = cell.wagePayablePaise;
    await repo.updateLaborer(cell.laborerId, { dailyWagePaise: cell.dailyWagePaise + 50000 });
    const reread = await repo.getSheet(SKY, today);
    const same = reread.cells.find((c) => c.laborerId === cell.laborerId)!;
    expect(same.wagePayablePaise).toBe(snapshot); // unchanged
  });

  it("copies yesterday into today", async () => {
    const sheet = await repo.copyYesterday(SKY, today);
    expect(sheet.summary.crew).toBe(8);
    expect(sheet.summary.present + sheet.summary.half + sheet.summary.absent).toBeGreaterThan(0);
  });
});

describe("demoLaborRepository — rollups", () => {
  it("rolls up cost by contractor including a direct-labor bucket", async () => {
    await repo.markAllPresent(SKY, today);
    const groups = await repo.laborCostByContractor({ from: "2000-01-01", to: "2100-01-01" });
    expect(groups.some((g) => g.contractorId === null)).toBe(true); // Direct labor
    expect(groups.reduce((s, g) => s + g.totalPaise, 0)).toBeGreaterThan(0);
  });
});
