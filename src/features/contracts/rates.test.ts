/**
 * Effective-dated rate resolution.
 *
 * The scenario that matters: a project runs long, the rate is renegotiated
 * mid-flight, and attendance recorded before the change must keep valuing at the
 * old rate forever.
 */
import { describe, it, expect } from "vitest";
import { effectiveRateOn, rateBands, validateRateRevision, isValidISODate } from "./rates";
import type { RateRevisionEntry } from "./rates";
import type { RateRevision } from "./types";

const rev = (
  id: string,
  ratePaise: number,
  effectiveFrom: string,
  createdAt = "2026-01-01T00:00:00.000Z",
): RateRevisionEntry => ({ id, ratePaise, rateUnit: "day", effectiveFrom, createdAt });

/** ₹240/day from Jan 2026, renegotiated to ₹260/day from Jan 2027. */
const HISTORY = [
  rev("r1", 24_000, "2026-01-01", "2026-01-01T09:00:00.000Z"),
  rev("r2", 26_000, "2027-01-01", "2026-12-20T09:00:00.000Z"),
];

describe("effectiveRateOn", () => {
  it("resolves the rate in force on the given date", () => {
    expect(effectiveRateOn(HISTORY, "2026-06-15")?.ratePaise).toBe(24_000);
    expect(effectiveRateOn(HISTORY, "2027-06-15")?.ratePaise).toBe(26_000);
  });

  it("is inclusive of the effective-from date itself", () => {
    expect(effectiveRateOn(HISTORY, "2027-01-01")?.ratePaise).toBe(26_000);
    expect(effectiveRateOn(HISTORY, "2026-12-31")?.ratePaise).toBe(24_000);
  });

  it("returns null before the first revision, so the caller can fall through", () => {
    expect(effectiveRateOn(HISTORY, "2025-12-31")).toBeNull();
    expect(effectiveRateOn([], "2026-06-15")).toBeNull();
  });

  it("does not depend on input order", () => {
    const shuffled = [...HISTORY].reverse();
    expect(effectiveRateOn(shuffled, "2026-06-15")?.ratePaise).toBe(24_000);
    expect(effectiveRateOn(shuffled, "2027-06-15")?.ratePaise).toBe(26_000);
  });

  it("lets a same-day correction supersede the row it corrects", () => {
    // Someone entered ₹240 then corrected it to ₹250 the same day. Both rows
    // survive — history is never erased — but the later one resolves.
    const withCorrection = [
      rev("r1", 24_000, "2026-01-01", "2026-01-01T09:00:00.000Z"),
      rev("r1b", 25_000, "2026-01-01", "2026-01-01T17:30:00.000Z"),
    ];
    expect(effectiveRateOn(withCorrection, "2026-03-01")?.id).toBe("r1b");
    expect(effectiveRateOn(withCorrection, "2026-03-01")?.ratePaise).toBe(25_000);
  });

  it("handles three or more revisions", () => {
    const three = [...HISTORY, rev("r3", 28_000, "2028-01-01", "2027-12-01T09:00:00.000Z")];
    expect(effectiveRateOn(three, "2026-05-01")?.ratePaise).toBe(24_000);
    expect(effectiveRateOn(three, "2027-05-01")?.ratePaise).toBe(26_000);
    expect(effectiveRateOn(three, "2029-05-01")?.ratePaise).toBe(28_000);
  });

  it("a later revision does not change what an earlier date resolves to", () => {
    // The immutability guarantee, stated directly: adding history to the future
    // must never rewrite the past.
    const before = effectiveRateOn(HISTORY, "2026-06-15")?.ratePaise;
    const after = effectiveRateOn(
      [...HISTORY, rev("r9", 99_000, "2028-01-01", "2027-11-01T09:00:00.000Z")],
      "2026-06-15",
    )?.ratePaise;
    expect(after).toBe(before);
  });
});

