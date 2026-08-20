import { describe, it, expect, beforeEach } from "vitest";
import { gatherDemoDashboard } from "./gather";
import { assembleDashboard } from "../assemble";

/**
 * Regression: a brand-new (fully empty) company must produce an isEmpty
 * snapshot — found by the v1.0.0 customer acceptance test, where the dashboard
 * stuck on skeletons for a fresh workspace.
 */

const EMPTY_KEYS = [
  "constructly.demo.projects.v1",
  "constructly.demo.labourCategories.v2",
  "constructly.demo.labourSubcategories.v2",
  "constructly.demo.labourAttendance.v2",
  "constructly.demo.vendors.v2",
  "constructly.demo.pos.v2",
  "constructly.demo.vendorPayments.v1",
  "constructly.demo.vendorDocs.v1",
];

describe("gatherDemoDashboard — brand-new company", () => {
  beforeEach(() => {
    localStorage.clear();
    EMPTY_KEYS.forEach((k) => localStorage.setItem(k, "[]"));
  });

  it("gathers and assembles an empty company without throwing", () => {
    const raw = gatherDemoDashboard({ userId: "u", isOwner: true });
    const snap = assembleDashboard(raw);
    expect(snap.isEmpty).toBe(true);
    expect(snap.kpis.activeProjects).toBe(0);
    expect(snap.procurement.spendPaise).toBe(0);
  });

  it("gathers the seeded demo company without throwing", () => {
    localStorage.clear(); // let seeds repopulate on read
    const raw = gatherDemoDashboard({ userId: "u", isOwner: true });
    expect(() => assembleDashboard(raw)).not.toThrow();
  });
});

/**
 * A dashboard that under-reports is worse than one that fails: nothing looks
 * wrong. Each module's demo repository seeds its own store lazily on first
 * read, so before this fix the dashboard showed zero purchase orders, zero
 * vendors and zero labour on a fresh session — and the numbers then changed
 * underneath the user once they visited those modules.
 */
describe("a fresh session, before any module has been visited", () => {
  it("seeds the stores it reads instead of reporting zero", () => {
    localStorage.clear();

    const raw = gatherDemoDashboard({ userId: "u1", isOwner: true });

    expect(raw.projects.length, "projects").toBeGreaterThan(0);
    expect(raw.procurementPOs.length, "purchase orders").toBeGreaterThan(0);
    expect(raw.labourEntries.length, "labour entries").toBeGreaterThan(0);
  });

  it("agrees with what the modules themselves would seed", () => {
    localStorage.clear();
    const first = gatherDemoDashboard({ userId: "u1", isOwner: true });
    // A second gather reads the now-persisted stores rather than re-seeding,
    // and must produce the same picture.
    const second = gatherDemoDashboard({ userId: "u1", isOwner: true });

    expect(second.procurementPOs.length).toBe(first.procurementPOs.length);
    expect(second.projects.length).toBe(first.projects.length);
  });
});
