import type { Permission } from "@/features/rbac/permissions";

/**
 * Server-safe report metadata — the report → class mapping used by both the
 * client (hub filtering, export buttons) and the server (page guards, export
 * authorization). Kept free of the registry's data-layer imports so it is safe
 * to import from server actions.
 *
 * Financial-class reports require reports.view_financial; everything else
 * requires reports.view_operational.
 *
 * The class is a LIST, not a category, because the catalogue is grouped by the
 * business question a report answers ("Payments", "Contractors") while the gate
 * is about how directly a report exposes company money. The two do not line up:
 * Budget vs Actual sits under Projects and is financial; Deadlines sits beside
 * it and is not.
 */
const FINANCIAL_REPORT_IDS = new Set<string>([
  "budget-vs-actual",
  // Cash movement and the contractor commercial position are the two reports
  // that expose company money directly, so they carry the financial gate.
  "payments",
  "contractor-position",
  "contractor-settlements",
]);

export function reportClass(reportId: string): "financial" | "operational" {
  return FINANCIAL_REPORT_IDS.has(reportId) ? "financial" : "operational";
}

/** The class-specific view permission a report requires. */
export function reportViewPermission(reportId: string): Permission {
  return reportClass(reportId) === "financial"
    ? "reports.view_financial"
    : "reports.view_operational";
}

/**
 * Can this permission-holder VIEW the report? Requires reports.view plus either
 * the broad reports.view_all or the report's class permission. Works with any
 * predicate — hasPermission(user, …) on the server, useCan() on the client.
 */
export function canViewReport(has: (p: Permission) => boolean, reportId: string): boolean {
  if (!has("reports.view")) return false;
  return has("reports.view_all") || has(reportViewPermission(reportId));
}

/** Additionally requires reports.export — report data is never exported unless
 *  BOTH visibility and export are satisfied. */
export function canExportReport(has: (p: Permission) => boolean, reportId: string): boolean {
  return canViewReport(has, reportId) && has("reports.export");
}
