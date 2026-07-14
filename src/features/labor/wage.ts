import type { AttendanceStatus } from "./types";

/**
 * Wage computation — the single source of truth for pay math. Pure and
 * unit-tested. All values are integer paise.
 *
 *   base   = PRESENT → dailyWage | HALF_DAY → dailyWage/2 | ABSENT → 0
 *   otRate = dailyWage / 8  (per-hour day rate; configurable later)
 *   ot     = ABSENT ? 0 : round(otHours × otRate)
 *   payable = round(base) + ot
 *
 * The `wageRatePaise` returned is snapshotted onto the attendance row so that
 * later changes to a laborer's daily wage never rewrite historical cost.
 */
export function computeWage(
  dailyWagePaise: number,
  status: AttendanceStatus | null,
  otHours = 0,
): { wageRatePaise: number; wagePayablePaise: number } {
  if (status == null) return { wageRatePaise: dailyWagePaise, wagePayablePaise: 0 };

  const base =
    status === "PRESENT"
      ? dailyWagePaise
      : status === "HALF_DAY"
        ? Math.round(dailyWagePaise / 2)
        : 0;

  const ot =
    status === "ABSENT" ? 0 : Math.round((otHours || 0) * (dailyWagePaise / 8));

  return { wageRatePaise: dailyWagePaise, wagePayablePaise: base + ot };
}
