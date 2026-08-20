import { hasPermission } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/types";
import type { PaymentsVisibility } from "./types";

/**
 * What a caller may see in the Payments Centre, resolved from permissions alone.
 *
 * Each instrument is gated by the module that OWNS it, not by one blanket
 * payments permission: a user who may see vendor payments has not thereby been
 * granted the contractor ledger. `payments.view` gates the ROUTE; these gate the
 * CONTENT, so the page a storekeeper opens and the page an owner opens are the
 * same page showing different, correctly-scoped truths.
 */
export function paymentsVisibilityFor(user: SessionUser | null): PaymentsVisibility {
  return {
    vendorPayments: hasPermission(user, "payments.view"),
    agreementPayments: hasPermission(user, "contracts.view"),
    contractorLedger: hasPermission(user, "contractors.view"),
    // Company-wide advances carry no project, so no project filter can contain
    // them. The contractor ledger already reserves cross-project, unattributed
    // figures for `view_all`; this follows that rule rather than inventing a
    // looser one for the global page.
    companyWideAdvances: hasPermission(user, "contractors.view_all"),
  };
}

/**
 * Does this caller see every project's payments, or only the projects they
 * manage? Mirrors the dashboard's rule so two summaries of the same company
 * cannot disagree about scope.
 */
export function seesAllProjects(user: SessionUser | null): boolean {
  if (!user) return false;
  return (
    user.role === "OWNER" ||
    hasPermission(user, "projects.view_all") ||
    hasPermission(user, "payments.view_all")
  );
}
