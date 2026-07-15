"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ShoppingCart, Plus, Search, Inbox } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { RowsSkeleton } from "@/components/patterns/loading-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MoneyText } from "@/components/patterns/money-text";
import { StatusBadge, PO_STATUS_META } from "@/components/patterns/status-badge";
import { cn } from "@/lib/utils";
import { formatDate } from "@/features/projects/format";
import { useProjects } from "@/features/projects/hooks";
import type { POFilters, PurchaseOrderStatus } from "../types";
import { usePurchaseOrders, useVendors, usePendingApprovalCount } from "../hooks";
import { PO_STATUSES, PO_STATUS_LABEL } from "../constants";
import { POEditorSheet } from "./po-editor-sheet";

const GRID =
  "grid grid-cols-[1.4fr_100px_44px] md:grid-cols-[1.4fr_1.2fr_110px_120px_110px] items-center gap-3 px-4";

export function ProcurementView({ isOwner }: { isOwner: boolean }) {
  const router = useRouter();
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<PurchaseOrderStatus | "ALL">("ALL");
  const [projectId, setProjectId] = React.useState("ALL");
  const [vendorId, setVendorId] = React.useState("ALL");
  const [createOpen, setCreateOpen] = React.useState(false);
  const parentRef = React.useRef<HTMLDivElement>(null);

  const filters: POFilters = { search, status, projectId, vendorId };
  const { data: pos = [], isLoading } = usePurchaseOrders(filters);
  const { data: projects = [] } = useProjects({});
  const { data: vendors = [] } = useVendors({});
  const { data: pending = 0 } = usePendingApprovalCount();

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: pos.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 8,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Procurement"
        description="Purchase orders, materials, and budget impact."
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus />
            New purchase order
          </Button>
        }
      />

      {isOwner && pending > 0 && (
        <button
          onClick={() => setStatus("SUBMITTED")}
          className="flex w-full items-center gap-3 rounded-xl border border-warning/40 bg-warning-subtle/40 px-4 py-3 text-left transition-colors hover:bg-warning-subtle/60"
        >
          <span className="flex size-9 items-center justify-center rounded-lg bg-warning-subtle text-warning-foreground">
            <Inbox className="size-4" />
          </span>
          <div className="flex-1">
            <p className="text-sm font-medium">
              {pending} purchase order{pending > 1 ? "s" : ""} awaiting your approval
            </p>
            <p className="text-xs text-foreground-muted">Review and approve to count toward budget.</p>
          </div>
        </button>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-44 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-subtle" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search PO # or vendor…" className="pl-9" />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as PurchaseOrderStatus | "ALL")}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {PO_STATUSES.map((s) => <SelectItem key={s} value={s}>{PO_STATUS_LABEL[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Project" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All projects</SelectItem>
            {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={vendorId} onValueChange={setVendorId}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Vendor" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All vendors</SelectItem>
            {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.businessName}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <RowsSkeleton rows={6} />
      ) : pos.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          title="No purchase orders"
          description="Raise a purchase order against a project and vendor. Budget updates automatically."
          action={<Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}><Plus />Create a purchase order</Button>}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className={cn(GRID, "h-10 border-b border-border bg-surface-muted/40 text-xs font-medium text-foreground-subtle")}>
            <span>PO / Vendor</span>
            <span className="hidden md:block">Project</span>
            <span className="hidden md:block">Date</span>
            <span className="text-right md:text-left">Amount</span>
            <span>Status</span>
          </div>
          <div ref={parentRef} className="max-h-[calc(100vh-380px)] overflow-y-auto">
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((v) => {
                const po = pos[v.index];
                return (
                  <div key={po.id} style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${v.start}px)` }}>
                    <div
                      onClick={() => router.push(`/procurement/${po.id}`)}
                      className={cn(GRID, "h-[60px] cursor-pointer border-b border-border last:border-0 hover:bg-surface-muted/40")}
                    >
                      <div className="min-w-0">
                        <p className="truncate font-mono text-sm">{po.poNumber}</p>
                        <p className="truncate text-xs text-foreground-subtle">{po.vendor.name}</p>
                      </div>
                      <span className="hidden truncate text-sm text-foreground-muted md:block">{po.project.name}</span>
                      <span className="hidden text-sm text-foreground-muted md:block">{formatDate(po.purchaseDate)}</span>
                      <span className="text-right font-mono text-sm md:text-left"><MoneyText paise={po.totalPaise} compact /></span>
                      <span><StatusBadge meta={PO_STATUS_META} value={po.status} /></span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <POEditorSheet open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
