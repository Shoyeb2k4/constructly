/**
 * Retention policy for soft-deleted projects.
 *
 * A soft-deleted project is recoverable **indefinitely by default**. A company
 * MAY set a retention window (in days); once that window elapses after deletion,
 * the project becomes *eligible* for a permanent, admin-reviewed cleanup — it is
 * never hard-deleted automatically. `null` days means "keep indefinitely / never
 * become eligible". The actual purge is an internal/admin-only operation (GDPR,
 * legal, storage) — see server/retention-cleanup.ts — and is intentionally kept
 * out of the normal user flow.
 */

const DAY_MS = 86_400_000;

/** Retention windows an Owner may choose (future-ready config). */
export const RETENTION_DAY_CHOICES = [30, 60, 90, 180] as const;
export type RetentionDays = (typeof RETENTION_DAY_CHOICES)[number] | null;

export const RETENTION_OPTIONS: { days: RetentionDays; label: string }[] = [
  { days: null, label: "Never — keep indefinitely" },
  { days: 30, label: "30 days" },
  { days: 60, label: "60 days" },
  { days: 90, label: "90 days" },
  { days: 180, label: "180 days" },
];

/** True for an accepted retention value (null or one of the fixed choices). */
export function isValidRetention(days: number | null): days is RetentionDays {
  return days === null || (RETENTION_DAY_CHOICES as readonly number[]).includes(days);
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * When a soft-deleted project becomes eligible for permanent cleanup. Returns
 * null when the project isn't deleted or retention is "indefinite" (null days).
 */
export function purgeEligibleAt(
  deletedAt: Date | string | null | undefined,
  retentionDays: number | null | undefined,
): Date | null {
  const d = toDate(deletedAt);
  if (!d || retentionDays == null) return null;
  return new Date(d.getTime() + retentionDays * DAY_MS);
}

/** Whether a soft-deleted project is past its retention window right now. */
export function isPurgeEligible(
  deletedAt: Date | string | null | undefined,
  retentionDays: number | null | undefined,
  now: Date = new Date(),
): boolean {
  const at = purgeEligibleAt(deletedAt, retentionDays);
  return at != null && at.getTime() <= now.getTime();
}

/** Human summary of the current policy, for owner-facing UI. */
export function retentionLabel(retentionDays: number | null | undefined): string {
  if (retentionDays == null) return "kept indefinitely";
  return `eligible for admin cleanup ${retentionDays} days after deletion`;
}
