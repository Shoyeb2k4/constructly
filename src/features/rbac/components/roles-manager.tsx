"use client";

import * as React from "react";
import {
  Plus,
  Copy,
  Trash2,
  Search,
  ShieldCheck,
  Save,
  Check,
  Lock,
  Layers,
  FolderKanban,
  ShoppingCart,
  HardHat,
  Handshake,
  CalendarCheck,
  ReceiptText,
  Wallet,
  FileSignature,
  Truck,
  BarChart3,
  Users,
  KeyRound,
  Building2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RowsSkeleton } from "@/components/patterns/loading-state";
import { Callout } from "@/components/patterns/callout";
import { cn } from "@/lib/utils";
import { useCan } from "../permission-context";
import {
  PERMISSION_CATALOG,
  ALL_PERMISSIONS,
  type Permission,
  type PermissionModule,
} from "../permissions";
import { useRoles, useCreateRole, useUpdateRole, useDuplicateRole, useDeleteRole } from "../hooks";
import { permissionMeta, reportsUnlockedBy, SCOPE_LABEL } from "../permission-meta";
import type { RoleDTO } from "../server/roles-actions";

/** Local editable copy of a role's grants while the admin is toggling. */
type Draft = { roleId: string; name: string; description: string; permissions: Set<string> };

/** One icon per module — used sparingly, only in the module rail + section heads. */
const MODULE_ICON: Record<PermissionModule, LucideIcon> = {
  projects: FolderKanban,
  purchase_orders: ShoppingCart,
  labour: HardHat,
  attendance: CalendarCheck,
  bills: ReceiptText,
  payments: Wallet,
  contracts: FileSignature,
  contractors: Handshake,
  vendors: Truck,
  reports: BarChart3,
  users: Users,
  roles: KeyRound,
  company: Building2,
};

