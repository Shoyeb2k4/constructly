/**
 * Effective-dated agreement rates — PURE.
 *
 * An agreed rate is never overwritten. A revision is a new append-only row, and
 * so is a correction, which means the rate that applied on any past date stays
 * answerable forever. Construction projects routinely outrun their planned
 * duration and get renegotiated mid-flight (₹240/day from Jan 2026, ₹260/day
 * from Jan 2027) — historical attendance must keep valuing at the rate that was
 * actually in force on its own date.
 *
 * There is no `effectiveTo` column anywhere: ranges are DERIVED here, so there
 * is no closing-date invariant that can drift out of step with the next row.
 */

import type { Paise } from "@/lib/money";
import type { ISODate, RateBand, RateRevision } from "./types";

/** The minimum a revision needs for resolution. */
export interface RateRevisionEntry {
  id: string;
  ratePaise: Paise;
  rateUnit: string;
  effectiveFrom: ISODate;
  /** ISO timestamp; breaks ties when two revisions share an effectiveFrom. */
  createdAt: string;
}

/**
 * The revision in force on `date`: the latest `effectiveFrom <= date`, and when
 * several share that date the one created last — so a same-day correction
 * supersedes the row it corrects without deleting it.
 *
 * Returns null when the date precedes every revision, which lets the caller fall
 * through to the attendance-only rate and then the subcategory default.
 */
export function effectiveRateOn<T extends RateRevisionEntry>(
  revisions: T[],
  date: ISODate,
): T | null {
  let best: T | null = null;
  for (const r of revisions) {
    if (r.effectiveFrom > date) continue;
    if (
      best == null ||
      r.effectiveFrom > best.effectiveFrom ||
      (r.effectiveFrom === best.effectiveFrom && r.createdAt > best.createdAt)
    ) {
      best = r;
    }
  }
  return best;
}

/**
 * Contiguous, non-overlapping display bands, oldest first. A band runs until the
 * day before the next revision takes effect; the newest band is open-ended
 * (`toDate: null`).
 *
 * Same-day corrections collapse: only the winning revision for a given
 * effectiveFrom produces a band, so the timeline a user reads matches exactly
 * what `effectiveRateOn` would resolve.
 */
export function rateBands(revisions: RateRevision[]): RateBand[] {
  const winners = new Map<ISODate, RateRevision>();
  for (const r of revisions) {
    const prev = winners.get(r.effectiveFrom);
    if (!prev || r.createdAt > prev.createdAt) winners.set(r.effectiveFrom, r);
  }

  const ordered = [...winners.values()].sort((a, b) =>
    a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0,
  );

  return ordered.map((r, i) => ({
    revisionId: r.id,
    fromDate: r.effectiveFrom,
    toDate: i + 1 < ordered.length ? dayBefore(ordered[i + 1].effectiveFrom) : null,
    ratePaise: r.ratePaise,
    rateUnit: r.rateUnit,
    reason: r.reason,
  }));
}

/** Previous calendar day, in UTC so it never shifts across a DST boundary. */
function dayBefore(date: ISODate): ISODate {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date — "2026-13-45" matches the shape but isn't one. */
export function isValidISODate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Guard a proposed rate revision. Returns a user-facing message, or null when
 * it's acceptable.
 *
 * A revision may be back-dated (rates are often agreed verbally and entered
 * later) but never before the agreement itself started — a rate that applied
 * before there was an agreement to apply it to is a data-entry error.
 */
export function validateRateRevision(args: {
  ratePaise: Paise;
  effectiveFrom: ISODate;
  agreementStartDate: ISODate | null;
}): string | null {
  const { ratePaise, effectiveFrom, agreementStartDate } = args;

  if (!Number.isInteger(ratePaise) || ratePaise <= 0) {
    return "Rate must be greater than zero.";
  }
  if (!isValidISODate(effectiveFrom)) {
    return "Effective-from must be a valid date (YYYY-MM-DD).";
  }
  if (agreementStartDate != null && effectiveFrom < agreementStartDate) {
    return `Effective-from can't be before the agreement start date (${agreementStartDate}).`;
  }
  return null;
}
