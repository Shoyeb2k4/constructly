/**
 * RBAC permission catalog — the single source of truth for every permission in
 * the system. Both the UI (Settings → Roles & Permissions, sidebar visibility)
 * and the server (requirePermission) import from here, so a permission only ever
 * exists in one place.
 *
 * Permission keys are `<module>.<action>` strings. The catalog is `as const` so
 * the `Permission` type is the exact union of every key — a typo in a check is a
 * compile error, not a silent security hole.
 *
 * NOTE (Phase 1): this catalog is defined and loaded into the session, but NOT
 * yet enforced anywhere. The legacy OWNER/PROJECT_MANAGER checks remain
 * authoritative until the Phase 2 enforcement swap.
 */

export const PERMISSION_CATALOG = [
  {
    module: "projects",
    label: "Projects",
    actions: [
      { key: "projects.view", label: "View" },
      { key: "projects.create", label: "Create" },
      { key: "projects.edit", label: "Edit" },
      { key: "projects.archive", label: "Archive" },
      { key: "projects.delete", label: "Delete", danger: true },
      { key: "projects.assign", label: "Assign Members" },
      // Scope grants: hold projects to the user's assigned set unless granted.
      { key: "projects.view_all", label: "View All Projects" },
      { key: "projects.edit_all", label: "Edit Any Project", danger: true },
    ],
  },
  {
    module: "purchase_orders",
    label: "Purchase Orders",
    actions: [
      { key: "purchase_orders.view", label: "View" },
      { key: "purchase_orders.create", label: "Create" },
      { key: "purchase_orders.edit", label: "Edit" },
      { key: "purchase_orders.approve", label: "Approve" },
      { key: "purchase_orders.reject", label: "Reject" },
      { key: "purchase_orders.archive", label: "Archive" },
      { key: "purchase_orders.delete", label: "Delete", danger: true },
      // Scope grants: hold POs to the user's assigned projects / draft-only edits.
      { key: "purchase_orders.view_all", label: "View All POs" },
      { key: "purchase_orders.edit_all", label: "Edit Any PO", danger: true },
    ],
  },
  {
    module: "labour",
    label: "Labour",
    // Master data (categories/subcategories) — kept in its own namespace,
    // separate from the transactional attendance permissions below.
    actions: [
      { key: "labour.view", label: "View" },
      { key: "labour.create", label: "Create" },
      { key: "labour.edit", label: "Edit" },
      { key: "labour.archive", label: "Archive / remove", danger: true },
    ],
  },
  {
    module: "attendance",
    label: "Attendance",
    // Transactional records — independent namespace. `edit` is required to change
    // a record in a LOCKED period; lock/unlock gate the locking workflow.
    actions: [
      { key: "attendance.view", label: "View" },
      { key: "attendance.mark", label: "Mark" },
      { key: "attendance.edit", label: "Edit locked records" },
      { key: "attendance.lock", label: "Lock" },
      { key: "attendance.unlock", label: "Unlock" },
      { key: "attendance.export", label: "Export" },
      { key: "attendance.view_all", label: "View All Attendance" },
    ],
  },
  {
    module: "bills",
    label: "Bills",
    // Financial-workflow lifecycle for vendor bills/invoices. Reserved: a
    // dedicated bills entity is a future feature — permissions are defined now so
    // roles can be configured ahead of the workflow landing.
    actions: [
      { key: "bills.view", label: "View" },
      { key: "bills.create", label: "Create" },
      { key: "bills.edit", label: "Edit" },
      { key: "bills.approve", label: "Approve" },
      { key: "bills.archive", label: "Archive" },
      { key: "bills.restore", label: "Restore" },
    ],
  },
  {
    module: "payments",
    label: "Payments",
    // Financial workflow, not generic CRUD. approve is a DEDICATED permission
    // (never part of edit); cancel/delete are privileged. Once a payment is
    // approved/posted, ordinary edit can no longer modify it (see
    // payment-workflow.ts — prepared for the future maker-checker workflow).
    actions: [
      { key: "payments.view", label: "View" },
      { key: "payments.create", label: "Create" },
      { key: "payments.edit", label: "Edit" },
      { key: "payments.approve", label: "Approve" },
      { key: "payments.cancel", label: "Cancel" },
      { key: "payments.delete", label: "Delete", danger: true },
      { key: "payments.export", label: "Export" },
      { key: "payments.view_all", label: "View All Payments" },
    ],
  },
  {
    module: "vendors",
    label: "Vendors",
    // Lifecycle (not just CRUD): vendors are long-lived master data. Prefer
    // archive/restore; permanent delete + merge are privileged, rare operations.
    actions: [
      { key: "vendors.view", label: "View" },
      { key: "vendors.create", label: "Create" },
      { key: "vendors.edit", label: "Edit" },
      { key: "vendors.archive", label: "Archive (deactivate)" },
      { key: "vendors.restore", label: "Restore (reactivate)" },
      { key: "vendors.merge", label: "Merge", danger: true },
      { key: "vendors.delete", label: "Delete permanently", danger: true },
      { key: "vendors.view_all", label: "View All Vendors" },
      { key: "vendors.edit_all", label: "Edit Any Vendor", danger: true },
    ],
  },
  {
    module: "reports",
    label: "Reports",
    // Viewing is distinct from exporting; financial reports need a dedicated
    // permission separate from operational ones.
    actions: [
      { key: "reports.view", label: "View" },
      { key: "reports.export", label: "Export" },
      { key: "reports.print", label: "Print" },
      { key: "reports.schedule", label: "Schedule" },
      { key: "reports.view_financial", label: "View Financial Reports" },
      { key: "reports.view_operational", label: "View Operational Reports" },
      { key: "reports.view_all", label: "View All Reports" },
    ],
  },
  {
    module: "users",
    label: "Users & Roles",
    actions: [
      { key: "users.invite", label: "Invite Users" },
      { key: "users.edit", label: "Edit Users" },
      { key: "users.disable", label: "Disable Users", danger: true },
      { key: "users.create_roles", label: "Create Roles" },
      { key: "users.manage_permissions", label: "Manage Permissions", danger: true },
    ],
  },
  {
    module: "company",
    label: "Company Settings",
    actions: [
      { key: "company.view", label: "View" },
      { key: "company.edit", label: "Edit" },
      { key: "company.branding", label: "Branding" },
      { key: "company.billing", label: "Billing" },
      { key: "company.subscription", label: "Subscription" },
      { key: "company.api_keys", label: "API Keys" },
    ],
  },
] as const;