export function RolesManager() {
  const can = useCan();
  const canCreate = can("roles.create");
  const canEditName = can("roles.edit");
  const canManagePerms = can("roles.manage_permissions");
  const canDelete = can("roles.delete");

  const { data: roles = [], isLoading } = useRoles();
  const create = useCreateRole();
  const update = useUpdateRole();
  const duplicate = useDuplicateRole();
  const del = useDeleteRole();

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [confirmDelete, setConfirmDelete] = React.useState<RoleDTO | null>(null);

  const selected = roles.find((r) => r.id === selectedId) ?? roles[0] ?? null;
  const isOwnerRole = !!selected?.isOwner;
  const isSystemRole = !!selected && selected.isSystem && !selected.isOwner;
  // Built-in roles are read-only templates: `reconcile-rbac.ts` rewrites them on
  // every Constructly update, so an edit here would be quietly discarded later.
  // Only CUSTOM roles are editable. The server enforces the same rule.
  const editable = !!selected && !selected.isSystem && !isOwnerRole && canManagePerms;
  const canEditMeta = !!selected && !selected.isSystem && !isOwnerRole && canEditName;
  const canDeleteSelected = !!selected && !selected.isSystem && !selected.isOwner && canDelete;

  // The permissions the current admin may grant (no privilege escalation).
  const grantable = React.useMemo(() => new Set(ALL_PERMISSIONS.filter((p) => can(p))), [can]);

  // Current permission set for the selected role — the live draft if we're editing
  // it, otherwise the role's stored set.
  const draftForSelected = selected && draft?.roleId === selected.id ? draft : null;
  const currentPerms: Set<string> = draftForSelected
    ? draftForSelected.permissions
    : new Set(selected?.permissions ?? []);

  const dirty =
    !!selected &&
    !!draftForSelected &&
    (draftForSelected.name !== selected.name ||
      draftForSelected.description !== (selected.description ?? "") ||
      !samePerms(draftForSelected.permissions, selected.permissions));

  // Keep the sticky module rail parked just below the sticky role header, whatever
  // its height (the editable meta inputs change it), so nothing overlaps.
  const headerRef = React.useRef<HTMLDivElement>(null);
  const [headerH, setHeaderH] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeaderH(el.offsetHeight));
    ro.observe(el);
    setHeaderH(el.offsetHeight);
    return () => ro.disconnect();
  }, [selected?.id, canEditMeta]);

  function beginDraft(role: RoleDTO): Draft {
    return {
      roleId: role.id,
      name: role.name,
      description: role.description ?? "",
      permissions: new Set(role.permissions),
    };
  }

  function mutateDraft(fn: (d: Draft) => void) {
    if (!selected) return;
    setDraft((prev) => {
      const base = prev && prev.roleId === selected.id ? { ...prev, permissions: new Set(prev.permissions) } : beginDraft(selected);
      fn(base);
      return base;
    });
  }

  function togglePerm(p: Permission) {
    if (!editable || !grantable.has(p)) return;
    mutateDraft((d) => {
      if (d.permissions.has(p)) d.permissions.delete(p);
      else d.permissions.add(p);
    });
  }

  function setModule(moduleKeys: Permission[], on: boolean) {
    if (!editable) return;
    mutateDraft((d) => {
      for (const p of moduleKeys) {
        if (!grantable.has(p)) continue; // never grant beyond your own permissions
        if (on) d.permissions.add(p);
        else d.permissions.delete(p);
      }
    });
  }

  function save() {
    if (!selected || !draftForSelected || !dirty) return;
    update.mutate(
      {
        id: selected.id,
        patch: {
          name: draftForSelected.name,
          description: draftForSelected.description,
          permissions: [...draftForSelected.permissions],
        },
      },
      { onSuccess: () => setDraft(null) },
    );
  }

  function submitCreate() {
    const name = newName.trim();
    if (name.length < 2) return;
    create.mutate(
      { name, permissions: [] },
      {
        onSuccess: (r) => {
          setCreateOpen(false);
          setNewName("");
          setSelectedId(r.id);
        },
      },
    );
  }

  function jumpTo(module: PermissionModule) {
    document.getElementById(`perm-${module}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const q = search.trim().toLowerCase();
  const effectiveCount = selected?.isOwner ? ALL_PERMISSIONS.length : currentPerms.size;

  // Per-module grant counts (drives the rail + section pills).
  const moduleGrant = (mod: (typeof PERMISSION_CATALOG)[number]) =>
    selected?.isOwner ? mod.actions.length : mod.actions.filter((a) => currentPerms.has(a.key)).length;

  const matchesQuery = (a: { key: string; label: string }) =>
    !q || a.label.toLowerCase().includes(q) || a.key.toLowerCase().includes(q);

  if (isLoading) return <RowsSkeleton rows={6} />;

  return (
    <div className="grid gap-6 lg:grid-cols-[248px_minmax(0,1fr)]">
      {/* ── Role list ─────────────────────────────────────────────── */}
      <aside className="lg:sticky lg:top-4 lg:self-start">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">Roles</h3>
          {canCreate && (
            <Button variant="ghost" size="sm" className="-mr-2 h-8" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              New
            </Button>
          )}
        </div>
        <div className="space-y-1">
          {roles.map((r) => {
            const active = selected?.id === r.id;
            return (
              <button
                key={r.id}
                onClick={() => setSelectedId(r.id)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "group flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                  active
                    ? "bg-primary-subtle text-primary-emphasis ring-1 ring-inset ring-primary/20"
                    : "text-foreground hover:bg-surface-muted",
                )}
              >
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-md",
                    r.isOwner
                      ? "bg-primary/15 text-primary"
                      : r.isSystem
                        ? "bg-surface-muted text-foreground-subtle"
                        : "bg-surface-muted text-foreground-muted",
                  )}
                >
                  {r.isOwner ? <ShieldCheck className="size-3.5" /> : r.isSystem ? <Layers className="size-3.5" /> : <KeyRound className="size-3.5" />}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-1.5 py-0.5 text-[11px] tabular-nums",
                    active ? "bg-primary/15 text-primary" : "bg-surface-muted text-foreground-subtle",
                  )}
                >
                  {r.memberCount}
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      {/* ── Permission editor ─────────────────────────────────────── */}
      {selected && (
        <Card className="overflow-visible p-0">
          {/* Sticky role information header */}
          <div
            ref={headerRef}
            className="sticky top-0 z-20 space-y-4 rounded-t-xl border-b border-border bg-surface/95 px-6 py-5 backdrop-blur supports-[backdrop-filter]:bg-surface/80"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold leading-none tracking-tight">{selected.name}</h2>
                  {selected.isOwner ? (
                    <>
                      <Badge variant="primary">Owner</Badge>
                      <Badge variant="outline">Full access</Badge>
                    </>
                  ) : selected.isSystem ? (
                    <>
                      <Badge variant="neutral">Built-in</Badge>
                      <Badge variant="outline">Managed by Constructly</Badge>
                    </>
                  ) : (
                    <Badge variant="outline">Custom</Badge>
                  )}
                </div>
                <p className="mt-1.5 max-w-prose text-sm text-foreground-muted">
                  {selected.description ??
                    (isOwnerRole
                      ? "Full, unrestricted access — always holds every permission."
                      : isSystemRole
                        ? "A default template you can tailor to how your company works."
                        : "Custom role.")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {canCreate && (
                  <Button
                    // On a built-in role this is the ONLY way to customise, so
                    // it leads rather than hiding among ghost buttons.
                    variant={selected.isSystem ? "primary" : "ghost"}
                    size="sm"
                    onClick={() =>
                      duplicate.mutate(selected.id, {
                        // Reveal the copy. Duplicating and staying on the
                        // read-only original looks like nothing happened —
                        // and on a built-in role the copy IS the point.
                        onSuccess: (created) => setSelectedId(created.id),
                      })
                    }
                    disabled={duplicate.isPending}
                  >
                    <Copy className="size-4" />
                    {selected.isSystem ? "Duplicate to customise" : "Duplicate"}
                  </Button>
                )}
                {canDeleteSelected && (
                  <Button variant="ghost" size="sm" className="text-danger-foreground hover:bg-danger-subtle" onClick={() => setConfirmDelete(selected)}>
                    <Trash2 className="size-4" />
                    Delete
                  </Button>
                )}
              </div>
            </div>

            {/* Effective permissions meter */}
            <div className="flex items-center gap-3">
              <div className="h-1.5 w-40 max-w-full overflow-hidden rounded-full bg-surface-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300"
                  style={{ width: `${Math.round((effectiveCount / ALL_PERMISSIONS.length) * 100)}%` }}
                />
              </div>
              <span className="text-xs text-foreground-subtle">
                <span className="font-semibold text-foreground">{effectiveCount}</span> of{" "}
                {ALL_PERMISSIONS.length} permissions
                {isOwnerRole && " — implicit, not a stored list"}
              </span>
            </div>

            {/* Editable name/description */}
            {canEditMeta && (
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  aria-label="Role name"
                  value={draftForSelected?.name ?? selected.name}
                  onChange={(e) => mutateDraft((d) => { d.name = e.target.value; })}
                  placeholder="Role name"
                />
                <Input
                  aria-label="Role description"
                  value={draftForSelected?.description ?? selected.description ?? ""}
                  onChange={(e) => mutateDraft((d) => { d.description = e.target.value; })}
                  placeholder="Description (optional)"
                />
              </div>
            )}

            {/* Search */}
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-subtle" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search permissions…"
                className="pl-9"
              />
            </div>
          </div>

          {/* Body: sticky module rail + permission sections */}
          <div className="grid gap-x-8 gap-y-6 px-6 py-6 lg:grid-cols-[168px_minmax(0,1fr)]">
            {/* Module rail */}
            <nav
              className="hidden self-start lg:block lg:sticky"
              style={{ top: headerH + 16 }}
              aria-label="Permission modules"
            >
              <ul className="space-y-0.5">
                {PERMISSION_CATALOG.map((mod) => {
                  const Icon = MODULE_ICON[mod.module];
                  const granted = moduleGrant(mod);
                  const dimmed = q && mod.actions.filter(matchesQuery).length === 0;
                  return (
                    <li key={mod.module}>
                      <button
                        onClick={() => jumpTo(mod.module)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-surface-muted",
                          dimmed ? "opacity-40" : "text-foreground-muted",
                        )}
                      >
                        <Icon className="size-3.5 shrink-0 text-foreground-subtle" />
                        <span className="min-w-0 flex-1 truncate">{mod.label}</span>
                        <span className={cn("shrink-0 text-[11px] tabular-nums", granted > 0 ? "text-primary" : "text-foreground-subtle")}>
                          {granted}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>

            {/* Sections */}
            <div className="min-w-0 space-y-8">
              {isOwnerRole && (
                <Callout tone="info" title="Owner has full company access">
                  <p>
                    Owner access is implicit, not a stored list of permissions — the role
                    holds every permission there is, including any added by a future
                    Constructly update, and it cannot be edited or deleted.
                  </p>
                  <p className="mt-1">
                    To build a role that is nearly-Owner but not quite, duplicate this one
                    and remove what it should not have.
                  </p>
                </Callout>
              )}

              {isSystemRole && (
                <Callout tone="info" title="Built-in role, managed by Constructly">
                  <p>
                    Its permissions are maintained by Constructly and may change when new
                    features are added, so they cannot be edited here — an edit would be
                    replaced by the next update.
                  </p>
                  <p className="mt-1">
                    To build on it, use <strong>Duplicate to customise</strong>. The copy
                    belongs to your company and is never changed by an update.
                  </p>
                </Callout>
              )}

              {PERMISSION_CATALOG.map((mod) => {
                const actions = mod.actions.filter(matchesQuery);
                if (actions.length === 0) return null;
                const Icon = MODULE_ICON[mod.module];
                const moduleKeys = mod.actions.map((a) => a.key);
                const granted = moduleGrant(mod);
                const allOn = selected.isOwner || moduleKeys.every((k) => currentPerms.has(k));
                const noneOn = !selected.isOwner && moduleKeys.every((k) => !currentPerms.has(k));
                return (
                  <section key={mod.module} id={`perm-${mod.module}`} style={{ scrollMarginTop: headerH + 16 }}>
                    <div className="mb-3 flex items-center gap-2.5">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-foreground-subtle">
                        <Icon className="size-4" />
                      </span>
                      <h3 className="text-sm font-semibold tracking-tight">{mod.label}</h3>
                      <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-foreground-subtle">
                        {granted}/{mod.actions.length}
                      </span>
                      {editable && (
                        <div className="ml-auto flex items-center gap-2 text-xs">
                          <button className="font-medium text-primary hover:underline disabled:opacity-40" disabled={allOn} onClick={() => setModule(moduleKeys, true)}>
                            Select all
                          </button>
                          <span className="text-border-strong">·</span>
                          <button className="font-medium text-foreground-muted hover:underline disabled:opacity-40" disabled={noneOn} onClick={() => setModule(moduleKeys, false)}>
                            Clear
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {actions.map((a) => {
                        const on = selected.isOwner || currentPerms.has(a.key);
                        const ungrantable = !grantable.has(a.key);
                        const locked = !editable || ungrantable;
                        const meta = permissionMeta(a.key);
                        const high = meta.impact === "HIGH";
                        const unlocks = reportsUnlockedBy(a.key);
                        return (
                          <button
                            key={a.key}
                            type="button"
                            // A read-only template exposes FACTS, not controls.
                            // Announcing an untickable checkbox tells a screen
                            // reader user to do something the server forbids.
                            role={editable ? "checkbox" : undefined}
                            aria-checked={editable ? on : undefined}
                            aria-disabled={!editable || undefined}
                            disabled={locked}
                            onClick={editable ? () => togglePerm(a.key) : undefined}
                            className={cn(
                              "group flex flex-col items-start gap-1.5 rounded-lg border px-3 py-2.5 text-left text-sm transition-all",
                              on
                                ? "border-primary/40 bg-primary/5"
                                : "border-border bg-surface hover:border-border-strong hover:bg-surface-muted/40",
                              locked && "cursor-not-allowed opacity-70 hover:border-border hover:bg-surface",
                            )}
                          >
                            <span className="flex w-full min-w-0 items-center gap-2.5">
                              <span
                                className={cn(
                                  "flex size-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors",
                                  on ? "border-primary bg-primary text-white" : "border-border-strong bg-surface",
                                )}
                              >
                                {on && <Check className="size-3" strokeWidth={3} />}
                              </span>
                              <span className={cn("min-w-0 flex-1", on ? "font-medium text-foreground" : "text-foreground")}>
                                {a.label}
                              </span>
                              {/* Impact is stated in WORDS. It used to be a 6px
                                  dot carrying a title and aria-hidden: colour and
                                  shape alone, invisible to a screen reader and
                                  very nearly invisible to everyone else. */}
                              {high && (
                                <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-danger-foreground ring-1 ring-inset ring-danger/40">
                                  High impact
                                </span>
                              )}
                            </span>

                            <span className="pl-[26px] text-xs leading-relaxed text-foreground-muted">
                              {meta.description}
                            </span>

                            <span className="flex flex-wrap items-center gap-1.5 pl-[26px]">
                              {/* The distinction most likely to be granted by
                                  accident: one project, or all of them. */}
                              <span
                                className={cn(
                                  "rounded px-1.5 py-0.5 text-[10px] font-medium",
                                  meta.scope === "COMPANY"
                                    ? "bg-warning-subtle text-warning-foreground"
                                    : "bg-surface-muted text-foreground-subtle",
                                )}
                              >
                                {SCOPE_LABEL[meta.scope]}
                              </span>
                              {ungrantable && !on && editable && (
                                <span className="flex items-center gap-1 text-[10px] text-foreground-subtle">
                                  <Lock className="size-3" aria-hidden />
                                  You do not hold this yourself
                                </span>
                              )}
                            </span>

                            {unlocks.length > 0 && (
                              <span className="pl-[26px] text-[11px] leading-relaxed text-foreground-subtle">
                                Unlocks: {unlocks.join(", ")}
                              </span>
                            )}

                            {high && meta.warning && (
                              <span className="pl-[26px] text-[11px] leading-relaxed text-warning-foreground">
                                {meta.warning}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>

          {/* Save bar */}
          {editable && (
            <div className="sticky bottom-0 z-20 flex items-center justify-end gap-2 rounded-b-xl border-t border-border bg-surface/95 px-6 py-3 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
              {dirty && (
                <span className="mr-auto flex items-center gap-1.5 text-xs font-medium text-warning-foreground">
                  <span className="size-1.5 rounded-full bg-warning" />
                  Unsaved changes
                </span>
              )}
              <Button variant="ghost" size="sm" disabled={!dirty} onClick={() => setDraft(null)}>Discard</Button>
              <Button variant="primary" size="sm" disabled={!dirty || update.isPending} onClick={save}>
                <Save className="size-4" />
                Save changes
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New role</DialogTitle>
            <DialogDescription>Create an empty custom role, then assign its permissions.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="role-name">Role name</Label>
            <Input id="role-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Site Supervisor" onKeyDown={(e) => e.key === "Enter" && submitCreate()} autoFocus />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={newName.trim().length < 2 || create.isPending} onClick={submitCreate}>Create role</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {confirmDelete?.name}?</DialogTitle>
            <DialogDescription>
              {confirmDelete && confirmDelete.memberCount > 0
                ? `${confirmDelete.memberCount} member(s) still have this role — reassign them first.`
                : "This can't be undone."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={!confirmDelete || confirmDelete.memberCount > 0 || del.isPending}
              onClick={() => confirmDelete && del.mutate(confirmDelete.id, { onSuccess: () => { setConfirmDelete(null); setSelectedId(null); } })}
            >
              Delete role
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function samePerms(a: Set<string>, b: string[]): boolean {
  if (a.size !== b.length) return false;
  return b.every((p) => a.has(p));
}
