import { REPORTS } from "@/features/reports/registry";
import { reportClass } from "@/features/reports/report-meta";
import type { Permission } from "./permissions";

/**
 * What each permission actually DOES, in the words of someone deciding whether
 * to grant it.
 *
 * The catalog gives every permission a verb — "View", "Edit", "Delete" — which
 * is enough to build a checkbox and not nearly enough to grant safely. "Delete"
 * under Projects and "Delete" under Payments are the same word for two very
 * different consequences, and `projects.view_all` sat beside `projects.view`
 * with nothing to say that one is a single project and the other is the whole
 * company. Someone granting access should not have to infer that from a key.
 *
 * Three things are recorded here and nowhere else:
 *
 *   WHAT IT ALLOWS   one sentence, consequence-first.
 *   SCOPE            project-scoped or company-wide — the distinction most
 *                    likely to be granted by accident.
 *   IMPACT           "high" where the permission can move money, rewrite
 *                    financial history, widen access, or destroy records.
 *
 * This is presentation metadata. It grants nothing, gates nothing and is never
 * consulted by a server action — the catalog and the server remain the only
 * authorities on what a permission means.
 */

/**
 * PROJECT — takes effect only on the projects the user is assigned to.
 * COMPANY — takes effect across the whole company, whatever they are assigned.
 * NONE    — not project-shaped at all (company settings, roles, billing).
 */
export type PermissionScope = "PROJECT" | "COMPANY" | "NONE";

export type PermissionImpact = "NORMAL" | "HIGH";

export interface PermissionMeta {
  /** One sentence, consequence-first. */
  description: string;
  scope: PermissionScope;
  impact: PermissionImpact;
  /** Why it is high impact, when that is not obvious from the description. */
  warning?: string;
}

const M = (
  description: string,
  scope: PermissionScope,
  impact: PermissionImpact = "NORMAL",
  warning?: string,
): PermissionMeta => ({ description, scope, impact, warning });

const COMPANY_WIDE_WARNING =
  "This is company-wide. It reveals every project, not only the ones this person is assigned to.";

