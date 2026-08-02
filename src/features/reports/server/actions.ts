"use server";

import { requireUser } from "@/lib/auth/current-user";
import { hasPermission } from "@/lib/auth/permissions";
import { canViewReport } from "../report-meta";

/**
 * Server-first authorization for the reports layer. Reports are composed on the
 * client from other modules' already-permission-gated data APIs (so the row data
 * is protected); these actions add the reports-layer gates: report visibility
 * (incl. the financial/operational split) and — separately — export.
 */

/** View gate: reports.view + the report's class permission (or reports.view_all). */
export async function authorizeReportView(reportId: string): Promise<void> {
  const user = await requireUser();
  if (!canViewReport((p) => hasPermission(user, p), reportId)) throw new Error("FORBIDDEN");
}

/**
 * Export gate: report data must NOT leave via an export unless the caller can
 * both VIEW the report and holds reports.export. Called server-side before the
 * client builds the PDF/Excel — viewing never implies exporting.
 */
export async function authorizeReportExport(reportId: string): Promise<void> {
  const user = await requireUser();
  const has = (p: Parameters<typeof hasPermission>[1]) => hasPermission(user, p);
  if (!canViewReport(has, reportId)) throw new Error("FORBIDDEN");
  if (!has("reports.export")) throw new Error("FORBIDDEN");
}
