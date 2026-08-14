/**
 * System role definitions — the default roles seeded for every company. Roles
 * are DATA (stored per-company in the `roles` table); these presets are only the
 * initial permission sets used when seeding. Owners may later edit them, add
 * custom roles, etc. (Phase 4). The `owner` role is protected: it implicitly
 * holds every permission and can never be edited or deleted.
 *
 * Each company gets its OWN copy of these roles, so multi-tenant customisation
 * never leaks across companies.
 */

import { type Permission, ALL_PERMISSIONS } from "./permissions";

export type SystemRoleKey =
  | "owner"
  | "admin"
  | "project_manager"
  | "purchase_manager"
  | "site_engineer"
  | "accountant"
  | "supervisor";

export interface SystemRoleDef {
  key: SystemRoleKey;
  name: string;
  description: string;
  /** Owner is all-access + protected; its stored permission list is empty
   *  because access is implicit (see resolvePermissions). */
  isOwner?: boolean;
  permissions: Permission[];
}

// Admin = everything except owner-exclusive commercial controls.
const OWNER_ONLY: Permission[] = ["company.billing", "company.subscription", "company.api_keys"];
const ADMIN_PERMISSIONS: Permission[] = ALL_PERMISSIONS.filter((p) => !OWNER_ONLY.includes(p));

export const SYSTEM_ROLES: SystemRoleDef[] = [
  {
    key: "owner",
    name: "Owner",
    description: "Full, unrestricted access. Protected — always holds every permission.",
    isOwner: true,
    permissions: [], // implicit all-access
  },
  {
    key: "admin",
    name: "Admin",
    description: "Full operational access; excludes billing, subscription, and API keys.",
    permissions: ADMIN_PERMISSIONS,
  },
  {
    // Matches the legacy PROJECT_MANAGER exactly: can view/edit/archive their
    // ASSIGNED projects (no create/assign/delete, no *_all broad scope). Broader
    // capability is granted per-permission via the Roles UI in a later phase.
    key: "project_manager",
    name: "Project Manager",
    description: "Manages their assigned projects: view, edit, archive; raises POs.",
    permissions: [
      "projects.view",
      "projects.edit",
      "projects.archive",
      // Legacy: any member managed labour master data + marked attendance on
      // their assigned projects (no view_all, no lock/unlock).
      "labour.view",
      "labour.create",
      "labour.edit",
      "labour.archive",
      "attendance.view",
      "attendance.mark",
      "attendance.export",
      // Contractors: a PM sees the commercial position of contractors on their
      // OWN projects (contractors.view is project-scoped). No advance, no
      // settlement, no view_all.
      "contractors.view",
      // Agreements: PMs run their assigned projects' contractor work packages —
      // scope, rates, milestones — and record payments. Deliberately NOT
      // amend_approve (a PM proposes a value change, an Owner/Admin authorises
      // it), NOT cancel, and NOT delete/reverse.
      "contracts.view",
      "contracts.create",
      "contracts.edit",
      "contracts.complete",
      "contracts.pay",
      "vendors.view",
      // Legacy PROJECT_MANAGER could raise + edit draft POs on assigned projects
      // (no approve/delete, no broad scope).
      "purchase_orders.view",
      "purchase_orders.create",
      "purchase_orders.edit",
      // Legacy: PMs viewed + recorded vendor payments on their assigned projects
      // (no delete/approve).
      "payments.view",
      "payments.create",
      // Legacy: reports had no gating — any member viewed every report type and
      // exported. Report DATA is still scoped by the underlying module perms.
      "reports.view",
      "reports.view_financial",
      "reports.view_operational",
      "reports.export",
      "reports.print",
      // Legacy: everyone could VIEW company settings read-only (edit was
      // owner-only). No company.edit/branding for PMs.
      "company.view",
    ],
  },
  {
    key: "purchase_manager",
    name: "Purchase Manager",
    description: "Handles procurement: purchase orders and vendors.",
    permissions: [
      "projects.view",
      "purchase_orders.view",
      "purchase_orders.create",
      "purchase_orders.edit",
      "vendors.view",
      "vendors.create",
      "vendors.edit",
      "reports.view",
    ],
  },
  {
    key: "site_engineer",
    name: "Site Engineer",
    description: "Site operations: progress updates and attendance.",
    permissions: [
      "projects.view",
      "projects.edit",
      "attendance.view",
      "attendance.mark",
      "contracts.view",
    ],
  },
  {
    key: "accountant",
    name: "Accountant",
    description: "Finance: bills, payments, and financial reports.",
    permissions: [
      "payments.view",
      "payments.create",
      "payments.edit",
      // Contractors: the Accountant owns cash movement — advances and weekly
      // settlements, across every project. Reversal is deliberately excluded:
      // un-recognising settled labour is an Owner/Admin authority.
      "contractors.view",
      "contractors.view_all",
      "contractors.advance",
      "contractors.settle",
      // Agreement finance: view, record and reverse agreement payments.
      "contracts.view",
      "contracts.pay",
      "contracts.pay_delete",
      "purchase_orders.view",
      "vendors.view",
      "reports.view",
      "reports.export",
      "reports.print",
    ],
  },
  {
    key: "supervisor",
    name: "Supervisor",
    description: "Oversees site labour: view projects and mark attendance.",
    permissions: ["projects.view", "attendance.view", "attendance.mark", "contracts.view"],
  },
];

/**
 * Maps the legacy `User.role` enum to a seeded system role. Drives the one-time
 * backfill and the session fallback so behaviour is preserved during migration.
 */
export const LEGACY_ROLE_TO_KEY: Record<"OWNER" | "PROJECT_MANAGER", SystemRoleKey> = {
  OWNER: "owner",
  PROJECT_MANAGER: "project_manager",
};

export function systemRole(key: SystemRoleKey): SystemRoleDef {
  const def = SYSTEM_ROLES.find((r) => r.key === key);
  if (!def) throw new Error(`Unknown system role: ${key}`);
  return def;
}
