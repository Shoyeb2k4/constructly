import type { ProjectStage } from "./types";

/** Deadline (expected-completion) filters for the project list. */
export type DeadlineFilter = "ALL" | "OVERDUE" | "TODAY" | "WEEK" | "MONTH";

/** Today as an ISO date (YYYY-MM-DD) in local time. */
export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Add days to an ISO date, returning an ISO date. */
export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface DeadlineBounds {
  /** strictly-before (overdue) */
  lt?: string;
  gte?: string;
  lte?: string;
  /** overdue ignores already-closed projects */
  excludeClosed?: boolean;
}

/** Date bounds for a deadline filter, or null for "no deadline filter". */
export function deadlineBounds(kind: DeadlineFilter, today: string): DeadlineBounds | null {
  switch (kind) {
    case "OVERDUE":
      return { lt: today, excludeClosed: true };
    case "TODAY":
      return { gte: today, lte: today };
    case "WEEK":
      return { gte: today, lte: addDaysISO(today, 7) };
    case "MONTH":
      return { gte: today, lte: addDaysISO(today, 30) };
    default:
      return null;
  }
}

/** A project is overdue when its deadline has passed and it isn't closed. */
export function isOverdue(
  expectedCompletionDate: string | null,
  stage: ProjectStage,
  today: string = todayISO(),
): boolean {
  return !!expectedCompletionDate && expectedCompletionDate < today && stage !== "CLOSED";
}

/** Pure predicate used by the demo repository and tests. */
export function matchesDeadline(
  expectedCompletionDate: string | null,
  stage: ProjectStage,
  kind: DeadlineFilter,
  today: string,
): boolean {
  const b = deadlineBounds(kind, today);
  if (!b) return true;
  if (!expectedCompletionDate) return false; // undated projects match no deadline window
  if (b.excludeClosed && stage === "CLOSED") return false;
  if (b.lt != null && !(expectedCompletionDate < b.lt)) return false;
  if (b.gte != null && !(expectedCompletionDate >= b.gte)) return false;
  if (b.lte != null && !(expectedCompletionDate <= b.lte)) return false;
  return true;
}

/** Sort a list by deadline ascending, undated last. */
export function byDeadlineAsc(
  a: { expectedCompletionDate: string | null },
  b: { expectedCompletionDate: string | null },
): number {
  if (!a.expectedCompletionDate && !b.expectedCompletionDate) return 0;
  if (!a.expectedCompletionDate) return 1;
  if (!b.expectedCompletionDate) return -1;
  return a.expectedCompletionDate.localeCompare(b.expectedCompletionDate);
}