export const PERMISSION_META: Record<Permission, PermissionMeta> = {
  /* ── Projects ────────────────────────────────────────────────────── */
  "projects.view": M("See the projects this person is assigned to.", "PROJECT"),
  "projects.create": M("Start a new project.", "COMPANY"),
  "projects.edit": M("Change details, budget and stage on their own projects.", "PROJECT"),
  "projects.archive": M("Take a project out of active lists, keeping its records.", "PROJECT"),
  "projects.delete": M(
    "Move a project to the Owner's recycle bin, hiding it and its records.",
    "PROJECT",
    "HIGH",
    "Deleting a project takes its labour, orders and payments out of every list and report.",
  ),
  "projects.assign": M("Add and remove the people who can work on a project.", "PROJECT"),
  "projects.view_all": M(
    "See every project in the company, including ones they are not assigned to.",
    "COMPANY",
    "HIGH",
    COMPANY_WIDE_WARNING,
  ),
  "projects.edit_all": M(
    "Change any project in the company, not only their own.",
    "COMPANY",
    "HIGH",
    COMPANY_WIDE_WARNING,
  ),

  /* ── Purchase orders ─────────────────────────────────────────────── */
  "purchase_orders.view": M("See purchase orders on their projects.", "PROJECT"),
  "purchase_orders.create": M("Raise a new purchase order.", "PROJECT"),
  "purchase_orders.edit": M("Change a draft order. Approved orders stay immutable.", "PROJECT"),
  "purchase_orders.approve": M(
    "Approve a submitted order, which commits its value to the project budget.",
    "PROJECT",
  ),
  "purchase_orders.reject": M("Send a submitted order back rather than approving it.", "PROJECT"),
  "purchase_orders.archive": M("Take an order out of active lists, keeping its record.", "PROJECT"),
  "purchase_orders.delete": M(
    "Permanently remove a purchase order.",
    "PROJECT",
    "HIGH",
    "The order and its budget impact disappear from every report.",
  ),
  "purchase_orders.view_all": M(
    "See purchase orders on every project in the company.",
    "COMPANY",
    "HIGH",
    COMPANY_WIDE_WARNING,
  ),
  "purchase_orders.edit_all": M(
    "Change purchase orders on any project.",
    "COMPANY",
    "HIGH",
    COMPANY_WIDE_WARNING,
  ),

  /* ── Labour types ────────────────────────────────────────────────── */
  "labour.view": M("See the labour categories and types used for attendance.", "COMPANY"),
  "labour.create": M("Add a labour category or type.", "COMPANY"),
  "labour.edit": M("Rename a labour type or change its daily rate for future work.", "COMPANY"),
  "labour.archive": M(
    "Remove a labour type from the attendance sheet.",
    "COMPANY",
    "HIGH",
    "Attendance already recorded keeps its value, but the type stops being available.",
  ),

  /* ── Attendance ──────────────────────────────────────────────────── */
  "attendance.view": M("See the daily attendance recorded on their projects.", "PROJECT"),
  "attendance.mark": M("Record who was present on site today.", "PROJECT"),
  "attendance.edit": M(
    "Correct attendance on a day that has been locked.",
    "PROJECT",
    "HIGH",
    "Locked days are closed on purpose; changing one moves recorded labour value.",
  ),
  "attendance.lock": M("Close a day so its attendance can no longer be edited.", "PROJECT"),
  "attendance.unlock": M("Reopen a closed day for correction.", "PROJECT"),
  "attendance.export": M("Download attendance records.", "PROJECT"),
  "attendance.view_all": M(
    "See attendance on every project in the company.",
    "COMPANY",
    "HIGH",
    COMPANY_WIDE_WARNING,
  ),

  /* ── Bills ───────────────────────────────────────────────────────── */
  "bills.view": M("See supplier bills.", "PROJECT"),
  "bills.create": M("Record a supplier bill.", "PROJECT"),
  "bills.edit": M("Change a bill that has not been approved.", "PROJECT"),
  "bills.approve": M("Approve a bill for payment.", "PROJECT"),
  "bills.archive": M("Take a bill out of active lists.", "PROJECT"),
  "bills.restore": M("Bring an archived bill back.", "PROJECT"),

  /* ── Payments ────────────────────────────────────────────────────── */
  "payments.view": M(
    "See vendor payments, and open the Payments centre. On its own this shows vendor money only — contractor advances and settlements need the Contractors permissions.",
    "PROJECT",
  ),
  "payments.create": M(
    "Record a payment to a vendor. This states that money left the company.",
    "PROJECT",
    "HIGH",
  ),
  "payments.edit": M("Correct a payment that has not been approved.", "PROJECT", "HIGH"),
  "payments.approve": M(
    "Approve a recorded payment. Deliberately separate from Edit, so one person does not both raise and authorise.",
    "PROJECT",
    "HIGH",
  ),
  "payments.cancel": M("Cancel a payment before it is approved.", "PROJECT", "HIGH"),
  "payments.delete": M(
    "Permanently remove a payment record.",
    "PROJECT",
    "HIGH",
    "The payment disappears from cash totals and from history. Vendor payments have no reversal, so this cannot be undone.",
  ),
  "payments.export": M("Download payment records.", "PROJECT"),
  "payments.view_all": M(
    "See payments across every project in the company.",
    "COMPANY",
    "HIGH",
    COMPANY_WIDE_WARNING,
  ),

  /* ── Contractors ─────────────────────────────────────────────────── */
  "contractors.view": M(
    "See a contractor's position on the projects this person is assigned to.",
    "PROJECT",
  ),
  "contractors.view_all": M(
    "See every contractor's full lifetime position, plus company-wide advances that belong to no project.",
    "COMPANY",
    "HIGH",
    "Company-wide advances carry no project, so no project assignment can limit what this reveals.",
  ),
  "contractors.create": M("Add a contractor.", "COMPANY"),
  "contractors.edit": M("Change a contractor's name or contact details.", "COMPANY"),
  "contractors.advance": M(
    "Hand a contractor cash ahead of the work. This is a real payment.",
    "PROJECT",
    "HIGH",
  ),
  "contractors.settle": M(
    "Run a weekly settlement: bill the labour, draw down any advance, and pay the balance.",
    "PROJECT",
    "HIGH",
  ),
  "contractors.settle_reverse": M(
    "Undo a settlement, returning its advance and cash to where they came from.",
    "PROJECT",
    "HIGH",
    "This rewrites recognised labour value and the contractor's advance balance.",
  ),
  "contractors.attribute_history": M(
    "Attach already-settled labour to an agreement after the fact.",
    "PROJECT",
    "HIGH",
    "This changes which agreement historical work was credited to.",
  ),
  "contractors.advance_rescope": M(
    "Move unused advance money between General, a project and an agreement — without paying anything again.",
    "PROJECT",
    "HIGH",
    "No cash moves, but it changes which work the money is available to settle against.",
  ),
  "contractors.archive": M(
    "Deactivate a contractor so they take on no new work.",
    "COMPANY",
    "HIGH",
    "Their agreements, settlements and ledger are kept in full.",
  ),
  "contractors.restore": M("Reactivate an archived contractor.", "COMPANY"),

  /* ── Agreements ──────────────────────────────────────────────────── */
  "contracts.view": M("See contractor agreements and their reconciliation.", "PROJECT"),
  "contracts.create": M("Create an agreement with a contractor.", "PROJECT"),
  "contracts.edit": M("Change scope, rates and milestones, and propose amendments.", "PROJECT"),
  "contracts.complete": M("Mark milestones or the agreement itself complete.", "PROJECT"),
  "contracts.amend_approve": M(
    "Approve an amendment, which is the only way to raise an agreement's authorised value.",
    "PROJECT",
    "HIGH",
    "Whoever edits an agreement should not also authorise the increase.",
  ),
  "contracts.cancel": M(
    "Cancel an agreement that already carries financial history.",
    "PROJECT",
    "HIGH",
  ),
  "contracts.delete": M(
    "Delete an agreement. Only ever appropriate for one that was never used.",
    "PROJECT",
    "HIGH",
  ),
  "contracts.pay": M(
    "Record a payment against an agreement. This states that money left the company.",
    "PROJECT",
    "HIGH",
  ),
  "contracts.pay_delete": M(
    "Reverse an agreement payment.",
    "PROJECT",
    "HIGH",
    "The payment stays visible as history but stops counting toward what has been credited.",
  ),

  /* ── Vendors ─────────────────────────────────────────────────────── */
  "vendors.view": M("See suppliers and their purchase history.", "PROJECT"),
  "vendors.create": M("Add a supplier.", "COMPANY"),
  "vendors.edit": M("Change a supplier's details.", "COMPANY"),
  "vendors.archive": M("Deactivate a supplier so no new orders can name them.", "COMPANY"),
  "vendors.restore": M("Reactivate an archived supplier.", "COMPANY"),
  "vendors.merge": M(
    "Merge two supplier records into one.",
    "COMPANY",
    "HIGH",
    "Orders and payments move to the surviving record; the merge cannot be undone.",
  ),
  "vendors.delete": M(
    "Permanently delete a supplier record.",
    "COMPANY",
    "HIGH",
    "Only ever appropriate for a supplier with no history.",
  ),
  "vendors.view_all": M(
    "See suppliers across every project.",
    "COMPANY",
    "HIGH",
    COMPANY_WIDE_WARNING,
  ),
  "vendors.edit_all": M("Change any supplier in the company.", "COMPANY", "HIGH"),

  /* ── Materials (master data) ─────────────────────────────────────── */
  "materials.view": M("See and search the catalogue of things the company buys.", "COMPANY"),
  "materials.create": M("Add an item to the catalogue that orders are raised against.", "COMPANY"),
  "materials.edit": M(
    "Rename a catalogue item or change its category, default unit or HSN code.",
    "COMPANY",
  ),
  "materials.archive": M(
    "Withdraw an item from the catalogue so it can no longer be ordered.",
    "COMPANY",
    "HIGH",
    "This applies to everyone at once. Orders already raised keep the name they recorded, but nobody can choose the item again until it is restored.",
  ),

  /* ── Reports ─────────────────────────────────────────────────────── */
  "reports.view": M(
    "Open the Reports centre. On its own this shows nothing — one of the two report classes below is also needed.",
    "PROJECT",
  ),
  "reports.export": M(
    "Download a report as Excel, CSV or PDF. Required on top of being able to view it.",
    "PROJECT",
  ),
  "reports.print": M("Print a report.", "PROJECT"),
  "reports.schedule": M("Schedule a report to run on a timetable.", "PROJECT"),
  "reports.view_financial": M(
    "See the reports that expose company money directly.",
    "PROJECT",
    "HIGH",
  ),
  "reports.view_operational": M("See the day-to-day reports that are not money-first.", "PROJECT"),
  "reports.view_all": M(
    "See every report, financial and operational alike.",
    "PROJECT",
    "HIGH",
    "This grants the financial class without it being chosen explicitly.",
  ),

  /* ── Users ───────────────────────────────────────────────────────── */
  "users.view": M("See who has access to this company.", "NONE"),
  "users.invite": M("Invite someone new into the company.", "NONE", "HIGH"),
  "users.edit": M("Change a person's details and which projects they manage.", "NONE", "HIGH"),
  "users.disable": M(
    "Disable someone's access.",
    "NONE",
    "HIGH",
    "They keep their history but can no longer sign in.",
  ),
  "users.delete": M("Remove a person from the company entirely.", "NONE", "HIGH"),

  /* ── Roles ───────────────────────────────────────────────────────── */
  "roles.view": M("See the roles defined for this company and what each allows.", "NONE"),
  "roles.create": M("Create a new custom role.", "NONE"),
  "roles.edit": M("Rename a role and change its description.", "NONE"),
  "roles.delete": M("Delete a custom role.", "NONE", "HIGH"),
  "roles.assign": M(
    "Decide which role a person holds, and therefore what they can do.",
    "NONE",
    "HIGH",
  ),
  "roles.manage_permissions": M(
    "Change what a role is allowed to do.",
    "NONE",
    "HIGH",
    "This changes access for everyone holding that role at once. Nobody can grant a permission they do not hold themselves.",
  ),

  /* ── Company ─────────────────────────────────────────────────────── */
  "company.view": M("See company details and branding.", "NONE"),
  "company.edit": M("Change the company's legal and tax identity.", "NONE", "HIGH"),
  "company.branding": M("Change the logo, colours and stamp used on documents.", "NONE"),
  "company.billing": M("See and change billing details.", "NONE", "HIGH"),
  "company.subscription": M("Change or cancel the subscription.", "NONE", "HIGH"),
  "company.api_keys": M(
    "Create and revoke API keys.",
    "NONE",
    "HIGH",
    "An API key can act on the company's data outside the app.",
  ),
  "company.integrations": M("Connect and disconnect third-party integrations.", "NONE", "HIGH"),
  "company.security": M("Change company security settings.", "NONE", "HIGH"),
};

export function permissionMeta(key: Permission): PermissionMeta {
  return (
    PERMISSION_META[key] ?? {
      description: "",
      scope: "NONE",
      impact: "NORMAL",
    }
  );
}

export const SCOPE_LABEL: Record<PermissionScope, string> = {
  PROJECT: "Assigned projects",
  COMPANY: "Company-wide",
  NONE: "Company-wide",
};

/**
 * Which reports each report-class permission actually unlocks, read from the
 * report registry rather than kept as a second hand-maintained list. Add a
 * report and this explanation updates itself.
 */
export function reportsUnlockedBy(permission: Permission): string[] {
  const wanted =
    permission === "reports.view_financial"
      ? "financial"
      : permission === "reports.view_operational"
        ? "operational"
        : null;
  if (permission === "reports.view_all") return REPORTS.map((r) => r.name);
  if (!wanted) return [];
  return REPORTS.filter((r) => reportClass(r.id) === wanted).map((r) => r.name);
}
