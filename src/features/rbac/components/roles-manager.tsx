"use client";

import * as React from "react";
import { Plus, Copy, Trash2, Search, Shield, Lock, Save, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RowsSkeleton } from "@/components/patterns/loading-state";
import { cn } from "@/lib/utils";
import { useCan } from "../permission-context";
import { PERMISSION_CATALOG, ALL_PERMISSIONS, type Permission } from "../permissions";
import { useRoles, useCreateRole, useUpdateRole, useDuplicateRole, useDeleteRole } from "../hooks";
import type { RoleDTO } from "../server/roles-actions";

/** Local editable copy of a role's grants while the admin is toggling. */
type Draft = { roleId: string; name: string; description: string; permissions: Set<string> };

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
  const protectedRole = !!selected && (selected.isSystem || selected.isOwner);
  const editable = !!selected && !protectedRole && canManagePerms;

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

  const q = search.trim().toLowerCase();
  const effectiveCount = selected?.isOwner ? ALL_PERMISSIONS.length : currentPerms.size;

  if (isLoading) return <RowsSkeleton rows={6} />;

  return (
    <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
      {/* ── Role list ─────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-foreground-muted">Roles</h3>
          {canCreate && (
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              New
            </Button>
          )}
        </div>
        <div className="space-y-1">
          {roles.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                selected?.id === r.id ? "bg-primary/10 text-primary" : "hover:bg-surface-muted",
              )}
            >
              {r.isOwner ? <Shield className="size-4 shrink-0" /> : r.isSystem ? <Lock className="size-4 shrink-0 text-foreground-subtle" /> : <span className="size-4 shrink-0" />}
              <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
              <span className="shrink-0 text-xs text-foreground-subtle">{r.memberCount}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Permission matrix ─────────────────────────────────────── */}
      {selected && (
        <Card>
          <CardHeader className="gap-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="flex items-center gap-2">
                  {selected.name}
                  {selected.isOwner && <Badge variant="primary">Owner</Badge>}
                  {selected.isSystem && !selected.isOwner && <Badge variant="neutral">System</Badge>}
                </CardTitle>
                <p className="mt-1 text-sm text-foreground-muted">
                  {selected.description ?? (protectedRole ? "Protected role — duplicate it to customise." : "Custom role.")}
                </p>
                {/* Effective permission preview */}
                <p className="mt-1 text-xs text-foreground-subtle">
                  Effective permissions: <span className="font-medium text-foreground-muted">{effectiveCount}</span> of {ALL_PERMISSIONS.length}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {canCreate && (
                  <Button variant="ghost" size="sm" onClick={() => duplicate.mutate(selected.id)} disabled={duplicate.isPending}>
                    <Copy className="size-4" />
                    Duplicate
                  </Button>
                )}
                {canDelete && !protectedRole && (
                  <Button variant="ghost" size="sm" className="text-danger-foreground" onClick={() => setConfirmDelete(selected)}>
                    <Trash2 className="size-4" />
                    Delete
                  </Button>
                )}
              </div>
            </div>

            {/* Editable name/description for custom roles */}
            {editable && canEditName && (
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
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-subtle" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search permissions…" className="pl-9" />
            </div>
          </CardHeader>

          <CardContent className="space-y-5">
            {protectedRole && (
              <p className="rounded-[var(--radius)] border border-border bg-surface-muted/40 px-3 py-2 text-xs text-foreground-muted">
                {selected.isOwner
                  ? "The Owner role always holds every permission and can't be changed."
                  : "System roles are read-only. Duplicate this role to create an editable copy."}
              </p>
            )}

            {PERMISSION_CATALOG.map((mod) => {
              const actions = mod.actions.filter(
                (a) => !q || a.label.toLowerCase().includes(q) || a.key.toLowerCase().includes(q),
              );
              if (actions.length === 0) return null;
              const moduleKeys = mod.actions.map((a) => a.key);
              const allOn = selected.isOwner || moduleKeys.every((k) => currentPerms.has(k));
              const noneOn = !selected.isOwner && moduleKeys.every((k) => !currentPerms.has(k));
              return (
                <div key={mod.module}>
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-foreground-subtle">{mod.label}</h4>
                    {editable && (
                      <div className="flex gap-2 text-xs">
                        <button className="text-primary hover:underline disabled:opacity-40" disabled={allOn} onClick={() => setModule(moduleKeys, true)}>Select all</button>
                        <span className="text-foreground-subtle">·</span>
                        <button className="text-primary hover:underline disabled:opacity-40" disabled={noneOn} onClick={() => setModule(moduleKeys, false)}>Clear all</button>
                      </div>
                    )}
                  </div>
                  <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                    {actions.map((a) => {
                      const on = selected.isOwner || currentPerms.has(a.key);
                      const disabled = !editable || !grantable.has(a.key);
                      return (
                        <button
                          key={a.key}
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          disabled={disabled}
                          onClick={() => togglePerm(a.key)}
                          className={cn(
                            "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors",
                            on ? "border-primary/40 bg-primary/5" : "border-border",
                            disabled ? "cursor-not-allowed opacity-60" : "hover:border-border-strong",
                          )}
                          title={!grantable.has(a.key) && !on ? "You can't grant a permission you don't have" : undefined}
                        >
                          <span className={cn("flex size-4 shrink-0 items-center justify-center rounded border", on ? "border-primary bg-primary text-white" : "border-border-strong")}>
                            {on && <Check className="size-3" />}
                          </span>
                          <span className="min-w-0 truncate">{a.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </CardContent>

          {/* Save bar */}
          {editable && (
            <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border bg-surface/90 px-6 py-3 backdrop-blur">
              {dirty && <span className="mr-auto text-xs text-foreground-subtle">Unsaved changes</span>}
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
