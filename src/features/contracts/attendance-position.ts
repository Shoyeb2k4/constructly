/**
 * Where a contractor's labour on a project sits — PURE.
 *
 * Every attendance row is in exactly one of three buckets, decided by two
 * fields it already carries:
 *
 *   UNSETTLED               settlementId == null
 *   SETTLED + ATTRIBUTED    settlementId != null AND contractId != null
 *   SETTLED + UNATTRIBUTED  settlementId != null AND contractId == null
 *
 * The value bucketed is `estimatedCostPaise`, which is quantity × the rate
 * SNAPSHOT taken when the row was recorded (ADR-0022). That is what makes these
 * figures stable: a later rate revision, an archive, a payment, a milestone or
 * an amendment cannot move them, because none of them rewrite a recorded row.
 *
 * SETTLED + UNATTRIBUTED is the figure the Command Centre used to hardcode to
 * zero. It is labour the contractor genuinely did and was genuinely paid for,
 * which no agreement has claimed — so it must be shown OUTSIDE every agreement
 * total. Reconciliation deliberately does not guess which agreement it belongs
 * to: attributing settled money after the fact is a governed correction, not a
 * display decision.
 *
 * One function, used by the production server, the demo repository and the
 * tests, so a React component never re-sums attendance and arrives at a second
 * answer.
 */

import type { Paise } from "@/lib/money";

/** One attendance row, reduced to the two fields that decide its bucket. */
export interface AttendanceBucketRow {
  estimatedCostPaise: Paise;
  settlementId: string | null;
  contractId: string | null;
}

export interface AttendancePosition {
  /** Recorded but not yet financially recognised by a settlement. */
  unsettledPaise: Paise;
  /** Settled, and claimed by an agreement — this is agreement attendance credit. */
  settledAttributedPaise: Paise;
  /** Settled, claimed by no agreement. Counted in NO agreement's credit. */
  settledUnattributedPaise: Paise;
}

export const EMPTY_POSITION: AttendancePosition = {
  unsettledPaise: 0,
  settledAttributedPaise: 0,
  settledUnattributedPaise: 0,
};

/**
 * Bucket rows. The three buckets partition the input exactly — every row lands
 * in one and only one, so `settled === attributed + unattributed` holds by
 * construction rather than by arithmetic that could drift.
 */
export function bucketAttendance(rows: AttendanceBucketRow[]): AttendancePosition {
  const out: AttendancePosition = { ...EMPTY_POSITION };
  for (const r of rows) {
    if (r.settlementId == null) out.unsettledPaise += r.estimatedCostPaise;
    else if (r.contractId != null) out.settledAttributedPaise += r.estimatedCostPaise;
    else out.settledUnattributedPaise += r.estimatedCostPaise;
  }
  return out;
}

/** Total settled labour — the two settled buckets, never including unsettled. */
export function settledPaise(p: AttendancePosition): Paise {
  return p.settledAttributedPaise + p.settledUnattributedPaise;
}

/** Sum positions across projects, bucket by bucket. */
export function sumPositions(positions: AttendancePosition[]): AttendancePosition {
  return positions.reduce<AttendancePosition>(
    (a, p) => ({
      unsettledPaise: a.unsettledPaise + p.unsettledPaise,
      settledAttributedPaise: a.settledAttributedPaise + p.settledAttributedPaise,
      settledUnattributedPaise: a.settledUnattributedPaise + p.settledUnattributedPaise,
    }),
    { ...EMPTY_POSITION },
  );
}

/** True when there is settled labour no agreement has claimed. */
export function hasUnattributed(p: AttendancePosition): boolean {
  return p.settledUnattributedPaise > 0;
}
