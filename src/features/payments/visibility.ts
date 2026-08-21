import type { Permission } from "@/features/rbac/permissions";
import type { SessionUser } from "@/lib/auth/types";
import type { PaymentsVisibility } from "./types";

/**
 * Local containment check, deliberately NOT `@/lib/auth/permissions`.
 *
 * That module also exports `requirePermission`, which imports `requireUser` →
 * `@/lib/supabase/server` → `next/headers`. Importing it here would drag the
 * server request stack into every client bundle that reaches this file — and it
 * did: the Reports catalogue is a client component, so `next/headers` ended up
 * in the browser graph and the whole `/reports` route 500'd.
 *
 * Resolving visibility is pure set membership over a resolved permission list.
 * It has no business depending on anything that can touch a cookie.
 */
function holds(user: SessionUser | null | undefined, permission: Permission): boolean {
  if (!user) return false;
  return (user.permissions ?? []).includes(permission);
}

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
    vendorPayments: holds(user, "payments.view"),
    agreementPayments: holds(user, "contracts.view"),
    contractorLedger: holds(user, "contractors.view"),
    // Company-wide advances carry no project, so no project filter can contain
    // them. The contractor ledger already reserves cross-project, unattributed
    // figures for `view_all`; this follows that rule rather than inventing a
    // looser one for the global page.
    companyWideAdvances: holds(user, "contractors.view_all"),
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
    holds(user, "projects.view_all") ||
    holds(user, "payments.view_all")
  );
}
