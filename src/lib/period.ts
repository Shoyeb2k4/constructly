/**
 * The app's period vocabulary.
 *
 * This was written for the Payments Centre and lives here now because Reports
 * needs exactly the same thing, and two modules resolving "this month" their own
 * way is how a total ends up labelled with a range it was not computed over.
 * One resolver; each surface picks which presets its menu offers.
 *
 * All arithmetic is UTC on YYYY-MM-DD strings, so a timezone can never shift a
 * period edge — the same bug that made attendance render two different dates on
 * server and client (React #418).
 */

export type PeriodPreset =
  | "TODAY"
  | "THIS_WEEK"
  | "THIS_MONTH"
  | "LAST_MONTH"
  | "LAST_90"
  | "FINANCIAL_YEAR"
  | "ALL_TIME"
  | "CUSTOM";

export interface Period {
  preset: PeriodPreset;
  /** Inclusive YYYY-MM-DD. Null on ALL_TIME — unbounded, and stated as such. */
  from: string | null;
  to: string | null;
  /** Always rendered beside a figure. A total with no period is a lie. */
  label: string;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthStart(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

function monthEnd(year: number, month: number): string {
  return addDays(monthStart(month === 11 ? year + 1 : year, (month + 1) % 12), -1);
}

/** Monday-start, matching how a site week is actually worked and paid. */
function weekStart(iso: string): string {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(iso, -((dow + 6) % 7));
}

/**
 * Resolve a preset against the viewer's today. The financial year is the Indian
 * one (1 April – 31 March) because that is the year this product's users close
 * their books on.
 */
export function resolvePeriod(
  preset: PeriodPreset,
  today: string,
  custom?: { from?: string | null; to?: string | null },
): Period {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7)) - 1;

  switch (preset) {
    case "TODAY":
      return { preset, from: today, to: today, label: "Today" };
    case "THIS_WEEK": {
      const start = weekStart(today);
      return { preset, from: start, to: addDays(start, 6), label: "This week" };
    }
    case "THIS_MONTH":
      return {
        preset,
        from: monthStart(year, month),
        to: monthEnd(year, month),
        label: `${MONTHS[month]} ${year}`,
      };
    case "LAST_MONTH": {
      const y = month === 0 ? year - 1 : year;
      const m = month === 0 ? 11 : month - 1;
      return { preset, from: monthStart(y, m), to: monthEnd(y, m), label: `${MONTHS[m]} ${y}` };
    }
    case "LAST_90":
      return { preset, from: addDays(today, -89), to: today, label: "Last 90 days" };
    case "FINANCIAL_YEAR": {
      const startYear = month >= 3 ? year : year - 1;
      return {
        preset,
        from: `${startYear}-04-01`,
        to: `${startYear + 1}-03-31`,
        label: `FY ${startYear}–${String(startYear + 1).slice(2)}`,
      };
    }
    case "CUSTOM": {
      const from = custom?.from || null;
      const to = custom?.to || null;
      const label =
        from && to ? `${from} to ${to}` : from ? `From ${from}` : to ? `Up to ${to}` : "All time";
      return { preset, from, to, label };
    }
    case "ALL_TIME":
    default:
      return { preset: "ALL_TIME", from: null, to: null, label: "All time" };
  }
}

export function inPeriod(date: string, period: { from: string | null; to: string | null }): boolean {
  if (period.from && date < period.from) return false;
  if (period.to && date > period.to) return false;
  return true;
}

/**
 * Recover a period from concrete bounds — used where a URL carries dates rather
 * than a preset, so the label still names the range instead of going blank.
 */
export function labelForBounds(from?: string | null, to?: string | null): string {
  return resolvePeriod("CUSTOM", from ?? "", { from, to }).label;
}
