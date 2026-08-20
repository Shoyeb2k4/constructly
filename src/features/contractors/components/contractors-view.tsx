"use client";

import * as React from "react";
import Link from "next/link";
import { HardHat, Plus, Search, Download } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { MoneyText } from "@/components/patterns/money-text";
import { DataTable } from "@/components/patterns/data-table";
import { Badge } from "@/components/ui/badge";
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

  // Already fetched for the Reports menu — reused here rather than adding a
  // query. Scan fields must help a user decide what to OPEN; nothing is shown
  // merely because the data happens to be in hand.
  const costById = new Map(costSummary.map((r) => [r.contractorId, r]));

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
          <SelectTrigger className="w-36" aria-label="Filter by contractor status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            {/* INACTIVE *is* archived — one lifecycle, one word for it. */}
            <SelectItem value="INACTIVE">Archived</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Loading and empty are the TABLE's own states, so the skeleton is
          built from the same column definitions and the page does not jump when
          the rows land. */}
      <DataTable
          isLoading={isLoading}
          loadingRows={6}
          empty={
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
          }
          caption="Contractors"
          rows={contractors}
          getRowKey={(c) => c.id}
          rowHref={(c) => `/labor/contractors/${c.id}`}
          columns={[
            {
              key: "name",
              header: "Contractor",
              cell: (c) => (
                <div className="min-w-0">
                  <span className="block truncate font-medium">{c.name}</span>
                  <span className="text-xs text-foreground-subtle">{c.phone || "No mobile"}</span>
                </div>
              ),
            },
            {
              key: "status",
              header: "Status",
              hideBelow: "sm",
              cell: (c) => (
                <Badge variant={c.status === "INACTIVE" ? "neutral" : "success"}>
                  {c.status === "INACTIVE" ? "Archived" : "Active"}
                </Badge>
              ),
            },
            {
              key: "settled",
              header: "Settled labour",
              numeric: true,
              hideBelow: "lg",
              cell: (c) => (
                <span className="text-foreground-muted">
                  <MoneyText paise={costById.get(c.id)?.totalBillPaise ?? 0} />
                </span>
              ),
            },
            {
              key: "settlements",
              header: "Settlements",
              numeric: true,
              hideBelow: "xl",
              cell: (c) => (
                <span className="text-foreground-muted">
                  {costById.get(c.id)?.settlementCount ?? 0}
                </span>
              ),
            },
            {
              key: "advance",
              header: "Advance balance",
              numeric: true,
              // NOT amber. An outstanding advance is an ordinary position, not a
              // warning — colouring every rupee amber taught the eye to ignore
              // the colour that should mean "look at this".
              cell: (c) => <MoneyText paise={c.advanceBalancePaise} />,
            },
          ]}
          renderCard={(c) => (
            <Link
              href={`/labor/contractors/${c.id}`}
              className="block rounded-xl border border-border bg-surface p-3 transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-medium">{c.name}</span>
                <span className="shrink-0 font-mono tabular-nums text-sm">
                  <MoneyText paise={c.advanceBalancePaise} />
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-3">
                <span className="truncate text-xs text-foreground-subtle">
                  {c.phone || "No mobile"}
                </span>
                <span className="shrink-0 text-xs text-foreground-subtle">Advance balance</span>
              </div>
              {c.status === "INACTIVE" && (
                <Badge variant="neutral" className="mt-2">
                  Archived
                </Badge>
              )}
            </Link>
          )}
        />

      <AddContractorSheet open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
