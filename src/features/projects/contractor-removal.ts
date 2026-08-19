/**
 * Why a contractor cannot be removed from a project — PURE.
 *
 * Removing a contractor from a project deletes the `ProjectContractor` row and,
 * by cascade, its labour-rate rows. Nothing financial has a foreign key to that
 * row, so removal destroys no agreement, payment, milestone, amendment,
 * settlement or ledger entry — verified against the live schema. What it does is
 * make the relationship DISAPPEAR from the operational surfaces that read it:
 * the daily attendance sheet is built by walking `ProjectContractor`, so a live
 * agreement whose relationship is gone can no longer take labour even though the
 * contract is still owed.
 *
 * That is the defect this module guards. The rules below are deliberately the
 * smallest set that prevents an operationally broken state, rather than "block
 * whenever any history exists" — which would make every relationship permanent
 * and is not what the domain requires.
 */

import type { ContractStatus } from "@/features/contracts/types";

/** A live agreement standing in the way, named so the user can act on it. */
export interface BlockingAgreement {
  id: string;
  title: string;
  status: ContractStatus;
}

/** Everything preventing one contractor's removal from one project. */
export interface ContractorRemovalBlocker {
  contractorId: string;
  contractorName: string;
  /** Agreements that still need the relationship. CANCELLED ones are absent. */
  agreements: BlockingAgreement[];
  /** Attendance rows recorded for this contractor on this project. */
  attendanceCount: number;
  /** Weekly settlements recorded for this contractor on this project. */
  settlementCount: number;
}

/**
 * Agreement statuses that still require the project relationship.
 *
 * Everything except CANCELLED. The open statuses are obvious — they can still
 * take attendance. SETTLED is included because a close-out is reversible
 * (`SETTLED → COMPLETED`), so detaching a settled agreement would leave a
 * relationship-less live agreement one click away.
 *
 * CANCELLED is the one terminal state: ending an agreement is a deliberate,
 * separately-permissioned act that carries a reason, and reviving one is equally
 * deliberate. `setContractStatus` re-establishes the relationship when a
 * cancelled agreement is brought back, so nothing is left dangling.
 */
export function agreementBlocksRemoval(status: ContractStatus): boolean {
  return status !== "CANCELLED";
}

export function hasBlockers(b: ContractorRemovalBlocker): boolean {
  return b.agreements.length > 0 || b.attendanceCount > 0 || b.settlementCount > 0;
}

/**
 * One sentence per contractor, naming what is in the way.
 *
 * Written here rather than in a component because the same wording has to reach
 * a toast, a dialog and a test — and because Next masks Server Action messages
 * in production, so this text is built browser-side from a typed result rather
 * than thrown from the server.
 */
export function describeRemovalBlocker(
  b: ContractorRemovalBlocker,
  projectName?: string,
): string {
  const where = projectName ? ` from ${projectName}` : "";
  const parts: string[] = [];

  if (b.agreements.length === 1) {
    parts.push(`the agreement "${b.agreements[0].title}" is still live`);
  } else if (b.agreements.length > 1) {
    const names = b.agreements.map((a) => `"${a.title}"`).join(", ");
    parts.push(`${b.agreements.length} agreements are still live (${names})`);
  }
  if (b.attendanceCount > 0) {
    parts.push(
      `${b.attendanceCount} attendance record${b.attendanceCount === 1 ? " is" : "s are"} attributed to them here`,
    );
  }
  if (b.settlementCount > 0) {
    parts.push(
      `${b.settlementCount} settlement${b.settlementCount === 1 ? " has" : "s have"} been recorded on this project`,
    );
  }

  if (parts.length === 0) {
    return `${b.contractorName} can't be removed${where}.`;
  }

  const reason =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

  return `${b.contractorName} can't be removed${where} because ${reason}.`;
}

/** What the user can do about it — never "contact support". */
export function removalRemedy(b: ContractorRemovalBlocker): string {
  if (b.agreements.length > 0) {
    return "Cancel the agreement first if the work is genuinely not going ahead. Nothing is deleted — the agreement, its payments and its history all stay on record.";
  }
  return "The relationship explains how that history was attributed, so it stays. You can still remove individual labour types.";
}

/** The whole refusal, ready to show. */
export function describeRemovalBlockers(
  blockers: ContractorRemovalBlocker[],
  projectName?: string,
): string {
  if (blockers.length === 0) return "";
  if (blockers.length === 1) {
    return `${describeRemovalBlocker(blockers[0], projectName)} ${removalRemedy(blockers[0])}`;
  }
  return blockers.map((b) => describeRemovalBlocker(b, projectName)).join(" ");
}

/**
 * Thrown BROWSER-SIDE by the mutation hook when the server returns blockers.
 *
 * The server cannot throw this usefully: Next masks Server Action error messages
 * in production, so the reason would arrive as a generic failure. The server
 * returns a typed result; the client turns it back into an error so ordinary
 * react-query error handling still applies, with the blockers attached.
 */
export class ContractorRemovalBlockedError extends Error {
  constructor(readonly blockers: ContractorRemovalBlocker[]) {
    super("CONTRACTOR_REMOVAL_BLOCKED");
    this.name = "ContractorRemovalBlockedError";
  }
}
