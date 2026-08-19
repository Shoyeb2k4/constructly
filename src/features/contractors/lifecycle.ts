/**
 * Contractor lifecycle — PURE.
 *
 * The model is deliberately the one already in the schema: `status` is
 * ACTIVE or INACTIVE, and INACTIVE **is** archived. No `archivedAt` column is
 * added, because a contractor is the same kind of long-lived master data as a
 * vendor, and vendors already express exactly this with a two-state status plus
 * `vendors.archive` / `vendors.restore`. Following that costs no migration and
 * leaves one thing to reason about instead of two.
 *
 * What ARCHIVED means, precisely:
 *
 *   • Everything already recorded stays. Agreements, milestones, amendments,
 *     payments, settlements, attendance and the advance ledger are untouched and
 *     fully readable. Archiving is never a delete.
 *   • No NEW OPERATIONAL WORK is taken on: no new agreement, no new advance, no
 *     new attendance, and the contractor cannot be added to another project.
 *   • FINANCIAL CLOSURE stays open. This is the half that is easy to get wrong.
 *     A SETTLEMENT is deliberately NOT on the blocked list: it does not commit
 *     the contractor to anything, it recognises labour that was already
 *     recorded. Blocking it would let archiving strand a real liability —
 *     ₹5,00,000 of August attendance that can never be paid because the crew
 *     left in September. Since new attendance stops at archive, everything a
 *     post-archive settlement can bill is by construction pre-archive work.
 *   • CORRECTIONS stay open for the same reason. A settlement recorded before
 *     archiving may still need reversing afterwards, a payment may still need
 *     reversing, an agreement may still need amending or cancelling, and an
 *     unsettled attendance row recorded while active may still hold a wrong
 *     headcount that must be fixed before it is billed.
 *
 * The distinction that matters is NEW OPERATIONAL WORK versus CLOSING OR
 * CORRECTING WORK ALREADY RECORDED — not "read versus write", and not "money
 * versus not money".
 */

import type { ContractorStatus } from "./types";

/**
 * Operations that commit a contractor to work not yet done.
 *
 * CREATE_SETTLEMENT is pointedly absent. A settlement is the financial
 * recognition of attendance already on record — closure, not commitment — so it
 * stays available while archived. See the module note above.
 */
export type NewBusinessAction =
  | "RECORD_ADVANCE"
  | "RECORD_ATTENDANCE"
  | "CREATE_AGREEMENT"
  | "ASSIGN_TO_PROJECT"
  | "REVISE_RATE";

const NEW_BUSINESS_LABEL: Record<NewBusinessAction, string> = {
  RECORD_ADVANCE: "record a labour advance for",
  RECORD_ATTENDANCE: "record new attendance for",
  CREATE_AGREEMENT: "create an agreement for",
  ASSIGN_TO_PROJECT: "assign",
  REVISE_RATE: "agree a new rate with",
};

export function isArchived(status: ContractorStatus): boolean {
  return status === "INACTIVE";
}

/**
 * Why this new-business action is unavailable, or null when it is allowed.
 *
 * Closure and correction deliberately never reach this function: SETTLING
 * attendance already recorded, reversing a settlement or a payment, amending or
 * cancelling an agreement, correcting an existing unsettled attendance row, and
 * editing the contractor's own details all remain available while archived.
 */
export function newBusinessBlockedReason(
  status: ContractorStatus,
  action: NewBusinessAction,
  contractorName?: string,
): string | null {
  if (!isArchived(status)) return null;
  const who = contractorName ?? "this contractor";
  return (
    `${who} is archived, so you can't ${NEW_BUSINESS_LABEL[action]} them. ` +
    `Restore them first. Everything already recorded stays exactly as it is, and ` +
    `closing it out stays available while archived — attendance recorded before ` +
    `archiving can still be settled, and a settlement, payment or agreement can ` +
    `still be reversed, amended or corrected.`
  );
}

/* ── Duplicate detection ────────────────────────────────────────────────── */

/**
 * The comparison key for "is this the same contractor twice?".
 *
 * Case- and spacing-insensitive, because "Pappu  Contractor" and "pappu
 * contractor" are the same person to everyone except a database. Punctuation is
 * kept: "R.K. Builders" and "RK Builders" may genuinely be different firms, and
 * guessing wrong is worse than asking.
 */
