"use client";

import * as React from "react";
import Link from "next/link";
import { Truck, Plus, Search, Star, MoreHorizontal, UserX, UserCheck, Clock, Pencil } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { RowsSkeleton } from "@/components/patterns/loading-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MoneyText } from "@/components/patterns/money-text";
import { DataTable } from "@/components/patterns/data-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { TagChip } from "@/features/projects/components/tag-chip";
import type { Vendor, VendorFilters, VendorStatus } from "../types";
import { useVendors, useMaterialMaster, useVendorMutations } from "../hooks";
import { MaterialFilterSelect } from "./material-filter-select";
import { useRecentVendors } from "../recently-vendors";
import { useCan } from "@/features/rbac/permission-context";
import { AddVendorSheet } from "./add-vendor-sheet";
import { MaterialRefChip } from "./material-ref-chip";

/** Pin, edit and lifecycle for one vendor. Kept out of the row link. */
function VendorRowActions({ vendor: v, onEdit }: { vendor: Vendor; onEdit: (v: Vendor) => void }) {
  const can = useCan();
  const canEdit = can("vendors.edit");
  const canArchive = can("vendors.archive");
  const canRestore = can("vendors.restore");
  const { setStatus: setStatusM, toggleFavorite } = useVendorMutations();

  const lifecycle = v.status === "ACTIVE" ? canArchive : canRestore;
  return (
    <span className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => toggleFavorite.mutate(v.id)}
        aria-label={v.isFavorite ? `Unpin ${v.businessName}` : `Pin ${v.businessName}`}
        aria-pressed={v.isFavorite}
        className="rounded-sm p-1 text-foreground-subtle transition-colors hover:text-warning focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Star className={cn("size-4", v.isFavorite && "fill-warning text-warning")} />
      </button>
      {(canEdit || lifecycle) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${v.businessName}`}>
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {canEdit && (
              <DropdownMenuItem onSelect={() => onEdit(v)}>
                <Pencil />
                Edit vendor
              </DropdownMenuItem>
            )}
            {lifecycle && (
              <DropdownMenuItem
                onSelect={() =>
                  setStatusM.mutate({
                    id: v.id,
                    status: v.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                  })
                }
              >
                {v.status === "ACTIVE" ? <UserX /> : <UserCheck />}
                {v.status === "ACTIVE" ? "Deactivate" : "Activate"}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </span>
  );
}

export function VendorsView() {
  const can = useCan();
  const canCreate = can("vendors.create");
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<VendorStatus | "ALL">("ALL");
  // Identity, not a name: vendors are filtered through their VendorMaterial
  // mappings, so a renamed Material still finds the same vendors.
  const [materialId, setMaterialId] = React.useState<string | undefined>(undefined);
  const [favoritesOnly, setFavoritesOnly] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);
  const [editVendor, setEditVendor] = React.useState<Vendor | null>(null);

  const filters: VendorFilters = { search, status, materialId, favoritesOnly };
  const { data: vendors = [], isLoading } = useVendors(filters);
  // Archived included: a grandfathered mapping to an archived Material must
  // stay filterable. Same cached query as the rest of procurement.
  const { data: materials = [] } = useMaterialMaster({ includeArchived: true });
  const recent = useRecentVendors();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vendors"
        description="Your supplier directory and purchase history."
        actions={canCreate ? <Button variant="primary" onClick={() => setAddOpen(true)}><Plus />Add vendor</Button> : undefined}
      />

      {recent.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto">
          <span className="flex shrink-0 items-center gap-1 text-xs text-foreground-subtle"><Clock className="size-3.5" /> Recent</span>
          {recent.map((r) => (
            <Link key={r.id} href={`/vendors/${r.id}`} className="shrink-0 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-foreground-muted hover:border-border-strong hover:text-foreground">
              {r.name}
            </Link>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-44 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-subtle" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search vendors or materials…" className="pl-9" />
        </div>
        <MaterialFilterSelect
          className="w-40"
          value={{ materialId }}
          onChange={(v) => setMaterialId(v.materialId)}
          materials={materials}
          allLabel="All materials"
        />
        <Select value={status} onValueChange={(v) => setStatus(v as VendorStatus | "ALL")}>
          <SelectTrigger className="w-32" aria-label="Filter by vendor status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="INACTIVE">Inactive</SelectItem>
          </SelectContent>
        </Select>
        <Button variant={favoritesOnly ? "secondary" : "ghost"} size="icon" onClick={() => setFavoritesOnly((v) => !v)} title="Favorites only" aria-pressed={favoritesOnly}>
          <Star className={cn("size-4", favoritesOnly && "fill-warning text-warning")} />
        </Button>
      </div>

      {isLoading ? (
        <RowsSkeleton rows={4} />
      ) : vendors.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="No vendors found"
          description="Add the suppliers you buy from, or adjust your filters."
          action={canCreate ? <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}><Plus />Add vendor</Button> : undefined}
        />
      ) : (
        <DataTable
          caption="Vendors"
          rows={vendors}
          getRowKey={(v) => v.id}
          rowHref={(v) => `/vendors/${v.id}`}
          columns={[
            {
              key: "vendor",
              header: "Vendor",
              cell: (v) => (
                <span className="block min-w-0">
                  <span className="block font-medium">{v.businessName}</span>
                  <span className="text-xs text-foreground-subtle">
                    {v.contactPerson || "No contact"}
                  </span>
                </span>
              ),
            },
            {
              key: "status",
              header: "Status",
              cell: (v) => (
                <Badge variant={v.status === "INACTIVE" ? "neutral" : "success"}>
                  {v.status === "INACTIVE" ? "Inactive" : "Active"}
                </Badge>
              ),
            },
            {
              key: "materials",
              header: "Supplies",
              hideBelow: "xl",
              // Canonical Material Master names from the vendor's mappings —
              // already on the row, so no request per vendor.
              cell: (v) =>
                v.materials.length > 0 ? (
                  <span className="flex flex-wrap gap-1">
                    {v.materials.slice(0, 2).map((m) => (
                      <MaterialRefChip key={m.id} material={m} />
                    ))}
                    {v.materials.length > 2 && <TagChip label={`+${v.materials.length - 2}`} />}
                  </span>
                ) : (
                  <span className="text-xs text-foreground-subtle">—</span>
                ),
            },
            {
              key: "pos",
              header: "POs",
              numeric: true,
              hideBelow: "lg",
              cell: (v) => <span className="text-foreground-muted">{v.poCount}</span>,
            },
            {
              key: "purchased",
              header: "Lifetime purchases",
              numeric: true,
              hideBelow: "md",
              // Ordinary spend, ordinary tone. Colouring every rupee amber
              // teaches the eye to ignore the colour that should mean "act".
              cell: (v) => (
                <span className="text-foreground-muted">
                  <MoneyText paise={v.totalPurchasedPaise} compact />
                </span>
              ),
            },
            {
              key: "outstanding",
              header: "Outstanding",
              numeric: true,
              hideBelow: "lg",
              cell: (v) => <MoneyText paise={v.outstandingPaise} compact />,
            },
            {
              key: "actions",
              header: "Actions",
              headerHidden: true,
              numeric: true,
              cell: (v) => <VendorRowActions vendor={v} onEdit={setEditVendor} />,
            },
          ]}
          renderCard={(v) => (
            <div className="rounded-xl border border-border bg-surface p-3">
              <div className="flex items-start justify-between gap-2">
                <Link
                  href={`/vendors/${v.id}`}
                  className="min-w-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="block font-medium">{v.businessName}</span>
                  <span className="text-xs text-foreground-subtle">
                    {v.contactPerson || "No contact"}
                  </span>
                </Link>
                <VendorRowActions vendor={v} onEdit={setEditVendor} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant={v.status === "INACTIVE" ? "neutral" : "success"}>
                  {v.status === "INACTIVE" ? "Inactive" : "Active"}
                </Badge>
                <span className="text-xs text-foreground-muted">
                  {v.poCount} PO{v.poCount === 1 ? "" : "s"}
                </span>
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-3 text-xs">
                <span className="text-foreground-muted">Lifetime purchases</span>
                <span className="shrink-0 font-mono tabular-nums">
                  <MoneyText paise={v.totalPurchasedPaise} compact />
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="text-foreground-muted">Outstanding</span>
                <span className="shrink-0 font-mono tabular-nums">
                  <MoneyText paise={v.outstandingPaise} compact />
                </span>
              </div>
            </div>
          )}
        />
      )}

      <AddVendorSheet open={addOpen} onOpenChange={setAddOpen} />
      {editVendor && (
        <AddVendorSheet
          key={editVendor.id}
          open
          vendor={editVendor}
          onOpenChange={(o) => !o && setEditVendor(null)}
        />
      )}
    </div>
  );
}
