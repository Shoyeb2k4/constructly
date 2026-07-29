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
    module: "attendance",
    label: "Attendance",
    actions: [
      { key: "attendance.view", label: "View" },
      { key: "attendance.mark", label: "Mark" },
      { key: "attendance.edit", label: "Edit" },
      { key: "attendance.lock", label: "Lock" },
      { key: "attendance.export", label: "Export" },
    ],
  },
  {
    module: "payments",
    label: "Bills & Payments",
    actions: [
      { key: "payments.view", label: "View" },
      { key: "payments.create", label: "Create" },
      { key: "payments.edit", label: "Edit" },
      { key: "payments.approve", label: "Approve" },
      { key: "payments.delete", label: "Delete", danger: true },
    ],
  },
  {
    module: "vendors",
    label: "Vendors",
    actions: [
      { key: "vendors.view", label: "View" },
      { key: "vendors.create", label: "Create" },
      { key: "vendors.edit", label: "Edit" },
      { key: "vendors.delete", label: "Delete", danger: true },
    ],
  },
  {
    module: "reports",
    label: "Reports",
    actions: [
      { key: "reports.view", label: "View" },
      { key: "reports.export", label: "Export" },
      { key: "reports.print", label: "Print" },
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
