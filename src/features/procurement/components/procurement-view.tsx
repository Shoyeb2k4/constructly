"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ShoppingCart,
  Plus,
  Search,
  Inbox,
  SlidersHorizontal,
  ArrowUpDown,
  X,
  Download,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { RowsSkeleton } from "@/components/patterns/loading-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { toRupees } from "@/lib/money";
import { useProjects } from "@/features/projects/hooks";
import type { POFilters, POSort } from "../types";
import {
  usePurchaseOrders,
  useVendors,
  useMaterials,
  useMaterialCategories,
  useMembers,
  usePendingApprovalCount,
} from "../hooks";
import {
  PO_SORTS,
  PO_SORT_LABEL,
  PO_STATUS_LABEL,
  PO_PAYMENT_STATUS_LABEL,
  PO_GST_LABEL,
} from "../constants";
import { encodePOQuery, decodePOQuery, countActiveFilters } from "../url-filters";
import { useCan } from "@/features/rbac/permission-context";
import { POEditorSheet } from "./po-editor-sheet";
import { ProcurementFilterSheet } from "./procurement-filter-sheet";
import { PoTable, PoColumnsMenu, usePoColumns } from "./po-table";

const PAGE_SIZE = 25;

export function ProcurementView() {
  const router = useRouter();
  const can = useCan();
  const canCreate = can("purchase_orders.create");
  const canApprove = can("purchase_orders.approve");

  // Read filters from the URL once (client-only) so refresh + shared links work.
  const [{ filters: initFilters, page: initPage }] = React.useState(() =>
    decodePOQuery(new URLSearchParams(typeof window !== "undefined" ? window.location.search : "")),
  );
  const [filters, setFilters] = React.useState<POFilters>(initFilters);
  const [page, setPage] = React.useState(initPage);
  const [searchInput, setSearchInput] = React.useState(initFilters.search ?? "");
  const [filterOpen, setFilterOpen] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);

  const columns = usePoColumns();

  // Persist filters + page to the URL bar without a navigation.
  React.useEffect(() => {
    const qs = encodePOQuery({ filters, page });
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, "", url);
  }, [filters, page]);

  // Debounce the search box into the filters (never resets the other filters).
  React.useEffect(() => {
    const t = setTimeout(() => {
      const s = searchInput.trim() || undefined;
      setFilters((f) => (f.search === s ? f : { ...f, search: s }));
      setPage((p) => (searchInput.trim() === (initFilters.search ?? "") ? p : 1));
    }, 300);
    return () => clearTimeout(t);
    // initFilters.search is a mount constant; only searchInput drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const patch = React.useCallback((p: Partial<POFilters>) => {
    setFilters((f) => ({ ...f, ...p }));
    setPage(1);
  }, []);

  const clearAll = React.useCallback(() => {
    const sort = filters.sort;
    setFilters(sort ? { sort } : {});
    setSearchInput("");
    setPage(1);
  }, [filters.sort]);

  const { data: pos = [], isLoading, isFetching } = usePurchaseOrders(filters);
  const { data: projects = [] } = useProjects({});
  const { data: vendors = [] } = useVendors({});
  const { data: materials = [] } = useMaterials();
  const { data: categories = [] } = useMaterialCategories();
  const { data: members = [] } = useMembers();
  const { data: pending = 0 } = usePendingApprovalCount();

  const activeCount = countActiveFilters(filters);

  // Client-side pagination over the server-filtered + server-sorted results.
  const total = pos.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Clamp for display without writing back to state (filters may have shrunk
  // the result set below the current page).
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * PAGE_SIZE;
  const pageItems = pos.slice(start, start + PAGE_SIZE);

  const nameOf = (id?: string | null) => {
    if (!id) return "";
    const p = projects.find((x) => x.id === id);
    if (p) return p.name;
    const v = vendors.find((x) => x.id === id);
    if (v) return v.businessName;
    const m = members.find((x) => x.id === id);
    return m?.fullName ?? id;
  };

  // Active-filter chips (search is shown in its own box, not chipped).
  const chips: { key: string; label: string; onClear: () => void }[] = [];
  const on = (v?: string) => v != null && v !== "ALL" && v !== "";
  if (on(filters.status)) chips.push({ key: "status", label: `Status: ${PO_STATUS_LABEL[filters.status as keyof typeof PO_STATUS_LABEL]}`, onClear: () => patch({ status: undefined }) });
  if (on(filters.projectId)) chips.push({ key: "project", label: `Project: ${nameOf(filters.projectId)}`, onClear: () => patch({ projectId: undefined }) });
  if (on(filters.vendorId)) chips.push({ key: "vendor", label: `Vendor: ${nameOf(filters.vendorId)}`, onClear: () => patch({ vendorId: undefined }) });
  if (on(filters.material)) chips.push({ key: "material", label: `Material: ${filters.material}`, onClear: () => patch({ material: undefined }) });
  if (on(filters.category)) chips.push({ key: "category", label: `Category: ${filters.category}`, onClear: () => patch({ category: undefined }) });
  if (on(filters.paymentStatus)) chips.push({ key: "pay", label: `Payment: ${PO_PAYMENT_STATUS_LABEL[filters.paymentStatus as keyof typeof PO_PAYMENT_STATUS_LABEL]}`, onClear: () => patch({ paymentStatus: undefined }) });
  if (on(filters.createdById)) chips.push({ key: "by", label: `By: ${nameOf(filters.createdById)}`, onClear: () => patch({ createdById: undefined }) });
  if (filters.gst && filters.gst !== "ALL") chips.push({ key: "gst", label: PO_GST_LABEL[filters.gst], onClear: () => patch({ gst: undefined }) });
  if (filters.amountMinPaise != null || filters.amountMaxPaise != null)
    chips.push({
      key: "amount",
      label: `₹${filters.amountMinPaise != null ? toRupees(filters.amountMinPaise).toLocaleString("en-IN") : "0"}–${filters.amountMaxPaise != null ? toRupees(filters.amountMaxPaise).toLocaleString("en-IN") : "∞"}`,
      onClear: () => patch({ amountMinPaise: undefined, amountMaxPaise: undefined }),
    });
  if (on(filters.dateFrom) || on(filters.dateTo))
    chips.push({ key: "date", label: `${filters.dateFrom || "…"} → ${filters.dateTo || "…"}`, onClear: () => patch({ dateFrom: undefined, dateTo: undefined }) });

  async function runExport(kind: "csv" | "excel" | "pdf") {
    const mod = await import("../exports");
    if (kind === "csv") mod.exportPOsCsv(pos);
    else if (kind === "excel") mod.exportPOsExcel(pos);
    else mod.exportPOsPdf(pos);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Procurement"
        description="Purchase orders, materials, and budget impact."
        actions={
          canCreate ? (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus />
              New purchase order
            </Button>
          ) : undefined
        }
      />

      {canApprove && pending > 0 && (
        <button
          onClick={() => patch({ status: "SUBMITTED" })}
          className="flex w-full items-center gap-3 rounded-xl border border-warning/40 bg-warning-subtle/40 px-4 py-3 text-left transition-colors hover:bg-warning-subtle/60"
        >
          <span className="flex size-9 items-center justify-center rounded-lg bg-warning-subtle text-warning-foreground">
            <Inbox className="size-4" />
          </span>
          <div className="flex-1">
            <p className="text-sm font-medium">{pending} purchase order{pending > 1 ? "s" : ""} awaiting your approval</p>
            <p className="text-xs text-foreground-muted">Review and approve to count toward budget.</p>
          </div>
        </button>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-44 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-subtle" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search PO # or vendor…"
            className="pl-9"
          />
        </div>

        <Button variant="secondary" size="sm" onClick={() => setFilterOpen(true)}>
          <SlidersHorizontal className="size-4" />
          Filters
          {activeCount > 0 && <Badge variant="primary" className="ml-1">{activeCount}</Badge>}
        </Button>

        <div className="flex items-center gap-1.5">
          <ArrowUpDown className="size-4 text-foreground-subtle" />
          <Select value={filters.sort ?? "NEWEST"} onValueChange={(v) => patch({ sort: v as POSort })}>
            <SelectTrigger className="w-44" aria-label="Sort"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PO_SORTS.map((s) => <SelectItem key={s} value={s}>{PO_SORT_LABEL[s]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <PoColumnsMenu state={columns.state} toggle={columns.toggle} reset={columns.reset} />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm" disabled={total === 0}>
              <Download className="size-4" />
              Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => runExport("csv")}>CSV</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => runExport("excel")}>Excel</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => runExport("pdf")}>PDF</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Active filter chips */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button
              key={c.key}
              onClick={c.onClear}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium text-foreground-muted transition-colors hover:border-border-strong hover:text-foreground"
            >
              {c.label}
              <X className="size-3" />
            </button>
          ))}
          <button onClick={clearAll} className="rounded-full px-2 py-1 text-xs font-medium text-primary hover:underline">
            Clear all
          </button>
        </div>
      )}

      {/* Result count */}
      {!isLoading && (
        <p className="text-xs text-foreground-subtle">
          {total === 0 ? "No matching purchase orders" : `${total} purchase order${total === 1 ? "" : "s"}`}
          {isFetching && total > 0 ? " · updating…" : ""}
        </p>
      )}

      {isLoading ? (
        <RowsSkeleton rows={8} />
      ) : total === 0 ? (
        <EmptyState
          icon={activeCount > 0 || filters.search ? Search : ShoppingCart}
          title={activeCount > 0 || filters.search ? "No purchase orders match" : "No purchase orders"}
          description={
            activeCount > 0 || filters.search
              ? "Try removing a filter or clearing your search."
              : "Raise a purchase order against a project and vendor. Budget updates automatically."
          }
          action={
            activeCount > 0 || filters.search ? (
              <Button variant="secondary" size="sm" onClick={clearAll}>Clear filters</Button>
            ) : canCreate ? (
              <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}><Plus />Create a purchase order</Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <PoTable
            items={pageItems}
            colState={columns.state}
            setWidth={columns.setWidth}
            onRowClick={(id) => router.push(`/procurement/${id}`)}
          />
          {/* Pagination */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-foreground-subtle">
              Showing {start + 1}–{Math.min(start + PAGE_SIZE, total)} of {total}
            </p>
            {pageCount > 1 && (
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)} aria-label="Previous page">
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="px-2 text-xs tabular-nums text-foreground-muted">Page {safePage} / {pageCount}</span>
                <Button variant="ghost" size="icon" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)} aria-label="Next page">
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            )}
          </div>
        </>
      )}

      <ProcurementFilterSheet
        open={filterOpen}
        onOpenChange={setFilterOpen}
        filters={filters}
        onChange={patch}
        onClearAll={clearAll}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        vendors={vendors.map((v) => ({ id: v.id, businessName: v.businessName }))}
        materials={materials}
        categories={categories}
        members={members}
      />
      <POEditorSheet open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
