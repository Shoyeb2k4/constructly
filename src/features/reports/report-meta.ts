import type { Permission } from "@/features/rbac/permissions";

/**
 * Server-safe report metadata — the report → class mapping used by both the
 * client (hub filtering, export buttons) and the server (page guards, export
 * authorization). Kept free of the registry's data-layer imports so it is safe
 * to import from server actions.
 *
 * Financial-class reports require reports.view_financial; everything else
 * requires reports.view_operational. Keep FINANCIAL_REPORT_IDS in sync with the
 * registry's `category: "Financial"` reports.
 */
const FINANCIAL_REPORT_IDS = new Set<string>(["budget-vs-actual"]);

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