/** A module key (e.g. "projects", "purchase_orders"). */
export type PermissionModule = (typeof PERMISSION_CATALOG)[number]["module"];

/** The exact union of every permission key in the catalog. */
export type Permission = (typeof PERMISSION_CATALOG)[number]["actions"][number]["key"];

/** Flat list of every permission key. */
export const ALL_PERMISSIONS: Permission[] = PERMISSION_CATALOG.flatMap((m) =>
  m.actions.map((a) => a.key),
);

/** All module keys, in catalog (sidebar) order. */
export const PERMISSION_MODULES: PermissionModule[] = PERMISSION_CATALOG.map((m) => m.module);

const PERMISSION_SET: ReadonlySet<string> = new Set(ALL_PERMISSIONS);

/** Type guard: is this string a known permission? */
export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

/** The module a permission belongs to ("projects.delete" → "projects"). */
export function moduleOf(permission: Permission): PermissionModule {
  return permission.slice(0, permission.indexOf(".")) as PermissionModule;
}

/** Sensitive/destructive permissions (metadata) — e.g. for highlighting or an
 *  extra confirmation in the Roles & Permissions UI. */
export const DANGER_PERMISSIONS: Permission[] = PERMISSION_CATALOG.flatMap((m) =>
  m.actions.filter((a) => "danger" in a && a.danger).map((a) => a.key),
);

/** Is this a wildcard grant — "*" (all) or "<module>.*" (whole module)? */
export function isWildcard(value: string): boolean {
  return value === "*" || /^[a-z_]+\.\*$/.test(value);
}

/**
 * Expand a stored permission list into concrete permission keys, resolving
 * wildcards: "*" → every permission, "<module>.*" → that module's permissions.
 * Unknown/invalid entries are dropped. Keeping the session's permission set
 * concrete means checks stay a simple membership test (no glob at call time).
 */
export function expandPermissions(stored: string[]): Permission[] {
  const out = new Set<Permission>();
  for (const entry of stored) {
    if (entry === "*") {
      for (const p of ALL_PERMISSIONS) out.add(p);
    } else if (entry.endsWith(".*")) {
      const mod = entry.slice(0, -2);
      for (const p of ALL_PERMISSIONS) if (moduleOf(p) === mod) out.add(p);
    } else if (isPermission(entry)) {
      out.add(entry);
    }
  }
  return [...out];
}