describe("rateBands", () => {
  const full = (
    id: string,
    ratePaise: number,
    effectiveFrom: string,
    createdAt = "2026-01-01T00:00:00.000Z",
    reason: string | null = null,
  ): RateRevision => ({
    id,
    scopeItemId: "s1",
    ratePaise,
    rateUnit: "day",
    effectiveFrom,
    reason,
    createdByName: "Owner",
    createdAt,
  });

  it("derives contiguous ranges, the newest left open", () => {
    const bands = rateBands([
      full("r1", 24_000, "2026-01-01", "2026-01-01T09:00:00.000Z", "Original agreement"),
      full("r2", 26_000, "2027-01-01", "2026-12-20T09:00:00.000Z", "Project duration extension"),
    ]);

    expect(bands).toHaveLength(2);
    expect(bands[0]).toMatchObject({
      fromDate: "2026-01-01",
      toDate: "2026-12-31",
      ratePaise: 24_000,
      reason: "Original agreement",
    });
    expect(bands[1]).toMatchObject({
      fromDate: "2027-01-01",
      toDate: null,
      ratePaise: 26_000,
    });
  });

  it("orders oldest first regardless of input order", () => {
    const bands = rateBands([
      full("r2", 26_000, "2027-01-01"),
      full("r1", 24_000, "2026-01-01"),
    ]);
    expect(bands.map((b) => b.fromDate)).toEqual(["2026-01-01", "2027-01-01"]);
  });

  it("collapses a same-day correction to the winning revision only", () => {
    const bands = rateBands([
      full("r1", 24_000, "2026-01-01", "2026-01-01T09:00:00.000Z"),
      full("r1b", 25_000, "2026-01-01", "2026-01-01T17:30:00.000Z"),
    ]);
    expect(bands).toHaveLength(1);
    expect(bands[0].revisionId).toBe("r1b");
    expect(bands[0].ratePaise).toBe(25_000);
  });

  it("agrees with effectiveRateOn at every band boundary", () => {
    const revisions = [
      full("r1", 24_000, "2026-01-01", "2026-01-01T09:00:00.000Z"),
      full("r2", 26_000, "2027-01-01", "2026-12-20T09:00:00.000Z"),
      full("r3", 28_000, "2028-06-01", "2028-05-01T09:00:00.000Z"),
    ];
    for (const band of rateBands(revisions)) {
      expect(effectiveRateOn(revisions, band.fromDate)?.ratePaise).toBe(band.ratePaise);
      if (band.toDate) {
        expect(effectiveRateOn(revisions, band.toDate)?.ratePaise).toBe(band.ratePaise);
      }
    }
  });

  it("crosses a month and a year boundary correctly", () => {
    const bands = rateBands([
      full("a", 10_000, "2026-02-01"),
      full("b", 20_000, "2026-03-01"),
      full("c", 30_000, "2027-01-01"),
    ]);
    expect(bands[0].toDate).toBe("2026-02-28");
    expect(bands[1].toDate).toBe("2026-12-31");
    expect(bands[2].toDate).toBeNull();
  });

  it("handles a leap-day boundary", () => {
    const bands = rateBands([full("a", 10_000, "2028-01-01"), full("b", 20_000, "2028-03-01")]);
    expect(bands[0].toDate).toBe("2028-02-29");
  });

  it("returns nothing for no revisions", () => {
    expect(rateBands([])).toEqual([]);
  });
});

describe("isValidISODate", () => {
  it("accepts real dates", () => {
    expect(isValidISODate("2026-01-01")).toBe(true);
    expect(isValidISODate("2028-02-29")).toBe(true); // leap year
  });

  it("rejects shapes that look right but aren't dates", () => {
    expect(isValidISODate("2026-13-45")).toBe(false);
    expect(isValidISODate("2026-02-30")).toBe(false);
    expect(isValidISODate("2027-02-29")).toBe(false); // not a leap year
    expect(isValidISODate("2026-1-1")).toBe(false);
    expect(isValidISODate("01-01-2026")).toBe(false);
    expect(isValidISODate("")).toBe(false);
  });
});

describe("validateRateRevision", () => {
  it("accepts a positive rate on or after the agreement start", () => {
    expect(
      validateRateRevision({
        ratePaise: 90_000,
        effectiveFrom: "2026-08-01",
        agreementStartDate: "2026-01-01",
      }),
    ).toBeNull();
  });

  it("accepts a back-dated revision within the agreement", () => {
    // Rates are often agreed verbally on site and entered days later.
    expect(
      validateRateRevision({
        ratePaise: 90_000,
        effectiveFrom: "2026-01-01",
        agreementStartDate: "2026-01-01",
      }),
    ).toBeNull();
  });

  it("rejects an effective date before the agreement existed", () => {
    expect(
      validateRateRevision({
        ratePaise: 90_000,
        effectiveFrom: "2025-12-31",
        agreementStartDate: "2026-01-01",
      }),
    ).toContain("before the agreement start date");
  });

  it("allows any date when the agreement has no start date", () => {
    expect(
      validateRateRevision({
        ratePaise: 90_000,
        effectiveFrom: "2020-01-01",
        agreementStartDate: null,
      }),
    ).toBeNull();
  });

  it("rejects zero, negative and non-integer rates", () => {
    for (const ratePaise of [0, -1, 90_000.5]) {
      expect(
        validateRateRevision({
          ratePaise,
          effectiveFrom: "2026-08-01",
          agreementStartDate: null,
        }),
      ).toContain("greater than zero");
    }
  });

  it("rejects an impossible calendar date", () => {
    expect(
      validateRateRevision({
        ratePaise: 90_000,
        effectiveFrom: "2026-13-45",
        agreementStartDate: null,
      }),
    ).toContain("valid date");
  });
});
