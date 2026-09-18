"use client";

import * as React from "react";
import { Package, Plus, Search, MoreHorizontal, Pencil, Archive, ArchiveRestore } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { RowsSkeleton } from "@/components/patterns/loading-state";
import { DataTable } from "@/components/patterns/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useCan } from "@/features/rbac/permission-context";
import { useMaterialCategories, useMaterialMaster, useMaterialMutations } from "../hooks";
import type { Material, MaterialFilters } from "../types";
import { MaterialSheet } from "./material-sheet";

type StatusFilter = "ACTIVE" | "ARCHIVED" | "ALL";

/**
 * Archiving is not deleting, and the confirmation has to say so in the words
 * that matter to the person clicking it: what stops happening, and what does
 * not change.
 */
function ArchiveDialog({
  material,
  onClose,
}: {
  material: Material | null;
  onClose: () => void;
}) {
  const { setArchived } = useMaterialMutations();
  const archiving = material?.isActive ?? true;

  function run() {
    if (!material) return;
    setArchived.mutate(
      { id: material.id, archived: archiving },
      { onSuccess: onClose, onError: onClose },
    );
  }

  return (
    <Dialog open={!!material} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {archiving ? "Archive" : "Restore"} {material?.name}?
          </DialogTitle>
          <DialogDescription>
            {archiving
              ? "It stops appearing when new purchase orders are raised. Nothing is deleted — existing purchase orders keep the material exactly as they recorded it, and you can restore it at any time."
              : "It becomes available again when raising new purchase orders."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={setArchived.isPending}>
            Cancel
          </Button>
          <Button
            variant={archiving ? "danger" : "primary"}
            onClick={run}
            disabled={setArchived.isPending}
          >
            {archiving ? "Archive material" : "Restore material"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MaterialRowActions({
  material,
  onEdit,
  onArchive,
}: {
  material: Material;
  onEdit: (m: Material) => void;
  onArchive: (m: Material) => void;
}) {
  const can = useCan();
  const canEdit = can("materials.edit");
  const canArchive = can("materials.archive");
  if (!canEdit && !canArchive) return null;

  return (
    <span className="flex items-center justify-end" onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${material.name}`}>
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canEdit && (
            <DropdownMenuItem onSelect={() => onEdit(material)}>
              <Pencil />
              Edit
            </DropdownMenuItem>
          )}
          {canArchive && (
            <DropdownMenuItem onSelect={() => onArchive(material)}>
              {material.isActive ? <Archive /> : <ArchiveRestore />}
              {material.isActive ? "Archive" : "Restore"}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

function StatusBadge({ material }: { material: Material }) {
  return material.isActive ? (
    <Badge variant="success">Active</Badge>
  ) : (
    <Badge variant="neutral">Archived</Badge>
  );
}

export function MaterialMasterView() {
  const can = useCan();
  const canCreate = can("materials.create");

  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<StatusFilter>("ACTIVE");
  const [category, setCategory] = React.useState("ALL");
  const [addOpen, setAddOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Material | null>(null);
  const [archiveTarget, setArchiveTarget] = React.useState<Material | null>(null);

  const { data: categories = [] } = useMaterialCategories();

  // The API knows only "active" vs "include archived", so ARCHIVED is fetched
  // as the wider set and narrowed here rather than inventing a second endpoint.
  const filters: MaterialFilters = {
    search: search.trim() || undefined,
    category,
    includeArchived: status !== "ACTIVE",
  };
  const { data: fetched = [], isLoading } = useMaterialMaster(filters);
  const materials = status === "ARCHIVED" ? fetched.filter((m) => !m.isActive) : fetched;

  const isSearching = search.trim().length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Materials"
        description="The catalogue of items your company buys. Categories group materials; individual materials are maintained here."
        actions={
          canCreate ? (
            <Button variant="primary" onClick={() => setAddOpen(true)}>
              <Plus />
              Add material
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-44 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-subtle" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search materials…"
            aria-label="Search materials"
            className="pl-9"
          />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-44" aria-label="Filter by category">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <SelectTrigger className="w-36" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="ARCHIVED">Archived</SelectItem>
            <SelectItem value="ALL">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <RowsSkeleton rows={5} />
      ) : materials.length === 0 ? (
        isSearching || category !== "ALL" || status !== "ACTIVE" ? (
          <EmptyState
            icon={Search}
            title="No materials match this search"
            description="Try a different term, or clear the filters."
          />
        ) : (
          <EmptyState
            icon={Package}
            title="No materials have been added yet"
            description={
              canCreate
                ? "Add the items your company buys, so purchase orders can name them consistently."
                : "Ask someone with material management access to add them."
            }
            action={
              canCreate ? (
                <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
                  <Plus />
                  Add your first material
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        <DataTable
          caption="Materials"
          rows={materials}
          getRowKey={(m) => m.id}
          columns={[
            {
              key: "name",
              header: "Material",
              cell: (m) => (
                <span className={cn("block min-w-0 font-medium", !m.isActive && "text-foreground-subtle")}>
                  {m.name}
                </span>
              ),
            },
            {
              key: "category",
              header: "Category",
              cell: (m) =>
                m.category ? (
                  <span className="text-foreground-muted">{m.category}</span>
                ) : (
                  <span className="text-xs text-foreground-subtle">—</span>
                ),
            },
            {
              key: "unit",
              header: "Default unit",
              hideBelow: "md",
              cell: (m) => (
                <span className="text-foreground-muted">{m.defaultUnit ?? "—"}</span>
              ),
            },
            {
              key: "hsn",
              header: "HSN",
              hideBelow: "lg",
              cell: (m) => (
                <span className="font-mono text-xs text-foreground-muted">{m.hsnCode ?? "—"}</span>
              ),
            },
            {
              key: "status",
              header: "Status",
              cell: (m) => <StatusBadge material={m} />,
            },
            {
              key: "actions",
              header: "Actions",
              headerHidden: true,
              numeric: true,
              cell: (m) => (
                <MaterialRowActions material={m} onEdit={setEditing} onArchive={setArchiveTarget} />
              ),
            },
          ]}
          renderCard={(m) => (
            <div
              className={cn(
                "rounded-xl border border-border bg-surface p-3",
                !m.isActive && "opacity-70",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{m.name}</p>
                  <p className="text-xs text-foreground-subtle">
                    {m.category ?? "No category"}
                    {m.defaultUnit ? ` · ${m.defaultUnit}` : ""}
                    {m.hsnCode ? ` · HSN ${m.hsnCode}` : ""}
                  </p>
                </div>
                <MaterialRowActions material={m} onEdit={setEditing} onArchive={setArchiveTarget} />
              </div>
              <div className="mt-2">
                <StatusBadge material={m} />
              </div>
            </div>
          )}
        />
      )}

      {addOpen && <MaterialSheet open onOpenChange={setAddOpen} />}
      {editing && (
        <MaterialSheet
          key={editing.id}
          open
          onOpenChange={(o) => !o && setEditing(null)}
          material={editing}
        />
      )}
      <ArchiveDialog material={archiveTarget} onClose={() => setArchiveTarget(null)} />
    </div>
  );
}
