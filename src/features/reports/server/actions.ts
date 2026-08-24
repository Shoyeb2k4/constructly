"use server";

import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { canViewReport } from "../report-meta";
import type { ExportDecision } from "../authorization";

/**
 * Server-first authorization for the reports layer. Reports are composed on the
 * client from other modules' already-permission-gated data APIs (so the row data
 * is protected); these actions add the reports-layer gates: report visibility
 * (incl. the financial/operational split) and — separately — export.
 *
 * WHY THE EXPORT GATE RETURNS INSTEAD OF THROWING.
 *
 * It used to throw `new Error("FORBIDDEN")`, and the caller reported any
 * failure as "You don't have permission to export this report." That reading is
 * unsound across a Server Action boundary: in production Next MASKS errors
 * thrown in a Server Action, replacing the message with an opaque digest. The
 * client therefore could not tell a genuine denial from an expired session, a
 * stale action id after a deploy, or a network failure — and confidently blamed
 * the user's permissions for all of them.
 *
 * A decision the caller must act on is a RESULT, not an exception. This follows
 * the precedent already set by the duplicate-project-code path. The gate itself
 * is unchanged: the same two checks, on the server, against the caller's real
 * resolved session.
 */

/** View gate: reports.view + the report's class permission (or reports.view_all). */
export async function authorizeReportView(reportId: string): Promise<void> {
  const user = await requireUser();
  if (!canViewReport((p) => hasPermission(user, p), reportId)) throw new Error("FORBIDDEN");
}

/**
 * Export gate: report data must NOT leave via an export unless the caller can
 * both VIEW the report and holds reports.export. Called before the client builds
 * the PDF/Excel — viewing never implies exporting.
 *
 * Returns the decision. `requireUser()` still throws when there is no session at
 * all, which the caller reports as "signed out" rather than as a denial.
 */
export async function authorizeReportExport(reportId: string): Promise<ExportDecision> {
  const user = await requireUser();
  const has = (p: Parameters<typeof hasPermission>[1]) => hasPermission(user, p);

  // Named separately so the caller can say WHICH gate refused — "you can't see
  // this report" and "you can see it but may not export it" send the reader to
  // different places.
  if (!canViewReport(has, reportId)) return { allowed: false, reason: "CANNOT_VIEW" };
  if (!has("reports.export")) return { allowed: false, reason: "CANNOT_EXPORT" };
  return { allowed: true };
}
