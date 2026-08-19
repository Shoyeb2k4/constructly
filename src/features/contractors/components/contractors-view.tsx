"use client";

import * as React from "react";
import Link from "next/link";
import { HardHat, Plus, Search, ChevronRight, Download } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { RowsSkeleton } from "@/components/patterns/loading-state";
import { MoneyText } from "@/components/patterns/money-text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useCan } from "@/features/rbac/permission-context";
import {
  useContractors,
  useOutstandingAdvances,
  useContractorCostSummary,
  useSettlements,
} from "../hooks";
import type { ContractorStatus } from "../types";
import { AddContractorSheet } from "./add-contractor-sheet";

export function ContractorsView() {
  const can = useCan();
  // The server demands `contractors.create`; the UI now asks the same question
  // instead of "are you the Owner?".
  const canCreate = can("contractors.create");
  const [search, setSearch] = React.useState("");
  const [status, setStatus] = React.useState<ContractorStatus | "ALL">("ALL");
  const [addOpen, setAddOpen] = React.useState(false);

  const { data: contractors = [], isLoading } = useContractors({ search, status });
  const { data: outstanding = [] } = useOutstandingAdvances();
  const { data: costSummary = [] } = useContractorCostSummary();
  const { data: settlements = [] } = useSettlements();

  const reportsEmpty = outstanding.length === 0 && costSummary.length === 0 && settlements.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Contractors"
        description="Labour contractors, their advances, and weekly settlements."
        actions={
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" disabled={reportsEmpty}>
                  <Download className="size-4" />
                  Reports
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Outstanding advances</DropdownMenuLabel>
                <DropdownMenuItem disabled={outstanding.length === 0}
                  onSelect={async () => (await import("../exports")).exportOutstandingExcel(outstanding)}>Excel</DropdownMenuItem>
                <DropdownMenuItem disabled={outstanding.length === 0}
                  onSelect={async () => (await import("../exports")).exportOutstandingPdf(outstanding)}>PDF</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Weekly settlements</DropdownMenuLabel>
                <DropdownMenuItem disabled={settlements.length === 0}
                  onSelect={async () => (await import("../exports")).exportSettlementsExcel(settlements)}>Excel</DropdownMenuItem>
                <DropdownMenuItem disabled={settlements.length === 0}
                  onSelect={async () => (await import("../exports")).exportSettlementsPdf(settlements)}>PDF</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Cost summary</DropdownMenuLabel>
                <DropdownMenuItem disabled={costSummary.length === 0}
                  onSelect={async () => (await import("../exports")).exportCostSummaryExcel(costSummary)}>Excel</DropdownMenuItem>
                <DropdownMenuItem disabled={costSummary.length === 0}
                  onSelect={async () => (await import("../exports")).exportCostSummaryPdf(costSummary)}>PDF</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {canCreate && (
              <Button variant="primary" onClick={() => setAddOpen(true)}>
                <Plus />
                Add contractor
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-44 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-subtle" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or mobile…"
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={(v) => setStatus(v as ContractorStatus | "ALL")}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            {/* INACTIVE *is* archived — one lifecycle, one word for it. */}
            <SelectItem value="INACTIVE">Archived</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <RowsSkeleton rows={6} />
      ) : contractors.length === 0 ? (
        <EmptyState
          icon={HardHat}
          title={search || status !== "ALL" ? "No contractors match" : "No contractors yet"}
          description={
            search || status !== "ALL"
              ? "Try a different search or status."
              : "Add a labour contractor to record advances and weekly settlements."
          }
          action={
            canCreate && !(search || status !== "ALL") ? (
              <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
                <Plus />
                Add contractor
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="grid grid-cols-[1fr_auto] items-center border-b border-border bg-surface-muted/50 px-4 py-2.5 text-xs font-medium text-foreground-subtle">
            <span>Contractor</span>
            <span className="text-right">Advance balance</span>
          </div>
          {contractors.map((c) => (
            <Link
              key={c.id}
              href={`/labor/contractors/${c.id}`}
              className="grid grid-cols-[1fr_auto] items-center border-b border-border px-4 py-3 transition-colors last:border-0 hover:bg-surface-muted/50"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{c.name}</span>
                  {c.status === "INACTIVE" && (
                    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-foreground-subtle">
                      Archived
                    </span>
                  )}
                </div>
                <span className="text-xs text-foreground-subtle">{c.phone || "—"}</span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "font-mono text-sm",
                    c.advanceBalancePaise > 0 ? "text-warning-foreground" : "text-foreground-muted",
                  )}
                >
                  <MoneyText paise={c.advanceBalancePaise} />
                </span>
                <ChevronRight className="size-4 text-foreground-subtle" />
              </div>
            </Link>
          ))}
        </div>
      )}

      <AddContractorSheet open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