export function contractorNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Digits only, so "+91 98200 77889" and "9820077889" compare equal. */
export function contractorPhoneKey(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  // Indian mobile numbers are often stored with and without the country code.
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  return local.length >= 6 ? local : null;
}

export interface DuplicateMatch {
  id: string;
  name: string;
  phone: string | null;
  status: ContractorStatus;
  /** NAME is the strong signal; PHONE catches a rename of the same party. */
  on: "NAME" | "PHONE";
}

/**
 * Existing contractors that look like the one being created.
 *
 * A WARNING, not a constraint. Two genuinely different crews can share a common
 * name, and refusing the second outright would leave a user unable to record
 * work that really happened. The server surfaces the match and lets the user
 * confirm — the same shape as an over-covered milestone plan.
 */
export function findDuplicates(
  candidate: { name: string; phone?: string | null },
  existing: { id: string; name: string; phone: string | null; status: ContractorStatus }[],
): DuplicateMatch[] {
  const nameKey = contractorNameKey(candidate.name);
  const phoneKey = contractorPhoneKey(candidate.phone);

  const matches = new Map<string, DuplicateMatch>();
  for (const c of existing) {
    if (contractorNameKey(c.name) === nameKey) {
      matches.set(c.id, { id: c.id, name: c.name, phone: c.phone, status: c.status, on: "NAME" });
    } else if (phoneKey && contractorPhoneKey(c.phone) === phoneKey) {
      matches.set(c.id, { id: c.id, name: c.name, phone: c.phone, status: c.status, on: "PHONE" });
    }
  }
  return [...matches.values()];
}

/** How the warning reads. */
export function describeDuplicates(matches: DuplicateMatch[]): string {
  if (matches.length === 0) return "";
  const [first] = matches;
  const archived = first.status === "INACTIVE" ? " (archived)" : "";
  if (matches.length === 1) {
    return first.on === "NAME"
      ? `A contractor called "${first.name}"${archived} already exists.`
      : `"${first.name}"${archived} already has this mobile number.`;
  }
  return `${matches.length} existing contractors look like this one, including "${first.name}"${archived}.`;
}

/* ── Error presentation ─────────────────────────────────────────────────── */

/**
 * Contractor-domain refusals, keyed by the code the server throws.
 *
 * Several arrive as `CODE: sentence` — the server already wrote the better
 * message, so the suffix wins. Anything unrecognised (including a masked
 * production Server Action digest) falls back to the caller's description
 * rather than leaking internals.
 */
const ERROR_TEXT: Record<string, string> = {
  CONTRACTOR_ARCHIVED:
    "This contractor is archived, so they can't take on new work. Restore them first. Work already recorded can still be settled and corrected.",
  USE_ARCHIVE:
    "Use Archive or Restore to change a contractor's status — it is a lifecycle decision, not a detail edit.",
  ALREADY_ARCHIVED: "This contractor is already archived.",
  NOT_ARCHIVED: "This contractor is already active.",
  NOT_FOUND: "That contractor no longer exists.",
  FORBIDDEN: "You don't have access to this contractor.",
  SETTLEMENT_ALREADY_REVERSED: "This settlement has already been reversed.",
  REVERSAL_REASON_REQUIRED: "A reversal needs a reason.",
  SETTLEMENT_PERIOD_OVERLAPS:
    "Some attendance in this period has already been settled. Choose a period after the last settled date, or reverse that settlement first.",
  ADVANCE_NOT_ALLOCATABLE:
    "The requested adjustment can't be drawn from advances this period's labour has a claim on.",
  INVALID_AGREEMENT_SCOPE:
    "That agreement doesn't belong to this contractor on this project.",
  UNAUTHENTICATED: "Your session has expired. Sign in again to continue.",
};

export function describeContractorError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!raw) return fallback;
  const [code, ...rest] = raw.split(":");
  const detail = rest.join(":").trim();
  const known = ERROR_TEXT[code.trim()];
  if (known) return detail || known;
  return fallback;
}
