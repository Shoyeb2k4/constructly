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
import { Card } from "@/components/ui/card";
import { MoneyText } from "@/components/patterns/money-text";
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
import { useVendors, useMaterials, useVendorMutations } from "../hooks";
import { useRecentVendors } from "../recently-vendors";
import { useCan } from "@/features/rbac/permission-context";
import { AddVendorSheet } from "./add-vendor-sheet";

export function VendorsView() {
  const can = useCan();
  const canCreate = can("vendors.create");
  const canEdit = can("vendors.edit");
  const canArchive = can("vendors.archive");
  const canRestore = can("vendors.restore");
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<VendorStatus | "ALL">("ALL");
  const [material, setMaterial] = React.useState("ALL");
  const [favoritesOnly, setFavoritesOnly] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);
  const [editVendor, setEditVendor] = React.useState<Vendor | null>(null);

  const filters: VendorFilters = { search, status, material, favoritesOnly };
  const { data: vendors = [], isLoading } = useVendors(filters);
  const { data: materials = [] } = useMaterials();
  const { setStatus: setStatusM, toggleFavorite } = useVendorMutations();
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
        <Select value={material} onValueChange={setMaterial}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Material" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All materials</SelectItem>
            {materials.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as VendorStatus | "ALL")}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {vendors.map((v) => (
            <Card key={v.id} className={cn("p-5 transition-shadow hover:shadow-[0_2px_12px_rgba(16,18,29,0.06)]", v.status === "INACTIVE" && "opacity-70")}>
              <div className="flex items-start justify-between gap-2">
                <Link href={`/vendors/${v.id}`} className="min-w-0 flex-1">
                  <p className="truncate font-medium hover:underline">{v.businessName}</p>
                  {v.contactPerson && <p className="mt-0.5 truncate text-xs text-foreground-subtle">{v.contactPerson}</p>}
                </Link>
                <div className="flex items-center">
                  <button onClick={() => toggleFavorite.mutate(v.id)} aria-label="Favorite" className="p-1 text-foreground-subtle hover:text-warning">
                    <Star className={cn("size-4", v.isFavorite && "fill-warning text-warning")} />
                  </button>
                  {(canEdit || (v.status === "ACTIVE" ? canArchive : canRestore)) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8 text-foreground-subtle" aria-label="Actions"><MoreHorizontal className="size-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canEdit && (
                          <DropdownMenuItem onSelect={() => setEditVendor(v)}>
                            <Pencil />
                            Edit
                          </DropdownMenuItem>
                        )}
                        {(v.status === "ACTIVE" ? canArchive : canRestore) && (
                          <DropdownMenuItem onSelect={() => setStatusM.mutate({ id: v.id, status: v.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" })}>
                            {v.status === "ACTIVE" ? <UserX /> : <UserCheck />}
                            {v.status === "ACTIVE" ? "Deactivate" : "Activate"}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {v.materialsSupplied.slice(0, 3).map((m) => <TagChip key={m} label={m} />)}
                {v.materialsSupplied.length > 3 && <TagChip label={`+${v.materialsSupplied.length - 3}`} />}
              </div>
              <div className="mt-4 flex items-end justify-between border-t border-border pt-3">
                <div>
                  <p className="text-xs text-foreground-subtle">Lifetime purchases</p>
                  <p className="font-mono text-sm font-medium"><MoneyText paise={v.totalPurchasedPaise} /></p>
                </div>
                <span className="text-xs text-foreground-subtle">{v.poCount} PO{v.poCount === 1 ? "" : "s"}</span>
              </div>
              {v.status === "INACTIVE" && <Badge variant="neutral" className="mt-3">Inactive</Badge>}
            </Card>
          ))}
        </div>
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
