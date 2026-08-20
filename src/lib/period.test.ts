import { describe, it, expect } from "vitest";
import { addDays, inPeriod, labelForBounds, resolvePeriod } from "./period";

/**
 * The Payments Centre's period rules, now shared with Reports. The cases that
 * matter are the edges: month and year boundaries, and the Indian financial
 * year, which is the year this product's users actually close their books on.
 */

describe("resolvePeriod", () => {
  it("bounds today to a single day", () => {
    expect(resolvePeriod("TODAY", "2026-08-20")).toMatchObject({
      from: "2026-08-20",
      to: "2026-08-20",
      label: "Today",
    });
  });

  it("starts the week on Monday, as a site week is worked and paid", () => {
    // 2026-08-20 is a Thursday.
    expect(resolvePeriod("THIS_WEEK", "2026-08-20")).toMatchObject({
      from: "2026-08-17",
      to: "2026-08-23",
    });
    // A Sunday belongs to the week that began the previous Monday, not the next.
    expect(resolvePeriod("THIS_WEEK", "2026-08-23")).toMatchObject({
      from: "2026-08-17",
      to: "2026-08-23",
    });
    expect(resolvePeriod("THIS_WEEK", "2026-08-24")).toMatchObject({ from: "2026-08-24" });
  });

  it("resolves a month to its true first and last day", () => {
    expect(resolvePeriod("THIS_MONTH", "2026-02-20")).toMatchObject({
      from: "2026-02-01",
      to: "2026-02-28",
      label: "February 2026",
    });
    expect(resolvePeriod("THIS_MONTH", "2026-12-05")).toMatchObject({
      from: "2026-12-01",
      to: "2026-12-31",
    });
  });

  it("rolls last month back across a year boundary", () => {
    expect(resolvePeriod("LAST_MONTH", "2026-01-09")).toMatchObject({
      from: "2025-12-01",
      to: "2025-12-31",
      label: "December 2025",
    });
  });

  it("uses the Indian financial year, April to March", () => {
    expect(resolvePeriod("FINANCIAL_YEAR", "2026-02-20")).toMatchObject({
      from: "2025-04-01",
      to: "2026-03-31",
      label: "FY 2025–26",
    });
    // 1 April opens the NEW year, not the closing one.
    expect(resolvePeriod("FINANCIAL_YEAR", "2026-04-01")).toMatchObject({
      from: "2026-04-01",
      to: "2027-03-31",
      label: "FY 2026–27",
    });
    expect(resolvePeriod("FINANCIAL_YEAR", "2026-03-31")).toMatchObject({ from: "2025-04-01" });
  });

  it("makes all time unbounded and says so", () => {
    expect(resolvePeriod("ALL_TIME", "2026-02-20")).toMatchObject({
      from: null,
      to: null,
      label: "All time",
    });
  });

  it("labels a custom range even when only one side is set", () => {
    expect(resolvePeriod("CUSTOM", "2026-02-20", { from: "2026-01-01" }).label).toBe(
      "From 2026-01-01",
    );
    expect(resolvePeriod("CUSTOM", "2026-02-20", { to: "2026-01-31" }).label).toBe(
      "Up to 2026-01-31",
    );
    expect(resolvePeriod("CUSTOM", "2026-02-20", {}).label).toBe("All time");
  });

  it("never shifts an edge across a timezone", () => {
    // Pure UTC string arithmetic: the same input always gives the same bounds,
    // whatever the runtime's zone.
    expect(addDays("2026-03-31", 1)).toBe("2026-04-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("inPeriod", () => {
  it("is inclusive on both ends", () => {
    const p = { from: "2026-02-01", to: "2026-02-28" };
    expect(inPeriod("2026-02-01", p)).toBe(true);
    expect(inPeriod("2026-02-28", p)).toBe(true);
    expect(inPeriod("2026-01-31", p)).toBe(false);
    expect(inPeriod("2026-03-01", p)).toBe(false);
  });

  it("treats a null bound as unconstrained", () => {
    expect(inPeriod("1999-01-01", { from: null, to: null })).toBe(true);
    expect(inPeriod("1999-01-01", { from: "2026-01-01", to: null })).toBe(false);
  });
});

describe("labelForBounds", () => {
  it("names a range recovered from a URL rather than going blank", () => {
    expect(labelForBounds("2026-01-01", "2026-01-31")).toBe("2026-01-01 to 2026-01-31");
    expect(labelForBounds(null, null)).toBe("All time");
  });
});
