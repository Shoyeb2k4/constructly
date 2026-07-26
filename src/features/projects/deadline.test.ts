import { describe, it, expect } from "vitest";
import {
  addDaysISO,
  deadlineBounds,
  isOverdue,
  matchesDeadline,
  byDeadlineAsc,
} from "./deadline";

const TODAY = "2026-07-26";

describe("addDaysISO", () => {
  it("adds days across month boundaries", () => {
    expect(addDaysISO("2026-07-26", 7)).toBe("2026-08-02");
    expect(addDaysISO("2026-07-26", 0)).toBe("2026-07-26");
    expect(addDaysISO("2026-02-28", 1)).toBe("2026-03-01");
  });
});

describe("deadlineBounds", () => {
  it("OVERDUE is strictly-before today and excludes closed", () => {
    expect(deadlineBounds("OVERDUE", TODAY)).toEqual({ lt: TODAY, excludeClosed: true });
  });
  it("TODAY is a single-day window", () => {
    expect(deadlineBounds("TODAY", TODAY)).toEqual({ gte: TODAY, lte: TODAY });
  });
  it("WEEK / MONTH are rolling windows", () => {
    expect(deadlineBounds("WEEK", TODAY)).toEqual({ gte: TODAY, lte: "2026-08-02" });
    expect(deadlineBounds("MONTH", TODAY)).toEqual({ gte: TODAY, lte: "2026-08-25" });
  });
  it("ALL is no filter", () => {
    expect(deadlineBounds("ALL", TODAY)).toBeNull();
  });
});

describe("matchesDeadline", () => {
  it("ALL matches everything, including undated", () => {
    expect(matchesDeadline(null, "CREATED", "ALL", TODAY)).toBe(true);
    expect(matchesDeadline("2020-01-01", "CLOSED", "ALL", TODAY)).toBe(true);
  });

  it("undated projects match no specific window", () => {
    expect(matchesDeadline(null, "CREATED", "OVERDUE", TODAY)).toBe(false);
    expect(matchesDeadline(null, "CREATED", "TODAY", TODAY)).toBe(false);
  });

  it("OVERDUE: past deadline and not closed", () => {
    expect(matchesDeadline("2026-07-25", "CONSTRUCTION", "OVERDUE", TODAY)).toBe(true);
    expect(matchesDeadline("2026-07-26", "CONSTRUCTION", "OVERDUE", TODAY)).toBe(false); // today isn't overdue
    expect(matchesDeadline("2026-07-25", "CLOSED", "OVERDUE", TODAY)).toBe(false); // closed excluded
  });

  it("TODAY: exactly today", () => {
    expect(matchesDeadline("2026-07-26", "PLANNING", "TODAY", TODAY)).toBe(true);
    expect(matchesDeadline("2026-07-27", "PLANNING", "TODAY", TODAY)).toBe(false);
  });

  it("WEEK: today through +7, inclusive", () => {
    expect(matchesDeadline("2026-07-26", "PLANNING", "WEEK", TODAY)).toBe(true);
    expect(matchesDeadline("2026-08-02", "PLANNING", "WEEK", TODAY)).toBe(true);
    expect(matchesDeadline("2026-08-03", "PLANNING", "WEEK", TODAY)).toBe(false);
    expect(matchesDeadline("2026-07-25", "PLANNING", "WEEK", TODAY)).toBe(false); // past, not in window
  });

  it("MONTH: today through +30, inclusive", () => {
    expect(matchesDeadline("2026-08-25", "PLANNING", "MONTH", TODAY)).toBe(true);
    expect(matchesDeadline("2026-08-26", "PLANNING", "MONTH", TODAY)).toBe(false);
  });
});

describe("isOverdue", () => {
  it("true only when past and not closed", () => {
    expect(isOverdue("2026-07-25", "CONSTRUCTION", TODAY)).toBe(true);
    expect(isOverdue("2026-07-26", "CONSTRUCTION", TODAY)).toBe(false);
    expect(isOverdue("2026-07-25", "CLOSED", TODAY)).toBe(false);
    expect(isOverdue(null, "CONSTRUCTION", TODAY)).toBe(false);
  });
});

describe("byDeadlineAsc", () => {
  it("sorts ascending with undated last", () => {
    const rows = [
      { expectedCompletionDate: null },
      { expectedCompletionDate: "2026-09-01" },
      { expectedCompletionDate: "2026-02-01" },
    ];
    expect(rows.slice().sort(byDeadlineAsc).map((r) => r.expectedCompletionDate)).toEqual([
      "2026-02-01",
      "2026-09-01",
      null,
    ]);
  });
});
